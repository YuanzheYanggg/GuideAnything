import {
  BridgeCancelRequestV1Schema,
  BridgeEventV1Schema,
  BridgeRunRequestV1Schema,
  BridgeSteerRequestV1Schema,
  type BridgeEventV1,
  type BridgeRunRequestV1,
} from '@guideanything/contracts';
import { randomUUID } from 'node:crypto';

const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_ERROR_BYTES = 16 * 1024;
const MAX_LINE_BYTES = 2 * 1024 * 1024;
const SAFE_ERROR_CODE = /^[A-Z0-9_]{1,80}$/u;

type FetchImplementation = typeof fetch;

export interface AgentRuntimeClient {
  run(request: BridgeRunRequestV1, signal?: AbortSignal): AsyncIterable<BridgeEventV1>;
  cancel(runId: string, signal?: AbortSignal): Promise<void>;
  steer(runId: string, planVersion: number, instruction: string, signal?: AbortSignal): Promise<void>;
}

export interface HttpAgentRuntimeClientOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: FetchImplementation;
  maxResponseBytes?: number;
}

export class RuntimeClientError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    message = '只读 Agent Runtime 请求失败',
  ) {
    super(message);
    this.name = 'RuntimeClientError';
  }
}

export class HttpAgentRuntimeClient implements AgentRuntimeClient {
  readonly #baseUrl: URL;
  readonly #token: string;
  readonly #fetch: FetchImplementation;
  readonly #maxResponseBytes: number;

  constructor(options: HttpAgentRuntimeClientOptions) {
    this.#baseUrl = parseBridgeBaseUrl(options.baseUrl);
    if (options.token.length < 32) throw new Error('Runtime Bridge token 长度不足');
    this.#token = options.token;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    if (!Number.isSafeInteger(this.#maxResponseBytes) || this.#maxResponseBytes < 1) {
      throw new Error('Runtime Bridge 响应上限必须是正整数');
    }
  }

  async *run(
    untrustedRequest: BridgeRunRequestV1,
    signal?: AbortSignal,
  ): AsyncGenerator<BridgeEventV1> {
    const request = BridgeRunRequestV1Schema.parse(untrustedRequest);
    if (request.allowedRoots.length > 0) {
      throw new RuntimeClientError('CALLER_ROOTS_FORBIDDEN', false);
    }
    const response = await this.#fetch(this.endpoint('/v1/generate'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(request),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw await responseError(response);
    if (!isNdjson(response.headers.get('content-type'))) {
      await response.body?.cancel().catch(() => undefined);
      throw new RuntimeClientError('BRIDGE_CONTENT_TYPE_INVALID', true);
    }
    if (!response.body) throw new RuntimeClientError('BRIDGE_STREAM_MISSING', true);

    const decoder = new TextDecoder('utf-8', { fatal: true });
    const reader = response.body.getReader();
    let buffered = '';
    let receivedBytes = 0;
    let expectedSequence = 1;
    let sawTerminal = false;
    let streamComplete = false;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        receivedBytes += chunk.value.byteLength;
        if (receivedBytes > this.#maxResponseBytes) {
          throw new RuntimeClientError('BRIDGE_RESPONSE_TOO_LARGE', true);
        }
        buffered += decoder.decode(chunk.value, { stream: true });
        if (new TextEncoder().encode(buffered).byteLength > MAX_LINE_BYTES && !buffered.includes('\n')) {
          throw new RuntimeClientError('BRIDGE_EVENT_TOO_LARGE', true);
        }
        let newline = buffered.indexOf('\n');
        while (newline >= 0) {
          const line = buffered.slice(0, newline).replace(/\r$/u, '');
          buffered = buffered.slice(newline + 1);
          if (line.trim()) {
            const event = parseOwnedEvent(line, request, expectedSequence, sawTerminal);
            expectedSequence += 1;
            sawTerminal = isTerminal(event);
            yield event;
          }
          newline = buffered.indexOf('\n');
        }
      }
      buffered += decoder.decode();
      const finalLine = buffered.replace(/\r$/u, '');
      if (finalLine.trim()) {
        const event = parseOwnedEvent(finalLine, request, expectedSequence, sawTerminal);
        sawTerminal = isTerminal(event);
        yield event;
      }
      if (!sawTerminal) throw new RuntimeClientError('BRIDGE_STREAM_INCOMPLETE', true);
      streamComplete = true;
    } catch (error) {
      if (error instanceof RuntimeClientError) throw error;
      if (signal?.aborted) throw error;
      throw new RuntimeClientError('BRIDGE_STREAM_INVALID', true);
    } finally {
      if (!streamComplete) await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }

  async cancel(runId: string, signal?: AbortSignal): Promise<void> {
    const request = BridgeCancelRequestV1Schema.parse({
      type: 'CANCEL', requestId: randomUUID(), runId,
    });
    await this.sendControl('/v1/cancel', request, signal);
  }

  async steer(
    runId: string,
    planVersion: number,
    instruction: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const request = BridgeSteerRequestV1Schema.parse({
      type: 'STEER', requestId: randomUUID(), runId, planVersion, instruction,
    });
    await this.sendControl('/v1/steer', request, signal);
  }

  private endpoint(path: string): string {
    return new URL(path, this.#baseUrl).toString();
  }

  private headers(): Record<string, string> {
    return {
      accept: 'application/json, application/x-ndjson',
      authorization: `Bearer ${this.#token}`,
      'content-type': 'application/json',
    };
  }

  private async sendControl(path: string, body: unknown, signal?: AbortSignal): Promise<void> {
    const response = await this.#fetch(this.endpoint(path), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw await responseError(response);
    await readBoundedBytes(response, MAX_ERROR_BYTES);
  }
}

function parseOwnedEvent(
  line: string,
  request: BridgeRunRequestV1,
  expectedSequence: number,
  afterTerminal: boolean,
): BridgeEventV1 {
  if (new TextEncoder().encode(line).byteLength > MAX_LINE_BYTES) {
    throw new RuntimeClientError('BRIDGE_EVENT_TOO_LARGE', true);
  }
  if (afterTerminal) throw new RuntimeClientError('BRIDGE_TRAILING_EVENT', true);
  let decoded: unknown;
  try {
    decoded = JSON.parse(line);
  } catch {
    throw new RuntimeClientError('BRIDGE_EVENT_INVALID', true);
  }
  const parsed = BridgeEventV1Schema.safeParse(decoded);
  if (!parsed.success) throw new RuntimeClientError('BRIDGE_EVENT_INVALID', true);
  const event = parsed.data;
  if (
    event.requestId !== request.requestId
    || event.runId !== request.runId
    || event.sequence !== expectedSequence
  ) {
    throw new RuntimeClientError('BRIDGE_EVENT_OWNERSHIP_INVALID', true);
  }
  return event;
}

function isTerminal(event: BridgeEventV1): boolean {
  return event.type === 'COMPLETED' || event.type === 'FAILED';
}

async function responseError(response: Response): Promise<RuntimeClientError> {
  let decoded: unknown;
  try {
    const bytes = await readBoundedBytes(response, MAX_ERROR_BYTES);
    decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return new RuntimeClientError('RUNTIME_UNAVAILABLE', response.status >= 500);
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    return new RuntimeClientError('RUNTIME_UNAVAILABLE', response.status >= 500);
  }
  const code = 'code' in decoded && typeof decoded.code === 'string' && SAFE_ERROR_CODE.test(decoded.code)
    ? decoded.code
    : 'RUNTIME_UNAVAILABLE';
  const retryable = 'retryable' in decoded && typeof decoded.retryable === 'boolean'
    ? decoded.retryable
    : response.status >= 500;
  return new RuntimeClientError(code, retryable);
}

async function readBoundedBytes(response: Response, maximum: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maximum) throw new RuntimeClientError('BRIDGE_RESPONSE_TOO_LARGE', true);
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function isNdjson(value: string | null): boolean {
  return value !== null && /^application\/x-ndjson(?:\s*;\s*charset=utf-8)?$/iu.test(value.trim());
}

function parseBridgeBaseUrl(raw: string): URL {
  const url = new URL(raw);
  if (
    url.protocol !== 'http:'
    || (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost')
    || url.username
    || url.password
    || (url.pathname !== '/' && url.pathname !== '')
    || url.search
    || url.hash
  ) {
    throw new Error('Runtime Bridge 必须使用 localhost HTTP 根地址');
  }
  url.pathname = '/';
  return url;
}
