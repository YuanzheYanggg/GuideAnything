import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { JsonRpcLineClient, RpcRequestError, type RpcChildTransport } from './json-rpc';

class FakeChild extends EventEmitter implements RpcChildTransport {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly killedWith: NodeJS.Signals[] = [];

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.killedWith.push(signal);
    if (signal === 'SIGTERM') queueMicrotask(() => this.emit('exit', 0, signal));
    return true;
  }
}

async function sentMessages(child: FakeChild, count: number): Promise<Record<string, unknown>[]> {
  const chunks: Buffer[] = [];
  child.stdin.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  while (Buffer.concat(chunks).toString('utf8').split('\n').filter(Boolean).length < count) {
    await once(child.stdin, 'data');
  }
  return Buffer.concat(chunks).toString('utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

describe('JsonRpcLineClient', () => {
  it('allocates monotonic ids and resolves out-of-order responses', async () => {
    const child = new FakeChild();
    const client = new JsonRpcLineClient(child, { defaultTimeoutMs: 1_000 });

    const first = client.request('first', { a: 1 });
    const second = client.request('second', { b: 2 });
    const sent = await sentMessages(child, 2);
    expect(sent.map(({ id }) => id)).toEqual([1, 2]);

    child.stdout.write('{"id":2,"result":{"order":"second"}}\n');
    child.stdout.write('{"id":1,"result":{"order":"first"}}\n');
    await expect(second).resolves.toEqual({ order: 'second' });
    await expect(first).resolves.toEqual({ order: 'first' });
    expect(client.pendingCount).toBe(0);
  });

  it('isolates malformed lines, dispatches notifications, and reports unknown or duplicate ids', async () => {
    const child = new FakeChild();
    const client = new JsonRpcLineClient(child, { defaultTimeoutMs: 1_000 });
    const notifications: unknown[] = [];
    const issues: string[] = [];
    client.onNotification((notification) => notifications.push(notification));
    client.onProtocolIssue((issue) => issues.push(issue.code));

    child.stdout.write('not-json\n');
    child.stdout.write('{"method":"turn/started","params":{"turnId":"turn-1"}}\n');
    child.stdout.write('{"id":999,"result":{}}\n');
    await new Promise((resolve) => setImmediate(resolve));

    expect(notifications).toEqual([{ method: 'turn/started', params: { turnId: 'turn-1' } }]);
    expect(issues).toEqual(['MALFORMED_LINE', 'UNKNOWN_RESPONSE_ID']);

    const request = client.request('once', {});
    const id = (await sentMessages(child, 1))[0]!.id;
    child.stdout.write(`${JSON.stringify({ id, result: { ok: true } })}\n`);
    await expect(request).resolves.toEqual({ ok: true });
    child.stdout.write(`${JSON.stringify({ id, result: { duplicate: true } })}\n`);
    await new Promise((resolve) => setImmediate(resolve));
    expect(issues.at(-1)).toBe('UNKNOWN_RESPONSE_ID');
  });

  it('rejects remote errors without preserving raw error text', async () => {
    const child = new FakeChild();
    const client = new JsonRpcLineClient(child, { defaultTimeoutMs: 1_000 });
    const request = client.request('fails', {});
    const id = (await sentMessages(child, 1))[0]!.id;

    child.stdout.write(`${JSON.stringify({ id, error: { code: -32_000, message: 'secret /private/path' } })}\n`);

    await expect(request).rejects.toMatchObject({ code: 'REMOTE_ERROR', rpcCode: -32_000 });
    await expect(request).rejects.not.toThrow('/private/path');
  });

  it('cleans pending requests on timeout and abort and treats late responses deterministically', async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const client = new JsonRpcLineClient(child, { defaultTimeoutMs: 50 });
    const issues: string[] = [];
    client.onProtocolIssue((issue) => issues.push(issue.code));

    const timedOut = client.request('slow', {});
    const controller = new AbortController();
    const aborted = client.request('abort', {}, { signal: controller.signal });
    const timedOutAssertion = expect(timedOut).rejects.toMatchObject({ code: 'TIMEOUT' });
    const abortedAssertion = expect(aborted).rejects.toMatchObject({ code: 'ABORTED' });
    const sent = await sentMessages(child, 2);
    controller.abort();
    await vi.advanceTimersByTimeAsync(51);

    await timedOutAssertion;
    await abortedAssertion;
    expect(client.pendingCount).toBe(0);

    for (const { id } of sent) child.stdout.write(`${JSON.stringify({ id, result: {} })}\n`);
    await vi.runAllTimersAsync();
    expect(issues).toEqual(['UNKNOWN_RESPONSE_ID', 'UNKNOWN_RESPONSE_ID']);
    vi.useRealTimers();
  });

  it('rejects every pending request exactly once when the process errors then exits', async () => {
    const child = new FakeChild();
    const client = new JsonRpcLineClient(child, { defaultTimeoutMs: 1_000 });
    const first = client.request('one', {});
    const second = client.request('two', {});
    const rejected = vi.fn();
    void first.catch(rejected);
    void second.catch(rejected);

    child.emit('error', new Error('spawn secret'));
    child.emit('exit', 1, null);

    await expect(first).rejects.toMatchObject({ code: 'PROCESS_EXITED' });
    await expect(second).rejects.toMatchObject({ code: 'PROCESS_EXITED' });
    expect(rejected).toHaveBeenCalledTimes(2);
    expect(client.pendingCount).toBe(0);
  });

  it('counts but never retains stderr payloads and bounds the counter', async () => {
    const child = new FakeChild();
    const client = new JsonRpcLineClient(child, {
      defaultTimeoutMs: 1_000,
      maxStderrBytes: 16,
    });

    child.stderr.write('bearer-secret-and-/private/path');
    await new Promise((resolve) => setImmediate(resolve));

    expect(client.getDiagnostics()).toEqual({ stderrBytes: 16, stderrTruncated: true });
    expect(JSON.stringify(client.getDiagnostics())).not.toContain('bearer-secret');
    expect(JSON.stringify(client)).not.toContain('bearer-secret');
  });

  it('refuses server requests and closes stdin before a bounded terminate fallback', async () => {
    const child = new FakeChild();
    const client = new JsonRpcLineClient(child, {
      defaultTimeoutMs: 1_000,
      closeTimeoutMs: 10,
    });
    const requests: string[] = [];
    client.onServerRequest((request) => requests.push(request.method));

    child.stdout.write('{"id":77,"method":"tool/requestUserInput","params":{"secret":"x"}}\n');
    await new Promise((resolve) => setImmediate(resolve));
    expect(requests).toEqual(['tool/requestUserInput']);
    const response = await sentMessages(child, 1);
    expect(response).toEqual([{ id: 77, error: { code: -32601, message: 'Client method is disabled' } }]);

    await client.close();
    expect(child.stdin.writableEnded).toBe(true);
    expect(child.killedWith).toEqual(['SIGTERM']);
  });

  it('rejects oversized protocol lines without processing their suffix as JSON', async () => {
    const child = new FakeChild();
    const client = new JsonRpcLineClient(child, { defaultTimeoutMs: 1_000, maxLineBytes: 32 });
    const issues: string[] = [];
    const notifications: unknown[] = [];
    client.onProtocolIssue((issue) => issues.push(issue.code));
    client.onNotification((notification) => notifications.push(notification));

    child.stdout.write(`${'x'.repeat(40)}{"method":"unsafe"}\n`);
    child.stdout.write('{"method":"safe","params":{}}\n');
    await new Promise((resolve) => setImmediate(resolve));

    expect(issues).toEqual(['LINE_TOO_LARGE']);
    expect(notifications).toEqual([{ method: 'safe', params: {} }]);
  });

  it('exposes typed local failures', () => {
    expect(new RpcRequestError('ABORTED')).toMatchObject({ code: 'ABORTED' });
  });
});
