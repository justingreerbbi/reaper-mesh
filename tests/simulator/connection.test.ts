import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Connection } from '../../packages/client-core/connection.ts';
import { FrameDecoder, encodeFrame } from '../../packages/protocol/framing.ts';
import { decodeMessage, encodeMessage, type Message } from '../../packages/protocol/messages.ts';
import { deviceCapabilities } from './capabilities.ts';

const wire = (message: Message) => encodeFrame(encodeMessage(message));
const welcome = (link = 'link-A', boot = 'boot-A'): Extract<Message, { type: 'welcome' }> =>
  ({ type: 'welcome', link, boot, device: 'device-A', minVersion: 1, maxVersion: 1, ...deviceCapabilities });
function outgoing(connection: Connection): Message[] {
  const result: Message[] = [];
  const decoder = new FrameDecoder();
  for (const frame of connection.drain()) decoder.feed(frame, payload => result.push(decodeMessage(payload)));
  return result;
}
function setup() {
  const connection = new Connection();
  const session = connection.open('link-A', 0);
  const deliver = (message: Message, now = 0) => connection.receive(session, wire(message), now);
  outgoing(connection);
  const negotiate = (now = 0) => {
    deliver(welcome(), now);
    return outgoing(connection)[0] as Extract<Message, { type: 'sync' }>;
  };
  const snapshot = (request: number, sequence = 0): Message => ({
    type: 'snapshot', link: 'link-A', boot: 'boot-A', request, sequence, revision: sequence,
    region: 'US', label: `revision-${sequence}`,
  });
  const ready = () => { const request = negotiate(); deliver(snapshot(request.request)); };
  return { connection, session, deliver, negotiate, snapshot, ready };
}

test('simulated serial handshake gates readiness until the correlated snapshot', () => {
  const { connection, negotiate, deliver, snapshot } = setup();
  assert.equal(connection.sync.state, 'negotiating');
  const request = negotiate();
  assert.equal(connection.device, 'device-A');
  assert.equal(connection.sync.state, 'synchronizing');
  deliver(snapshot(request.request + 1));
  assert.equal(connection.sync.state, 'synchronizing');
  deliver(snapshot(request.request));
  assert.equal(connection.sync.state, 'ready');
});

test('old local callbacks and old wire link identities cannot negotiate a new connection', () => {
  const { connection, session } = setup();
  const current = connection.open('link-B', 1);
  outgoing(connection);
  connection.receive(session, wire(welcome('link-B')), 2);
  connection.receive(current, wire(welcome('link-A')), 2);
  assert.equal(connection.sync.state, 'negotiating');
  connection.receive(current, wire(welcome('link-B')), 2);
  assert.equal(connection.sync.state, 'synchronizing');
  assert.throws(() => connection.open('link-A', 3));
});

test('event gap issues a fresh sync request and stale snapshots cannot roll state back', () => {
  const { connection, deliver, snapshot, ready } = setup();
  ready();
  deliver({ type: 'event', link: 'link-A', boot: 'boot-A', sequence: 1, revision: 1, region: 'US', label: 'one' });
  deliver({ type: 'event', link: 'link-A', boot: 'boot-A', sequence: 3, revision: 3, region: 'US', label: 'three' });
  const request = outgoing(connection)[0] as Extract<Message, { type: 'sync' }>;
  deliver(snapshot(request.request, 0));
  assert.equal(connection.sync.state, 'synchronizing');
  const retry = outgoing(connection)[0] as Extract<Message, { type: 'sync' }>;
  assert.ok(retry.request > request.request);
  deliver(snapshot(retry.request, 3));
  assert.equal(connection.sync.state, 'ready');
  assert.equal(connection.sync.revision, 3);
});

test('partial frames plus invalid payload do not prevent a subsequent valid handshake', () => {
  const { connection, session } = setup();
  const valid = wire(welcome());
  connection.receive(session, encodeFrame(Uint8Array.of(1, 255)), 1);
  for (const byte of valid) connection.receive(session, Uint8Array.of(byte), 1);
  assert.equal(connection.sync.state, 'synchronizing');
});

test('negotiation and synchronization have independent fixed deadlines', () => {
  const { connection, negotiate } = setup();
  negotiate(4999);
  connection.tick(5000);
  assert.equal(connection.sync.state, 'synchronizing');
  connection.tick(9999);
  assert.equal(connection.sync.state, 'disconnected');
  assert.match(connection.error!, /timed out/);
});

test('garbage or stale traffic cannot keep negotiation alive', () => {
  const { connection, session } = setup();
  connection.receive(session, wire(welcome('wrong-link')), 4999);
  connection.tick(5000);
  assert.equal(connection.sync.state, 'disconnected');
  assert.deepEqual(connection.drain(), []);
});

test('only correlated pong satisfies health checks; reboot closes the connection', () => {
  const { connection, ready, deliver } = setup();
  ready();
  connection.tick(2000);
  const ping = outgoing(connection)[0] as Extract<Message, { type: 'ping' }>;
  deliver({ type: 'pong', link: 'link-A', boot: 'boot-A', request: ping.request + 1 }, 2100);
  deliver({ type: 'pong', link: 'link-A', boot: 'boot-A', request: ping.request }, 2200);
  connection.tick(4200);
  const next = outgoing(connection)[0] as Extract<Message, { type: 'ping' }>;
  deliver({ type: 'pong', link: 'link-A', boot: 'boot-B', request: next.request }, 4300);
  assert.equal(connection.sync.state, 'disconnected');
  assert.match(connection.error!, /rebooted/);
});

test('continuous events do not conceal a missing health response', () => {
  const { connection, ready, deliver } = setup();
  ready();
  connection.tick(2000);
  outgoing(connection);
  deliver({ type: 'event', link: 'link-A', boot: 'boot-A', sequence: 1, revision: 1, region: 'US', label: 'one' }, 6999);
  connection.tick(7000);
  assert.equal(connection.sync.state, 'disconnected');
});

test('a snapshot delivered at the deadline loses deterministically to timeout', () => {
  const { connection, negotiate, deliver, snapshot } = setup();
  const request = negotiate();
  deliver(snapshot(request.request), 5000);
  assert.equal(connection.sync.state, 'disconnected');
});

test('incompatible peer is visible without issuing configuration requests', () => {
  const { connection, deliver } = setup();
  deliver({ ...welcome(), minVersion: 2, maxVersion: 2 } as Message);
  assert.equal(connection.sync.state, 'incompatible');
  assert.deepEqual(outgoing(connection), []);
});

test('undrained outgoing work is bounded and overflow closes cleanly', () => {
  const { connection, ready, deliver, snapshot } = setup();
  ready();
  deliver({ type: 'event', link: 'link-A', boot: 'boot-A', sequence: 2, revision: 2, region: 'US', label: 'gap' });
  // Wrong revision snapshots trigger repeated resync once a higher revision is established.
  const request = outgoing(connection)[0] as Extract<Message, { type: 'sync' }>;
  deliver(snapshot(request.request, 2));
  deliver({ type: 'event', link: 'link-A', boot: 'boot-A', sequence: 4, revision: 4, region: 'US', label: 'gap' });
  for (let i = 0; i < 9; i++) deliver(snapshot(connection.sync.snapshotRequest, 0));
  assert.equal(connection.sync.state, 'disconnected');
  assert.match(connection.error!, /queue full/);
  assert.deepEqual(connection.drain(), []);
});

test('closing drops partial frames and all queued writes', () => {
  const { connection, session } = setup();
  connection.receive(session, wire(welcome()).subarray(0, 5), 1);
  connection.close();
  assert.equal(connection.sync.config, undefined);
  assert.deepEqual(connection.drain(), []);
});

test('duplicate and wrong-boot results cannot repeatedly trigger resynchronization', () => {
  const { connection, ready, deliver, snapshot } = setup();
  ready();
  const id = connection.configure({ region: 'US', label: 'updated' }, 0);
  outgoing(connection);
  deliver({ type: 'result', link: 'link-A', boot: 'old-boot', id, outcome: 'committed', revision: 1 });
  assert.equal(connection.commands.status(id).outcome, 'pending');
  assert.deepEqual(outgoing(connection), []);
  const result: Message = { type: 'result', link: 'link-A', boot: 'boot-A', id, outcome: 'committed', revision: 1 };
  deliver(result);
  const sync = outgoing(connection)[0] as Extract<Message, { type: 'sync' }>;
  deliver(snapshot(sync.request, 1));
  assert.equal(connection.sync.state, 'ready');
  deliver(result);
  assert.equal(connection.sync.state, 'ready');
  assert.deepEqual(outgoing(connection), []);
});

test('explicit storage failure ends the logical connection instead of serving stale state', () => {
  const { connection, ready, deliver } = setup();
  ready();
  deliver({ type: 'error', link: 'link-A', boot: 'old-boot', code: 'storage-unavailable' });
  assert.equal(connection.sync.state, 'ready');
  deliver({ type: 'error', link: 'link-A', boot: 'boot-A', code: 'storage-unavailable' });
  assert.equal(connection.sync.state, 'disconnected');
  assert.equal(connection.sync.config, undefined);
  assert.match(connection.error!, /storage unavailable/);
});


test('lost startup hello retries with the same identity and converges after board boot', () => {
  const { connection, deliver, snapshot } = setup();
  connection.tick(499); assert.deepEqual(outgoing(connection), []);
  connection.tick(500);
  const retry = outgoing(connection);
  assert.equal(retry.length, 1); assert.equal(retry[0].type, 'hello');
  connection.tick(2000); // No catch-up burst after a suspended scheduler.
  assert.deepEqual(outgoing(connection), retry);
  deliver(welcome(), 2000);
  const request = outgoing(connection)[0] as Extract<Message, { type: 'sync' }>;
  deliver(snapshot(request.request), 2000);
  connection.tick(2500); assert.deepEqual(outgoing(connection), []);
  assert.equal(connection.sync.state, 'ready');
});

test('startup retries remain bounded under stalled writes and the original deadline', () => {
  const { connection } = setup();
  connection.tick(500);
  connection.tick(1000); connection.tick(4500);
  assert.equal(outgoing(connection).length, 1);
  connection.tick(5000);
  assert.equal(connection.sync.state, 'disconnected');
  assert.deepEqual(outgoing(connection), []);
  assert.match(connection.error!, /timed out/);
});

test('welcome racing a queued discovery retry retires it before sync', () => {
  const { connection, deliver } = setup();
  connection.tick(500);
  deliver(welcome(), 500);
  assert.deepEqual(outgoing(connection).map(message => message.type), ['sync']);
});

test('config receipt resync preserves accepted messages and resumes query-only polling', () => {
  const { connection, deliver, snapshot } = setup();
  deliver({ ...welcome(), features: 31, messageVersion: 1, maxMessageBytes: 1024, messageCapacity: 8 });
  const initial = outgoing(connection)[0] as Extract<Message, { type: 'sync' }>;
  deliver(snapshot(initial.request));
  const message = connection.sendMessage('hello', 'broadcast', 0, 0); outgoing(connection);
  deliver({ type: 'messageStatus', link: 'link-A', boot: 'boot-A', id: message, state: 'queued', received: 1, messageId: 'boot-A_1' });
  const config = connection.configure({ region: 'US', label: 'changed' }, 0); outgoing(connection);
  deliver({ type: 'result', link: 'link-A', boot: 'boot-A', id: config, outcome: 'committed', revision: 1 });
  assert.equal(connection.messaging.history[0].state, 'queued');
  const resync = outgoing(connection)[0] as Extract<Message, { type: 'sync' }>;
  deliver(snapshot(resync.request, 1));
  connection.tick(2000);
  const packets = outgoing(connection);
  assert.equal(packets.filter(packet => packet.type === 'messageQuery').length, 1);
  assert.equal(packets.filter(packet => packet.type === 'submit').length, 0);
});

test('radio diagnostics require an outstanding probe and matching authoritative revision', () => {
  const { connection, deliver, snapshot } = setup();
  deliver({ ...welcome(), features: 39 }); const initial = outgoing(connection)[0] as Extract<Message, { type: 'sync' }>;
  deliver(snapshot(initial.request)); connection.tick(0);
  const request = outgoing(connection)[0] as Extract<Message, { type: 'radioQuery' }>;
  const info: Extract<Message, { type: 'radioStatus' }> = { type: 'radioStatus', link: 'link-A', boot: 'boot-A', request: request.request,
    state: 'off', reason: 'radio-off', probe: 1, transmitted: 0, received: 0, revision: 0, heapFree: 200000, stackFree: 10000 };
  deliver({ ...info, request: 0 }); assert.equal(connection.radioInfo, undefined);
  deliver({ ...info, revision: 1 }); assert.equal(connection.radioInfo, undefined);
  const currentInfo = () => connection.radioInfo;
  deliver(info); assert.equal(currentInfo()?.probe, 1);
  deliver({ ...info, state: 'fault' }); assert.equal(currentInfo()?.state, 'off');
  const id = connection.configure({ region: 'US', label: 'changed' }, 0); outgoing(connection);
  deliver({ type: 'result', link: 'link-A', boot: 'boot-A', id, outcome: 'committed', revision: 1 });
  assert.equal(connection.radioInfo, undefined);
});

test('radio diagnostic retries stop after three unanswered probes without hiding USB health', () => {
  const { connection, deliver, snapshot } = setup();
  deliver({ ...welcome(), features: 39 }); const initial = outgoing(connection)[0] as Extract<Message, { type: 'sync' }>;
  deliver(snapshot(initial.request)); let probes = 0;
  for (const now of [0, 2000, 3000, 5000, 6000, 8000, 9000]) {
    connection.tick(now);
    for (const packet of outgoing(connection)) {
      if (packet.type === 'radioQuery') probes++;
      if (packet.type === 'ping') deliver({ type: 'pong', link: 'link-A', boot: 'boot-A', request: packet.request }, now);
    }
  }
  assert.equal(probes, 3); assert.equal(connection.sync.state, 'ready'); assert.match(connection.radioError!, /timed out/);
});
