import type { EventEmitter } from 'node:events';
import type { Readable, Writable } from 'node:stream';

export type RpcFailureCode =
  | 'ABORTED'
  | 'CLOSED'
  | 'PROCESS_EXITED'
  | 'REMOTE_ERROR'
  | 'TIMEOUT'
  | 'WRITE_FAILED';

export class RpcRequestError extends Error {
  readonly code: RpcFailureCode;
  readonly rpcCode: number | undefined;

  constructor(code: RpcFailureCode, rpcCode?: number) {
    super(code === 'REMOTE_ERROR' && rpcCode !== undefined
      ? `Codex request failed with RPC code ${rpcCode}`
      : `Codex RPC request failed: ${code}`);
    this.name = 'RpcRequestError';
    this.code = code;
    this.rpcCode = rpcCode;
  }
}

export interface RpcChildTransport extends EventEmitter {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr?: Readable;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface RpcNotification {
  readonly method: string;
  readonly params?: unknown;
}

export interface RpcServerRequest {
  readonly id: string | number;
  readonly method: string;
}

export interface RpcProtocolIssue {
  readonly code:
    | 'INVALID_MESSAGE'
    | 'LINE_TOO_LARGE'
    | 'MALFORMED_LINE'
    | 'PROCESS_EXITED'
    | 'UNKNOWN_RESPONSE_ID';
}

export interface JsonRpcLineClientOptions {
  readonly defaultTimeoutMs: number;
  readonly closeTimeoutMs?: number;
  readonly maxLineBytes?: number;
  readonly maxStderrBytes?: number;
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: RpcRequestError) => void;
  readonly timer: NodeJS.Timeout;
  readonly signal: AbortSignal | undefined;
  readonly abortListener: (() => void) | undefined;
}

export class JsonRpcLineClient {
  readonly #child: RpcChildTransport;
  readonly #defaultTimeoutMs: number;
  readonly #closeTimeoutMs: number;
  readonly #maxLineBytes: number;
  readonly #maxStderrBytes: number;
  readonly #pending = new Map<number, PendingRequest>();
  readonly #notificationListeners = new Set<(notification: RpcNotification) => void>();
  readonly #protocolIssueListeners = new Set<(issue: RpcProtocolIssue) => void>();
  readonly #serverRequestListeners = new Set<(request: RpcServerRequest) => void>();
  readonly #terminationListeners = new Set<() => void>();
  #nextId = 1;
  #buffer = Buffer.alloc(0);
  #discardUntilNewline = false;
  #stderrBytes = 0;
  #stderrTruncated = false;
  #terminated = false;
  #closing = false;

  constructor(child: RpcChildTransport, options: JsonRpcLineClientOptions) {
    this.#child = child;
    this.#defaultTimeoutMs = options.defaultTimeoutMs;
    this.#closeTimeoutMs = options.closeTimeoutMs ?? 2_000;
    this.#maxLineBytes = options.maxLineBytes ?? 2_000_000;
    this.#maxStderrBytes = options.maxStderrBytes ?? 32_768;

    child.stdout.on('data', this.#handleStdout);
    child.stdout.once('error', this.#handleProcessFailure);
    child.stdout.once('end', this.#handleStdoutEnd);
    child.stderr?.on('data', this.#handleStderr);
    child.once('error', this.#handleProcessFailure);
    child.once('exit', this.#handleExit);
  }

  get pendingCount(): number {
    return this.#pending.size;
  }

  request<T = unknown>(
    method: string,
    params: unknown,
    options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
  ): Promise<T> {
    if (this.#terminated || this.#closing) return Promise.reject(new RpcRequestError('CLOSED'));
    if (options.signal?.aborted) return Promise.reject(new RpcRequestError('ABORTED'));

    const id = this.#nextId;
    this.#nextId += 1;
    const timeoutMs = options.timeoutMs ?? this.#defaultTimeoutMs;

    return new Promise<T>((resolve, reject) => {
      const abortListener = options.signal
        ? () => this.#settleRejected(id, new RpcRequestError('ABORTED'))
        : undefined;
      const timer = setTimeout(
        () => this.#settleRejected(id, new RpcRequestError('TIMEOUT')),
        timeoutMs,
      );
      timer.unref?.();
      this.#pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
        signal: options.signal,
        abortListener,
      });
      options.signal?.addEventListener('abort', abortListener!, { once: true });

      try {
        this.#writeLine({ id, method, params });
      } catch {
        this.#settleRejected(id, new RpcRequestError('WRITE_FAILED'));
      }
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.#terminated || this.#closing) throw new RpcRequestError('CLOSED');
    this.#writeLine(params === undefined ? { method } : { method, params });
  }

  onNotification(listener: (notification: RpcNotification) => void): () => void {
    this.#notificationListeners.add(listener);
    return () => this.#notificationListeners.delete(listener);
  }

  onProtocolIssue(listener: (issue: RpcProtocolIssue) => void): () => void {
    this.#protocolIssueListeners.add(listener);
    return () => this.#protocolIssueListeners.delete(listener);
  }

  onServerRequest(listener: (request: RpcServerRequest) => void): () => void {
    this.#serverRequestListeners.add(listener);
    return () => this.#serverRequestListeners.delete(listener);
  }

  getDiagnostics(): { readonly stderrBytes: number; readonly stderrTruncated: boolean } {
    return Object.freeze({ stderrBytes: this.#stderrBytes, stderrTruncated: this.#stderrTruncated });
  }

  toJSON(): object {
    return { pendingCount: this.pendingCount, ...this.getDiagnostics() };
  }

  async close(): Promise<void> {
    if (this.#closing || this.#terminated) return;
    this.#closing = true;
    this.#rejectAll(new RpcRequestError('CLOSED'));
    this.#child.stdin.end();

    const gracefulWindow = Math.max(1, Math.floor(this.#closeTimeoutMs / 2));
    if (await this.#waitForTermination(gracefulWindow)) return;
    this.#child.kill('SIGTERM');
    if (await this.#waitForTermination(this.#closeTimeoutMs - gracefulWindow)) return;
    this.#child.kill('SIGKILL');
  }

  readonly #handleStdout = (chunk: Buffer | string): void => {
    let incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (this.#discardUntilNewline) {
      const newline = incoming.indexOf(0x0a);
      if (newline === -1) return;
      incoming = incoming.subarray(newline + 1);
      this.#discardUntilNewline = false;
    }

    this.#buffer = Buffer.concat([this.#buffer, incoming]);
    let newline = this.#buffer.indexOf(0x0a);
    while (newline !== -1) {
      const line = this.#buffer.subarray(0, newline);
      this.#buffer = this.#buffer.subarray(newline + 1);
      if (line.byteLength > this.#maxLineBytes) this.#emitProtocolIssue('LINE_TOO_LARGE');
      else if (line.byteLength > 0) this.#handleLine(line.toString('utf8'));
      newline = this.#buffer.indexOf(0x0a);
    }

    if (this.#buffer.byteLength > this.#maxLineBytes) {
      this.#buffer = Buffer.alloc(0);
      this.#discardUntilNewline = true;
      this.#emitProtocolIssue('LINE_TOO_LARGE');
    }
  };

  readonly #handleStderr = (chunk: Buffer | string): void => {
    const bytes = Buffer.byteLength(chunk);
    const remaining = Math.max(0, this.#maxStderrBytes - this.#stderrBytes);
    this.#stderrBytes += Math.min(bytes, remaining);
    if (bytes > remaining) this.#stderrTruncated = true;
  };

  readonly #handleProcessFailure = (): void => {
    this.#terminate(new RpcRequestError('PROCESS_EXITED'));
  };

  readonly #handleExit = (): void => {
    this.#terminate(new RpcRequestError('PROCESS_EXITED'));
  };

  readonly #handleStdoutEnd = (): void => {
    if (!this.#closing) this.#terminate(new RpcRequestError('PROCESS_EXITED'));
  };

  #handleLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      this.#emitProtocolIssue('MALFORMED_LINE');
      return;
    }
    if (!isRecord(message)) {
      this.#emitProtocolIssue('INVALID_MESSAGE');
      return;
    }

    if (typeof message.method === 'string') {
      if (typeof message.id === 'string' || typeof message.id === 'number') {
        const request = { id: message.id, method: message.method };
        this.#serverRequestListeners.forEach((listener) => listener(request));
        this.#writeLine({
          id: message.id,
          error: { code: -32_601, message: 'Client method is disabled' },
        });
      } else {
        const notification = 'params' in message
          ? { method: message.method, params: message.params }
          : { method: message.method };
        this.#notificationListeners.forEach((listener) => listener(notification));
      }
      return;
    }

    if (typeof message.id !== 'number' || (!('result' in message) && !('error' in message))) {
      this.#emitProtocolIssue('INVALID_MESSAGE');
      return;
    }
    const pending = this.#takePending(message.id);
    if (!pending) {
      this.#emitProtocolIssue('UNKNOWN_RESPONSE_ID');
      return;
    }
    if ('error' in message) {
      const rpcCode = isRecord(message.error) && typeof message.error.code === 'number'
        ? message.error.code
        : undefined;
      pending.reject(new RpcRequestError('REMOTE_ERROR', rpcCode));
    } else {
      pending.resolve(message.result);
    }
  }

  #writeLine(message: object): void {
    this.#child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #settleRejected(id: number, error: RpcRequestError): void {
    const pending = this.#takePending(id);
    pending?.reject(error);
  }

  #takePending(id: number): PendingRequest | undefined {
    const pending = this.#pending.get(id);
    if (!pending) return undefined;
    this.#pending.delete(id);
    clearTimeout(pending.timer);
    if (pending.signal && pending.abortListener) {
      pending.signal.removeEventListener('abort', pending.abortListener);
    }
    return pending;
  }

  #rejectAll(error: RpcRequestError): void {
    for (const id of [...this.#pending.keys()]) this.#settleRejected(id, error);
  }

  #terminate(error: RpcRequestError): void {
    if (this.#terminated) return;
    this.#terminated = true;
    this.#rejectAll(error);
    if (!this.#closing) this.#emitProtocolIssue('PROCESS_EXITED');
    this.#terminationListeners.forEach((listener) => listener());
    this.#terminationListeners.clear();
  }

  #emitProtocolIssue(code: RpcProtocolIssue['code']): void {
    const issue = Object.freeze({ code });
    this.#protocolIssueListeners.forEach((listener) => listener(issue));
  }

  #waitForTermination(timeoutMs: number): Promise<boolean> {
    if (this.#terminated) return Promise.resolve(true);
    return new Promise((resolve) => {
      const listener = () => {
        clearTimeout(timer);
        this.#terminationListeners.delete(listener);
        resolve(true);
      };
      const timer = setTimeout(() => {
        this.#terminationListeners.delete(listener);
        resolve(this.#terminated);
      }, Math.max(1, timeoutMs));
      timer.unref?.();
      this.#terminationListeners.add(listener);
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
