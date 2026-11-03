import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  decodeMap,
  encodeMap,
  validateMapItem,
  type MapItem,
  type MapOperation,
} from '../../packages/protocol/map-item.ts';
import { MapStore, MAP_STORE_KEY, type SharedPayload } from '../../agents/web/map-store.ts';
import { parsePlugin, availableTypes } from '../../agents/web/plugins.ts';
import { EncryptionVault } from '../../agents/web/encryption.ts';
class Memory {
  data = new Map<string, string>();
  fail = false;
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.fail) throw Error('quota');
    this.data.set(key, value);
  }
}
const item = (revision = 1): MapItem => ({
  id: '11223344-1122-3344-5566-112233445566',
  revision,
  geometry: 'point',
  type: 'core/point',
  color: '#abcdef',
  name: 'Meeting point',
  note: 'Approach from east',
  coordinates: [900000000, 1800000000],
  metadata: {},
});
const operation = (revision = 1): MapOperation => ({ operation: 'put', item: item(revision) });
const payload = (op: MapOperation, origin = 'node-0000000000000001'): SharedPayload => ({
  origin,
  channel: 0,
  destination: 'broadcast',
  text: encodeMap(op),
});
test('map point/rectangle envelopes are bounded UTF-8 and ordinary text is untouched', () => {
  assert.equal(decodeMap('hello map'), undefined);
  assert.deepEqual(decodeMap(encodeMap(operation()))?.item.coordinates, [900000000, 1800000000]);
  const area = {
    ...item(),
    geometry: 'rectangle' as const,
    coordinates: [910000000, 1790000000, 890000000, 1810000000],
  };
  assert.deepEqual(
    decodeMap(encodeMap({ operation: 'put', item: area }))?.item.coordinates,
    area.coordinates,
  );
  for (const changed of [
    { ...area, coordinates: [890000000, 1790000000, 910000000, 1810000000] },
    { ...item(), coordinates: [900000000, 3600000001] },
    { ...item(), note: '📻'.repeat(41) },
    { ...item(), metadata: JSON.parse('{"__proto__":"x"}') },
    { ...item(), revision: 0 },
  ])
    assert.throws(() => validateMapItem(changed));
  assert.throws(() => decodeMap('RMAP1:{"operation":"execute"}'));
  assert.throws(() => encodeMap(operation(), 20), /budget/);
  assert.ok(
    Buffer.byteLength(
      encodeMap({
        operation: 'put',
        item: { ...area, name: 'n'.repeat(48), note: 'a'.repeat(160) },
      }),
    ) < 950,
  );
});
test('shared items require approval; stale, duplicate, and conflicting revisions cannot resurrect or replace accepted data', () => {
  const memory = new Memory(),
    store = new MapStore(memory, () => true),
    first = operation();
  assert.equal(store.receive(first, payload(first)), true);
  const key = store.state.shared[0].key;
  assert.equal(store.state.shared[0].accepted, undefined);
  store.decide(key, 1, true, first);
  const second = operation(2);
  second.item.note = 'New position';
  store.receive(second, payload(second));
  assert.equal(
    (store.state.shared[0].accepted as SharedPayload | undefined)?.text,
    encodeMap(first),
  );
  assert.throws(() => store.decide(key, 1, true, first), /changed/);
  assert.equal(store.receive(first, payload(first)), false);
  const conflicting = operation(2);
  conflicting.item.name = 'Conflict';
  assert.equal(store.receive(conflicting, payload(conflicting)), false);
  store.decide(key, 2, false, second);
  assert.equal(
    (store.state.shared[0].accepted as SharedPayload | undefined)?.text,
    encodeMap(first),
  );
  const withdrawn: MapOperation = { operation: 'withdraw', item: item(3) };
  store.receive(withdrawn, payload(withdrawn));
  assert.ok(store.state.shared[0].accepted);
  store.decide(key, 3, true, withdrawn);
  assert.equal(store.state.shared[0].accepted, undefined);
  const restored = new MapStore(memory, () => true);
  assert.equal(restored.receive(first, payload(first)), false);
  restored.receive(first, payload(first, 'node-0000000000000002'));
  assert.equal(restored.state.shared.length, 2);
});
test('map and plugin writes are atomic and honor the browser writer lock', () => {
  const memory = new Memory();
  let writable = true;
  const store = new MapStore(memory, () => writable);
  store.save(item());
  const before = memory.getItem(MAP_STORE_KEY);
  memory.fail = true;
  assert.throws(() => store.save(item(2)), /quota/);
  assert.equal(store.state.local[0].revision, 1);
  assert.equal(memory.getItem(MAP_STORE_KEY), before);
  memory.fail = false;
  writable = false;
  assert.throws(() => store.remove(item().id), /tab/);
  assert.equal(store.state.local.length, 1);
  writable = true;
  assert.throws(() => store.save(item()), /changed/);
  store.remove(item().id);
  assert.equal(store.state.local.length, 0);
});
test('plugins install, persist settings, disable, update atomically and uninstall without losing map items', () => {
  const plugin = parsePlugin(
    readFileSync('examples/agents/web/plugins/field-survey/field-survey.json', 'utf8'),
  );
  const memory = new Memory(),
    store = new MapStore(memory, () => true);
  store.install(plugin);
  assert.ok(availableTypes(store.state.plugins).some(t => t.id === plugin.id + '/observation'));
  store.save({ ...item(), type: plugin.id + '/observation', metadata: { condition: 'Good' } });
  store.plugin(plugin.id, 'settings', { 'show-labels': false });
  store.install({ ...plugin, version: '1.1.0' });
  assert.equal(store.state.plugins[0].settings['show-labels'], false);
  const incompatible = structuredClone(plugin);
  incompatible.settings[0].type = 'number';
  assert.throws(() => store.install(incompatible));
  assert.equal(store.state.plugins[0].manifest.version, '1.1.0');
  store.plugin(plugin.id, 'toggle');
  assert.ok(!availableTypes(store.state.plugins).some(t => t.id.startsWith(plugin.id)));
  assert.equal(new MapStore(memory, () => true).state.local[0].metadata.condition, 'Good');
  store.plugin(plugin.id, 'remove');
  assert.equal(store.state.plugins.length, 0);
  assert.equal(store.state.local.length, 1);
  for (const changed of [
    { ...plugin, script: 'alert(1)' },
    { ...plugin, manifestVersion: 2 },
    { ...plugin, id: 'core' },
    { ...plugin, types: [plugin.types[0], plugin.types[0]] },
  ])
    assert.throws(() => parsePlugin(JSON.stringify(changed)));
});
test('encrypted map sharing uses existing text encryption and persists only ciphertext until acceptance', () => {
  const left = new EncryptionVault(new Memory());
  left.unlock('long test password', 'long test password');
  left.generate(0);
  const right = new EncryptionVault(new Memory());
  right.unlock('another test password', 'another test password');
  right.importBundle(left.exportBundle(0), 0);
  const wire = encodeMap(operation(), 950),
    bytes = left.encrypt(wire, 0, 'node-0000000000000001', 'broadcast');
  const decrypted = right.decrypt(bytes, 0, 'node-0000000000000001', 'broadcast', 'rx-1');
  assert.equal(decrypted.state, 'decrypted');
  const op = decodeMap(decrypted.text!)!,
    memory = new Memory(),
    store = new MapStore(memory, () => true);
  const incoming: SharedPayload = {
    origin: 'node-0000000000000001',
    channel: 0,
    destination: 'broadcast',
    ciphertext: Buffer.from(bytes).toString('hex'),
  };
  store.receive(op, incoming);
  store.decide(store.state.shared[0].key, 1, true, op);
  assert.ok(!memory.getItem(MAP_STORE_KEY)!.includes('Meeting point'));
  assert.ok(!memory.getItem(MAP_STORE_KEY)!.includes('Approach from east'));
  right.lock();
  assert.equal(right.decrypt(bytes, 0, incoming.origin, 'broadcast').state, 'locked');
  assert.equal(
    new MapStore(memory, () => true).state.shared[0].accepted?.ciphertext,
    incoming.ciphertext,
  );
});

test('fragmented agent inbox map retrieval remains query-only and produces a pending item', async () => {
  const { InboxReader } = await import('../../packages/agent-core/inbox.ts');
  const context = { device: 'node-A', boot: 'boot-A', session: 1 },
    reader = new InboxReader();
  const wire = encodeMap(operation()),
    bytes = Buffer.from(wire),
    count = Math.ceil(bytes.length / 32);
  const head = reader.tick(0, context)!;
  assert.equal(head.type, 'inboxQuery');
  reader.receive(
    1,
    {
      type: 'inboxHead',
      link: 'link',
      boot: 'boot-A',
      request: head.request,
      oldest: 1,
      latest: 1,
    },
    0,
  );
  for (let part = 0; part < count; part++) {
    const request = reader.tick(0, context)!;
    assert.equal(request.type, 'inboxRead');
    reader.receive(
      1,
      {
        type: 'inboxItem',
        link: 'link',
        boot: 'boot-A',
        request: request.request,
        sequence: 1,
        origin: 'node-0000000000000001',
        destination: 'broadcast',
        channel: 0,
        messageId: 'remote_1',
        part,
        count,
        data: bytes.subarray(part * 32, (part + 1) * 32).toString('hex'),
      },
      0,
    );
    assert.equal(reader.history.length, part === count - 1 ? 1 : 0);
  }
  const incoming = reader.history[0],
    store = new MapStore(new Memory(), () => true);
  store.receive(decodeMap(incoming.text)!, {
    origin: incoming.origin,
    channel: incoming.channel,
    destination: incoming.destination!,
    text: incoming.text,
  });
  assert.ok(store.state.shared[0].pending);
  assert.equal(store.state.shared[0].accepted, undefined);
  assert.equal(store.receive(operation(), payload(operation())), false);
});

test('message-card actions distinguish new, accepted, updated, withdrawn and superseded items', async () => {
  const { mapMessageAction } = await import('../../agents/web/map-message.ts');
  const store = new MapStore(new Memory(), () => true),
    first = operation();
  assert.deepEqual(mapMessageAction(first), { label: 'Add to map', actionable: true });
  store.receive(first, payload(first));
  const key = store.state.shared[0].key;
  assert.equal(mapMessageAction(first, store.state.shared[0]).label, 'Add to map');
  store.decide(key, 1, true, first);
  assert.deepEqual(mapMessageAction(first, store.state.shared[0], 1), {
    label: 'Added to map',
    actionable: false,
  });
  const second = operation(2);
  store.receive(second, payload(second));
  assert.equal(mapMessageAction(second, store.state.shared[0], 1).label, 'Update on map');
  assert.equal(mapMessageAction(first, store.state.shared[0], 1).actionable, false);
  const withdrawal: MapOperation = { operation: 'withdraw', item: item(3) };
  store.receive(withdrawal, payload(withdrawal));
  assert.equal(mapMessageAction(withdrawal, store.state.shared[0], 1).label, 'Remove from map');
  store.decide(key, 3, true, withdrawal);
  assert.deepEqual(mapMessageAction(withdrawal, store.state.shared[0]), {
    label: 'Not on map',
    actionable: false,
  });
});

test('deleting received chat history preserves accepted map items and replay barriers', async () => {
  const { InboxReader } = await import('../../packages/agent-core/inbox.ts');
  const inbox = new InboxReader(),
    memory = new Memory(),
    store = new MapStore(memory, () => true),
    op = operation();
  inbox.restoreHistory([
    {
      device: 'node-A',
      boot: 'boot-A',
      sequence: 1,
      origin: 'node-0000000000000001',
      destination: 'broadcast',
      messageId: 'remote_1',
      channel: 0,
      text: encodeMap(op),
    },
  ]);
  store.receive(op, payload(op));
  const key = store.state.shared[0].key;
  store.decide(key, 1, true, op);
  inbox.forget('node-A', 'node-0000000000000001', 'remote_1');
  assert.equal(inbox.history.length, 0);
  const restored = new MapStore(memory, () => true);
  assert.equal(restored.state.shared[0].accepted?.text, encodeMap(op));
  assert.equal(restored.receive(op, payload(op)), false);
});
