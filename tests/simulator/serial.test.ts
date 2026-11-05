import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SerialAdapter, type SerialPortLike } from '../../packages/agent-core/serial.ts';
import { FrameDecoder, encodeFrame } from '../../packages/protocol/framing.ts';
import { decodeMessage, encodeMessage, type Message } from '../../packages/protocol/messages.ts';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
// Drain microtasks and stream callbacks without elapsed-time sleeps.
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

function fixture(options: { blockOpen?: boolean; blockWrite?: boolean; failClose?: boolean } = {}) {
  const opened = deferred();
  const writeGate = deferred();
  let input!: ReadableStreamDefaultController<Uint8Array>;
  let tick: (() => void) | undefined;
  let now = 0;
  let cancelled = 0,
    aborted = 0,
    closed = 0;
  const writes: Uint8Array[] = [];
  const listeners = new Set<() => void>();
  const port: SerialPortLike = {
    readable: new ReadableStream({
      start(controller) {
        input = controller;
      },
      cancel() {
        cancelled++;
      },
    }),
    writable: new WritableStream({
      async write(bytes) {
        writes.push(bytes.slice());
        if (options.blockWrite) await writeGate.promise;
      },
      abort() {
        aborted++;
      },
    }),
    async open() {
      if (options.blockOpen) await opened.promise;
    },
    async close() {
      assert.equal(port.readable?.locked, false);
      assert.equal(port.writable?.locked, false);
      if (options.failClose) throw new Error('close failure');
      closed++;
    },
    addEventListener(_type, listener) {
      listeners.add(listener);
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener);
    },
  };
  const adapter = new SerialAdapter(undefined, {
    now: () => now,
    schedule(callback) {
      tick = callback;
      return () => {
        tick = undefined;
      };
    },
  });
  const send = (message: Message) => input.enqueue(encodeFrame(encodeMessage(message)));
  const messages = () => {
    const result: Message[] = [];
    const decoder = new FrameDecoder();
    for (const write of writes) decoder.feed(write, bytes => result.push(decodeMessage(bytes)));
    return result;
  };
  return {
    adapter,
    port,
    opened,
    writeGate,
    writes,
    send,
    messages,
    end: () => input.close(),
    failRead: () => input.error(new Error('unplugged')),
    remove: () => {
      for (const listener of listeners) listener();
    },
    advance(value: number) {
      now = value;
      tick?.();
    },
    stats: () => ({ cancelled, aborted, closed, listeners: listeners.size, ticking: !!tick }),
  };
}
const welcome: Message = {
  type: 'welcome',
  link: 'link-A',
  device: 'device-A',
  boot: 'boot-A',
  minVersion: 1,
  maxVersion: 1,
};

test('adapter carries handshake and snapshot over actual stream interfaces', async () => {
  const f = fixture();
  await f.adapter.connect(f.port, 'link-A');
  await settle();
  assert.equal(f.messages()[0].type, 'hello');
  f.send(welcome);
  await settle();
  const sync = f.messages().find(message => message.type === 'sync')!;
  assert.equal(sync.type, 'sync');
  f.send({
    type: 'snapshot',
    link: 'link-A',
    boot: 'boot-A',
    request: sync.request,
    sequence: 0,
    revision: 0,
    region: 'US',
    label: 'connected',
  });
  await settle();
  assert.equal(f.adapter.connection.sync.state, 'ready');
  assert.equal(f.adapter.connection.sync.config?.label, 'connected');
  await f.adapter.disconnect();
  assert.deepEqual(f.stats(), {
    cancelled: 1,
    aborted: 1,
    closed: 1,
    listeners: 0,
    ticking: false,
  });
  assert.equal(f.adapter.active, false);
});

test('disconnect during pending open invalidates it and closes only after it resolves', async () => {
  const f = fixture({ blockOpen: true });
  const opening = f.adapter.connect(f.port, 'link-A');
  const rejected = assert.rejects(opening, /cancelled/);
  const closing = f.adapter.disconnect();
  await assert.rejects(f.adapter.connect(f.port, 'link-B'), /cleaning up/);
  f.opened.resolve();
  await Promise.all([rejected, closing]);
  assert.equal(f.writes.length, 0);
  assert.equal(f.stats().closed, 1);
  assert.equal(f.adapter.active, false);
});

test('a failed open never starts I/O or closes a port it did not acquire', async () => {
  const f = fixture();
  f.port.open = async () => {
    throw new Error('port busy');
  };
  await assert.rejects(f.adapter.connect(f.port, 'link-A'), /port busy/);
  assert.equal(f.stats().closed, 0);
  assert.equal(f.writes.length, 0);
  assert.equal(f.adapter.active, false);
});

test('read failure closes port and releases both locks', async () => {
  const f = fixture();
  await f.adapter.connect(f.port, 'link-A');
  f.failRead();
  await settle();
  await f.adapter.disconnect();
  assert.equal(f.stats().closed, 1);
  assert.equal(f.adapter.connection.error, 'serial read failed');
});

test('EOF and removal stop the adapter without reconnecting', async () => {
  for (const action of ['end', 'remove'] as const) {
    const f = fixture();
    await f.adapter.connect(f.port, 'link-A');
    f[action]();
    await settle();
    await f.adapter.disconnect();
    assert.equal(f.stats().closed, 1);
    assert.equal(f.stats().listeners, 0);
    assert.equal(f.adapter.connection.sync.state, 'disconnected');
  }
});

test('write failure discards remaining handshake frames', async () => {
  const f = fixture({ blockWrite: true });
  await f.adapter.connect(f.port, 'link-A');
  await settle();
  assert.equal(f.writes.length, 1);
  f.writeGate.reject(new Error('write failed'));
  await settle();
  await f.adapter.disconnect();
  assert.equal(f.writes.length, 1);
  assert.equal(f.stats().closed, 1);
  assert.equal(f.adapter.connection.error, 'serial write failed');
});

test('closing while a write is stalled prevents any subsequent batch writes', async () => {
  const f = fixture({ blockWrite: true });
  await f.adapter.connect(f.port, 'link-A');
  await settle();
  const closing = f.adapter.disconnect();
  assert.equal(f.adapter.connection.sync.state, 'disconnected');
  await assert.rejects(f.adapter.connect(f.port, 'link-B'), /cleaning up/);
  f.writeGate.resolve();
  await closing;
  assert.equal(f.writes.length, 1);
  assert.equal(f.stats().closed, 1);
});

test('timeout cancels pending read and clears timer', async () => {
  const f = fixture();
  await f.adapter.connect(f.port, 'link-A');
  f.advance(5000);
  await settle();
  assert.equal(f.adapter.active, false);
  assert.equal(f.stats().ticking, false);
  assert.equal(f.adapter.connection.error, 'connection timed out');
});

test('missing streams after successful open still close the acquired port', async () => {
  const f = fixture();
  f.port.readable = null;
  f.port.close = async () => {};
  await assert.rejects(f.adapter.connect(f.port, 'link-A'), /unavailable/);
  assert.equal(f.adapter.active, false);
});

test('port close failure is visible and prevents unsafe ownership reuse', async () => {
  const f = fixture({ failClose: true });
  await f.adapter.connect(f.port, 'link-A');
  await f.adapter.disconnect();
  assert.equal(f.adapter.active, true);
  assert.match(f.adapter.cleanupError!, /ownership remains blocked/);
  await assert.rejects(f.adapter.connect(f.port, 'link-B'), /cleaning up/);
});

test('reopening after cleanup sends only a fresh handshake to the next port', async () => {
  const first = fixture({ blockWrite: true });
  await first.adapter.connect(first.port, 'link-A');
  await settle();
  const closing = first.adapter.disconnect();
  first.writeGate.resolve();
  await closing;
  const second = fixture();
  await first.adapter.connect(second.port, 'link-B');
  await settle();
  assert.deepEqual(second.messages(), [
    {
      type: 'hello',
      link: 'link-B',
      minVersion: 1,
      maxVersion: 1,
      owner: first.adapter.connection.commands.incarnation,
      agentFeatures: 3,
    },
  ]);
  assert.equal(first.writes.length, 1);
  await first.adapter.disconnect();
  assert.equal(second.stats().closed, 1);
});
