import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SerialAdapter, type SerialPortLike } from '../../packages/client-core/serial.ts';
import { Connection } from '../../packages/client-core/connection.ts';
import { FrameDecoder, encodeFrame } from '../../packages/protocol/framing.ts';
import { decodeMessage, encodeMessage, type Message } from '../../packages/protocol/messages.ts';
import { ConfigDevice } from './config-device.ts';
import { deviceCapabilities } from './capabilities.ts';

const settle = () => new Promise<void>(resolve => setImmediate(resolve));

function setup(device = new ConfigDevice()) {
  let now = 0;
  let tick: (() => void) | undefined;
  let dropResults = 0;
  let dropEvents = false;
  let identity = 'device-A';
  const requests: Message[] = [];
  const adapter = new SerialAdapter(new Connection('client-A'), {
    now: () => now,
    schedule(callback) { tick = callback; return () => { tick = undefined; }; },
  });
  function port(): SerialPortLike {
    let input!: ReadableStreamDefaultController<Uint8Array>;
    const decoder = new FrameDecoder();
    const reply = (message: Message) => input.enqueue(encodeFrame(encodeMessage(message)));
    return {
      readable: new ReadableStream({ start(controller) { input = controller; } }),
      writable: new WritableStream({ write(bytes) {
        decoder.feed(bytes, payload => {
          const message = decodeMessage(payload);
          requests.push(message);
          const link = message.link;
          if (message.type === 'hello') {
            reply({ type: 'welcome', link, device: identity, boot: device.boot, minVersion: 1, maxVersion: 1,
              ...deviceCapabilities, receiptCapacity: device.capacity, ownerCapacity: device.ownerCapacity,
              ownerAdmitted: message.owner && device.admit(message.owner) ? 1 : 0 });
          } else if (message.type === 'sync') {
            reply({ type: 'snapshot', link, boot: device.boot, request: message.request,
              sequence: device.revision, revision: device.revision,
              region: device.config.region, label: device.config.label } as Message);
          } else if (message.type === 'ping') {
            reply({ type: 'pong', link, boot: device.boot, request: message.request });
          } else if (message.type === 'configure') {
            const before = device.commits;
            const result = device.apply({ id: message.id, boot: message.boot,
              expectedRevision: message.expectedRevision,
              config: { region: message.region, label: message.label } });
            if (!dropEvents && device.commits > before) reply({ type: 'event', link, boot: device.boot,
              sequence: device.revision, revision: device.revision,
              region: device.config.region, label: device.config.label } as Message);
            if (dropResults) dropResults--;
            else reply({ type: 'result', link, ...result } as Message);
          } else if (message.type === 'query') {
            reply({ type: 'result', link, ...device.query(message.id), revision: device.revision } as Message);
          }
        });
      } }),
      async open() {}, async close() {},
    };
  }
  const connect = async (link: string) => { await adapter.connect(port(), link); await settle(); };
  const advance = async (time: number) => { now = time; tick?.(); await settle(); };
  return { adapter, device, requests, connect, advance,
    drop(results: number, events = false) { dropResults = results; dropEvents = events; },
    setIdentity(value: string) { identity = value; },
  };
}
const config = { region: 'US', label: 'new config' };

test('full USB configuration path commits and reconciles when the change event is lost', async t => {
  const f = setup();
  t.after(() => f.adapter.disconnect());
  await f.connect('link-A');
  f.drop(0, true);
  const id = f.adapter.configure(config);
  await settle();
  assert.equal(f.adapter.connection.commands.status(id).outcome, 'committed');
  assert.equal(f.adapter.connection.sync.state, 'ready');
  assert.equal(f.adapter.connection.sync.config?.label, config.label);
  assert.equal(f.requests.filter(message => message.type === 'sync').length, 2);
});

test('full USB path retries lost results without duplicating a device commit', async t => {
  const f = setup();
  t.after(() => f.adapter.disconnect());
  await f.connect('link-A');
  f.drop(1);
  const id = f.adapter.configure(config);
  await settle();
  assert.equal(f.adapter.connection.commands.status(id).outcome, 'pending');
  await f.advance(1000);
  assert.equal(f.device.commits, 1);
  assert.equal(f.adapter.connection.commands.status(id).outcome, 'committed');
  const commands = f.requests.filter(message => message.type === 'configure');
  assert.equal(commands.length, 2);
  assert.equal(commands[0].id, commands[1].id);
});

test('disconnect after commit recovers by query on the new link without mutation replay', async t => {
  const f = setup();
  t.after(() => f.adapter.disconnect());
  await f.connect('link-A');
  f.drop(1, true);
  const id = f.adapter.configure(config);
  await settle();
  await f.adapter.disconnect();
  assert.equal(f.adapter.connection.commands.status(id).outcome, 'unknown');
  await f.connect('link-B');
  assert.equal(f.adapter.recover(id), true);
  await settle();
  assert.equal(f.adapter.connection.commands.status(id).outcome, 'committed');
  assert.equal(f.device.commits, 1);
  assert.deepEqual(f.requests.filter(message => message.link === 'link-B').map(message => message.type),
    ['hello', 'sync', 'query', 'sync']);
});

test('an evicted receipt remains unknown after resync without replaying the old change', async t => {
  const f = setup(new ConfigDevice(1));
  t.after(() => f.adapter.disconnect());
  await f.connect('link-A');
  f.drop(1, true);
  const id = f.adapter.configure(config);
  await settle();
  await f.adapter.disconnect();
  f.device.apply({ id: 'client-B:1', boot: f.device.boot, expectedRevision: 1,
    config: { ...config, label: 'later change' } });
  await f.connect('link-B');
  f.adapter.recover(id);
  await settle();
  assert.equal(f.adapter.connection.commands.status(id).outcome, 'unknown');
  assert.equal(f.adapter.connection.sync.config?.label, 'later change');
  assert.equal(f.requests.filter(message => message.type === 'configure').length, 1);
});

test('a reboot reconciles config without claiming a recoverable command receipt', async t => {
  const f = setup();
  t.after(() => f.adapter.disconnect());
  await f.connect('link-A');
  f.drop(1, true);
  const id = f.adapter.configure(config);
  await settle();
  await f.adapter.disconnect();
  f.device.reboot();
  await f.connect('link-B');
  assert.equal(f.adapter.recover(id), false);
  assert.equal(f.adapter.connection.sync.config?.label, config.label);
  assert.equal(f.adapter.connection.commands.status(id).outcome, 'unknown');
  assert.equal(f.requests.filter(message => message.type === 'query').length, 0);
});

test('recovery refuses a different device even if its boot identity collides', async t => {
  const f = setup();
  t.after(() => f.adapter.disconnect());
  await f.connect('link-A');
  f.drop(1, true);
  const id = f.adapter.configure(config);
  await settle();
  await f.adapter.disconnect();
  f.setIdentity('device-B');
  await f.connect('link-B');
  assert.throws(() => f.adapter.recover(id), /another device/);
});

test('revision conflict over USB refreshes authoritative state', async t => {
  const f = setup();
  t.after(() => f.adapter.disconnect());
  await f.connect('link-A');
  f.device.apply({ id: 'client-B:1', boot: f.device.boot, expectedRevision: 0,
    config: { ...config, label: 'other client' } });
  const id = f.adapter.configure(config);
  await settle();
  assert.equal(f.adapter.connection.commands.status(id).outcome, 'conflict');
  assert.equal(f.adapter.connection.sync.config?.label, 'other client');
  assert.equal(f.device.commits, 1);
});

test('malformed config never consumes command history or reaches USB', async t => {
  const f = setup();
  t.after(() => f.adapter.disconnect());
  await f.connect('link-A');
  assert.throws(() => f.adapter.configure({ ...config, label: 'bad\nlabel' }));
  const id = f.adapter.configure(config);
  assert.equal(id, 'client-A:1');
  await settle();
  assert.equal(f.device.commits, 1);
  f.adapter.connection.forget(id);
  assert.throws(() => f.adapter.connection.commands.status(id));
});

test('normal sequential use continues past both client and device receipt capacities', async t => {
  const f = setup();
  t.after(() => f.adapter.disconnect());
  await f.connect('link-A');
  for (let i = 1; i <= 40; i++) {
    const id = f.adapter.configure({ ...config, label: `change ${i}` });
    await settle();
    assert.equal(f.adapter.connection.commands.status(id).outcome, 'committed');
    assert.equal(f.adapter.connection.sync.state, 'ready');
    f.adapter.connection.forget(id);
  }
  assert.equal(f.device.commits, 40);
  assert.equal(f.adapter.connection.sync.config?.label, 'change 40');
  assert.equal(f.device.query('client-A:1').outcome, 'unknown');
});
