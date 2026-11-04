// Logic behind the portal's mobile-parity screens: channel codes, QR, geo, position and caches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { formatInvite } from '../../agents/web/channel-invite.ts';
import { parseChannelCode, planJoin, shareCodeFor } from '../../agents/web/channel-codes.ts';
import { EncryptionVault, parseKeyBundle } from '../../agents/web/encryption.ts';
import {
  bearingDegrees,
  distanceMeters,
  formatAgo,
  formatBearing,
  formatCoordinate,
  formatDistance,
  fromWire,
  pathLength,
  toWire,
} from '../../agents/web/geo.ts';
import { qrPath, qrPixels, readQr } from '../../agents/web/qr.ts';
import { MAX_FIX_AGE_MS, shouldSendPosition } from '../../agents/web/position-feed.ts';
import {
  FORGOTTEN_NODES_PREFIX,
  NODE_CACHE_PREFIX,
  NodeCache,
} from '../../agents/web/node-cache.ts';
import {
  DEFAULT_PREFERENCES,
  PREFERENCES_KEY,
  readPreferences,
  writePreferences,
} from '../../agents/web/preferences.ts';
import { forgetDevice, readDevices, rememberDevice } from '../../agents/web/remembered-devices.ts';
import { MapStore, MAP_STORE_KEY } from '../../agents/web/map-store.ts';
import { encodeMap } from '../../packages/protocol/map-item.ts';
import { channelList, withChannel } from '../../packages/protocol/radio-config.ts';
import { canDeleteConversation, deliveryOf } from '../../agents/web/conversations.ts';
import { saveConfig, settleCommands } from '../../agents/web/config-save.ts';
import { ConfigModel } from '../../agents/web/model.ts';
import { SerialAdapter } from '../../packages/agent-core/serial.ts';
import { FIELD_DEVICE_ID, FieldDevice } from '../../packages/simulator/field-device.ts';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const TEAM = { slot: 1, id: 0x9c41e2a7, name: 'Team' };
const PUBLIC = { slot: 0, id: 0, name: 'Public' };

test('a shared channel code round-trips through a real QR image, with its key', () => {
  const vault = new EncryptionVault(new MemoryStorage());
  vault.generate(TEAM.id);
  const code = shareCodeFor(TEAM, vault)!;
  const { data, width } = qrPixels(code, 6);
  assert.equal(readQr(data, width, width), code);
  const parsed = parseChannelCode(code);
  assert.equal(parsed.id, TEAM.id);
  assert.equal(parsed.name, 'Team');
  assert.equal(parsed.keyOnly, false);
  assert.equal(parsed.key, vault.exportBundle(TEAM.id));

  // The other side ends up able to read what this side encrypts.
  const other = new EncryptionVault(new MemoryStorage());
  other.importBundle(parsed.key!, parsed.id);
  const sealed = vault.encrypt('rally at 1800', TEAM.id, 'node-0000000000000001', 'broadcast');
  const opened = other.decrypt(sealed, TEAM.id, 'node-0000000000000001', 'broadcast');
  assert.deepEqual(opened, { state: 'decrypted', text: 'rally at 1800' });
});

test('QR drawing covers the code and keeps its quiet zone', () => {
  const { path, total } = qrPath('RMCH1.example');
  assert.ok(total > 21 + 8 - 1);
  assert.match(path, /^M\d+ \d+h1v1h-1z/);
  // Nothing is drawn inside the four-module margin.
  for (const [, x, y] of path.matchAll(/M(\d+) (\d+)/g)) {
    assert.ok(Number(x) >= 4 && Number(x) < total - 4);
    assert.ok(Number(y) >= 4 && Number(y) < total - 4);
  }
});

test('an image with no QR code reads as nothing rather than failing', () => {
  const blank = new Uint8ClampedArray(64 * 64 * 4).fill(255);
  assert.equal(readQr(blank, 64, 64), undefined);
});

test('channel codes cover unencrypted invites, keys on their own and bad input', () => {
  const plain = shareCodeFor(TEAM)!;
  assert.deepEqual(parseChannelCode(`  ${plain}\n`), {
    id: TEAM.id,
    name: 'Team',
    keyOnly: false,
  });
  // Every device already has Public, so there's nothing to share until it has a key.
  assert.equal(shareCodeFor(PUBLIC), null);
  assert.equal(shareCodeFor(PUBLIC, new EncryptionVault(new MemoryStorage())), null);
  const vault = new EncryptionVault(new MemoryStorage());
  vault.generate(0);
  const key = shareCodeFor(PUBLIC, vault)!;
  assert.match(key, /^RMKEY1\./);
  assert.deepEqual(parseChannelCode(key), { id: 0, name: null, key, keyOnly: true });

  assert.throws(() => parseChannelCode('hello'), /isn't a Reaper Mesh channel code/);
  assert.throws(() => parseChannelCode('RMCH1.####'), /invalid/);
  // An invite's key is checked before anything could be added to the device.
  const tampered = formatInvite({ id: 5, name: 'Bad', key: `RMKEY1.${'A'.repeat(40)}` });
  assert.throws(() => parseChannelCode(tampered));
  const parts = JSON.parse(Buffer.from(key.slice(7), 'base64url').toString());
  parts.key = parts.key.replace(/^./, (c: string) => (c === '0' ? '1' : '0'));
  const forged = `RMKEY1.${Buffer.from(JSON.stringify(parts)).toString('base64url')}`;
  assert.throws(() => parseKeyBundle(forged), /integrity/);
});

test('joining finds a free slot and refuses what would not work', () => {
  const invite = { id: 7777, name: 'Ops', keyOnly: false };
  assert.deepEqual(planJoin(invite, [PUBLIC, TEAM]), { existing: undefined, slot: 2 });
  assert.deepEqual(planJoin({ ...invite, id: TEAM.id, name: 'Team' }, [PUBLIC, TEAM]), {
    existing: TEAM,
    slot: 1,
  });
  // Public's key joins the permanent Public channel, whatever its name says.
  assert.equal(planJoin({ id: 0, name: null, keyOnly: true }, [PUBLIC]).existing, PUBLIC);
  assert.throws(
    () => planJoin({ id: 42, name: null, keyOnly: true }, [PUBLIC]),
    /Join this channel before adding its key/,
  );
  assert.throws(() => planJoin({ ...invite, name: 'Team' }, [PUBLIC, TEAM]), /different channel/);
  const full = Array.from({ length: 8 }, (_, slot) => ({
    slot,
    id: slot + 300,
    name: `C${slot}`,
  }));
  assert.throws(() => planJoin(invite, full), /All 8 channel slots/);
});

test('distances, bearings and coordinates read the same as the mobile app', () => {
  const denver: [number, number] = [-104.9903, 39.7392];
  const north: [number, number] = [-104.9903, 39.7482];
  assert.ok(Math.abs(distanceMeters(denver, north) - 1000.8) < 1);
  assert.ok(bearingDegrees(denver, north) < 0.01);
  assert.ok(Math.abs(pathLength([denver, north, denver]) - 2001.6) < 2);
  assert.equal(formatDistance(950), '950 m');
  assert.equal(formatDistance(1500), '1.50 km');
  assert.equal(formatDistance(25000), '25.0 km');
  assert.equal(formatDistance(100, 'imperial'), '328 ft');
  assert.equal(formatDistance(17000, 'imperial'), '10.6 mi');
  assert.equal(formatBearing(0), '000° N');
  assert.equal(formatBearing(92), '092° E');
  assert.equal(formatBearing(359.9), '000° N');
  assert.equal(formatCoordinate(denver, 'dd'), '39.73920, -104.99030');
  assert.match(formatCoordinate(denver, 'mgrs'), /^13S [A-Z]{2} \d{5} \d{5}$/);
  // MGRS doesn't exist near the poles.
  assert.equal(formatCoordinate([10, 85], 'mgrs'), '85.00000, 10.00000');
  assert.equal(fromWire(toWire(-104.9903, 180), 180).toFixed(7), '-104.9903000');
  assert.equal(formatAgo(1000, 1000), '0s ago');
  assert.equal(formatAgo(0, 90_000), '2m ago');
  assert.equal(formatAgo(0, 3 * 24 * 3600_000), '3d ago');
});

test('following the browser only writes after real movement and a full beacon timer', () => {
  const saved = {
    source: 1,
    share: true,
    latitude: toWire(39.7392, 90),
    longitude: toWire(-105, 180),
  };
  const moved = { lngLat: [-105, 39.75] as const, at: 1_000_000 };
  const base = { now: 1_000_000, lastSentAt: 0, saved, intervalSeconds: 60 };
  assert.equal(shouldSendPosition({ ...base, fix: moved }), true);
  // No fix, or one too old to trust.
  assert.equal(shouldSendPosition({ ...base }), false);
  assert.equal(
    shouldSendPosition({ ...base, fix: moved, now: moved.at + MAX_FIX_AGE_MS + 1 }),
    false,
  );
  // Standing still never writes to the device's flash.
  assert.equal(
    shouldSendPosition({ ...base, fix: { lngLat: [-105, 39.7393], at: 1_000_000 } }),
    false,
  );
  // One beacon interval plus 10% jitter and a margin: 71 s at a 60 s interval.
  assert.equal(shouldSendPosition({ ...base, fix: moved, lastSentAt: 1_000_000 - 70_000 }), false);
  assert.equal(shouldSendPosition({ ...base, fix: moved, lastSentAt: 1_000_000 - 71_000 }), true);
  // The first write isn't held back, since that's what turns following on.
  assert.equal(
    shouldSendPosition({
      ...base,
      fix: moved,
      lastSentAt: 1_000_000,
      saved: { ...saved, share: false },
    }),
    true,
  );
});

test('heard nodes survive a reconnect, per device, and only age when not heard again', () => {
  const store = new MemoryStorage();
  const live = {
    node: 'node-00000000bb01e7f2',
    name: 'Alpha',
    peerBoot: 'boot-1',
    peerSequence: 1,
    ageMs: 1000,
    position: { latitude: toWire(39.5, 90), longitude: toWire(-105, 180) },
  };
  const cache = new NodeCache(store);
  cache.sync('device-a', [live], 10_000);
  assert.equal(cache.nodes[0].heardAt, 9000);
  assert.equal(cache.nodes[0].position?.latitude.toFixed(4), '39.5000');
  // The same report seen again keeps its time.
  cache.sync('device-a', [{ ...live, ageMs: 5000 }], 20_000);
  assert.equal(cache.nodes[0].heardAt, 9000);
  cache.sync('device-a', [{ ...live, peerSequence: 2, ageMs: 0 }], 30_000);
  assert.equal(cache.nodes[0].heardAt, 30_000);
  // An empty snapshot after reconnecting doesn't erase what was known.
  cache.sync('device-a', [], 40_000);
  assert.equal(cache.nodes.length, 1);

  const reopened = new NodeCache(store);
  reopened.use('device-a');
  assert.equal(reopened.nodes[0].node, live.node);
  reopened.use('device-b');
  assert.equal(reopened.nodes.length, 0);

  // Damage starts empty rather than breaking the screen, and bad rows are dropped.
  store.setItem(`${NODE_CACHE_PREFIX}bad`, '{nope');
  reopened.use('bad');
  assert.equal(reopened.nodes.length, 0);
  store.setItem(`${NODE_CACHE_PREFIX}mixed`, JSON.stringify([{ node: 1 }, cache.nodes[0]]));
  reopened.use('mixed');
  assert.equal(reopened.nodes.length, 1);

  // A read-only tab keeps the list in memory but never writes.
  const readOnly = new MemoryStorage();
  const tab = new NodeCache(readOnly, () => false);
  tab.sync('device-a', [live], 1000);
  assert.equal(tab.nodes.length, 1);
  assert.equal(readOnly.values.size, 0);
});

test('a forgotten node stays gone until the device hears it again, across reloads', () => {
  const store = new MemoryStorage();
  const cache = new NodeCache(store);
  const alpha = {
    node: 'node-alpha',
    name: 'Alpha',
    peerBoot: 'boot-1',
    peerSequence: 4,
    ageMs: 1000,
  };
  const bravo = { ...alpha, node: 'node-bravo', name: 'Bravo' };
  const known = (list: NodeCache) => list.nodes.map(row => row.node);
  cache.sync('device-a', [alpha, bravo], 5000);
  cache.forget('node-alpha', [alpha, bravo]);
  assert.deepEqual(known(cache), ['node-bravo']);

  // The device keeps reporting what it last heard, which must not bring the node back.
  cache.sync('device-a', [{ ...alpha, ageMs: 9000 }, bravo], 6000);
  assert.deepEqual(known(cache), ['node-bravo']);
  const reopened = new NodeCache(store);
  reopened.sync('device-a', [alpha, bravo], 7000);
  assert.deepEqual(known(reopened), ['node-bravo']);

  // Another device's list is its own.
  reopened.sync('device-b', [alpha], 7000);
  assert.deepEqual(known(reopened), ['node-alpha']);

  // A newer report does bring it back, and nothing is held against it afterward.
  reopened.sync('device-a', [{ ...alpha, peerSequence: 5, ageMs: 0 }, bravo], 8000);
  assert.deepEqual(known(reopened).sort(), ['node-alpha', 'node-bravo']);
  assert.deepEqual(JSON.parse(store.getItem(`${FORGOTTEN_NODES_PREFIX}device-a`)!), {});

  // So does a new boot, even with the same sequence number.
  reopened.forget('node-alpha', [{ ...alpha, peerSequence: 5 }]);
  reopened.sync('device-a', [{ ...alpha, peerSequence: 5, peerBoot: 'boot-2' }], 9000);
  assert.ok(known(reopened).includes('node-alpha'));

  // Dropping out of the device's report releases the hold, so it can return later.
  reopened.forget('node-bravo', [bravo]);
  reopened.sync('device-a', [{ ...alpha, peerSequence: 5, peerBoot: 'boot-2' }], 9500);
  assert.deepEqual(JSON.parse(store.getItem(`${FORGOTTEN_NODES_PREFIX}device-a`)!), {});

  // A damaged record forgets nothing rather than failing, and a read-only tab writes nothing.
  store.setItem(`${FORGOTTEN_NODES_PREFIX}device-c`, '{nope');
  const damaged = new NodeCache(store);
  damaged.sync('device-c', [alpha], 1000);
  assert.deepEqual(known(damaged), ['node-alpha']);
  const readOnly = new MemoryStorage();
  const tab = new NodeCache(readOnly, () => false);
  tab.sync('device-a', [alpha], 1000);
  tab.forget('node-alpha', [alpha]);
  assert.equal(tab.nodes.length, 0);
  assert.equal(readOnly.values.size, 0);
});

test('a class the portal looks for around a click exists in its page', () => {
  // The thread menu closed itself on every click when its wrapper was renamed in the markup alone.
  const folder = new URL('../../agents/web/', import.meta.url);
  const page = readFileSync(new URL('index.html', folder), 'utf8');
  const classes = new Set([...page.matchAll(/class="([^"]+)"/g)].flatMap(m => m[1].split(/\s+/)));
  const looked = readdirSync(folder)
    .filter(name => name.endsWith('.ts'))
    .flatMap(name => [
      ...readFileSync(new URL(name, folder), 'utf8').matchAll(/closest\('\.([\w-]+)'\)/g),
    ])
    .map(match => match[1]);
  assert.ok(looked.includes('thread-menu'));
  for (const name of looked) assert.ok(classes.has(name), `no .${name} in index.html`);
});

test('every conversation can be deleted except Public', () => {
  assert.equal(canDeleteConversation({ kind: 'channel', channel: 0 }), false);
  assert.equal(canDeleteConversation({ kind: 'channel', channel: TEAM.id }), true);
  assert.equal(canDeleteConversation({ kind: 'direct', channel: 0 }), true);
});

test('preferences fall back per field and round-trip', () => {
  const store = new MemoryStorage();
  assert.deepEqual(readPreferences(store), DEFAULT_PREFERENCES);
  store.setItem(PREFERENCES_KEY, JSON.stringify({ theme: 'day', units: 'furlongs', extra: 1 }));
  assert.deepEqual(readPreferences(store), { ...DEFAULT_PREFERENCES, theme: 'day' });
  store.setItem(PREFERENCES_KEY, '{broken');
  assert.deepEqual(readPreferences(store), DEFAULT_PREFERENCES);
  writePreferences(store, { ...DEFAULT_PREFERENCES, coordinates: 'dd', connectOnLoad: false });
  assert.equal(readPreferences(store).coordinates, 'dd');
  assert.equal(readPreferences(store).connectOnLoad, false);
});

test('remembered devices keep the latest first, one row per device, and can be forgotten', () => {
  const store = new MemoryStorage();
  assert.deepEqual(readDevices(store), []);
  rememberDevice(store, { id: 'a', kind: 'usb', lastConnectedAt: 1 });
  rememberDevice(store, { id: 'b', kind: 'bluetooth', lastConnectedAt: 2 });
  rememberDevice(store, { id: 'a', kind: 'bluetooth', label: 'Ridge', lastConnectedAt: 3 });
  assert.deepEqual(
    readDevices(store).map(row => [row.id, row.kind]),
    [
      ['a', 'bluetooth'],
      ['b', 'bluetooth'],
    ],
  );
  forgetDevice(store, 'a');
  assert.deepEqual(
    readDevices(store).map(row => row.id),
    ['b'],
  );
  for (let i = 0; i < 12; i++)
    rememberDevice(store, { id: `n${i}`, kind: 'usb', lastConnectedAt: i });
  assert.equal(readDevices(store).length, 8);
});

test('a shared map item on a channel with a random ID survives reloading the store', () => {
  // Channels became 32-bit IDs (D45), which the saved-source check had not caught up with.
  const store = new MemoryStorage();
  const maps = new MapStore(store, () => true);
  const operation = {
    operation: 'put' as const,
    item: {
      id: '5f0b7a52-8f6e-4f0e-9d2b-1a7c3e9d4b10',
      revision: 1,
      geometry: 'point' as const,
      type: 'core/point',
      color: '#b2dda3',
      name: 'Rally',
      note: '',
      coordinates: [toWire(39.7, 90), toWire(-105, 180)],
      metadata: {},
    },
  };
  const channel = 0x9c41e2a7;
  const payload = {
    origin: 'node-00000000bb01e7f2',
    channel,
    destination: 'broadcast',
    text: encodeMap(operation),
  };
  maps.receive(operation, payload);
  maps.decide(`${channel}:${payload.origin}:${operation.item.id}`, 1, true, operation);
  assert.ok(store.getItem(MAP_STORE_KEY));
  const reopened = new MapStore(store, () => true);
  assert.equal(reopened.state.shared[0].accepted?.channel, channel);
});

test('delivery wording stays honest about what each state means', () => {
  const base = { id: '1', device: 'd', destination: 'node-1', channel: 0, text: 't' };
  assert.equal(deliveryOf({ ...base, state: 'queued' }).icon, 'pending');
  assert.equal(deliveryOf({ ...base, state: 'transmitted' }).tone, 'muted');
  assert.match(deliveryOf({ ...base, state: 'transmitted' }).label, /not confirmed/);
  assert.equal(
    deliveryOf({ ...base, destination: 'broadcast', state: 'transmitted' }).tone,
    'good',
  );
  assert.match(
    deliveryOf({ ...base, destination: 'broadcast', state: 'transmitted' }).label,
    /no acknowledgment/,
  );
  assert.equal(deliveryOf({ ...base, state: 'acknowledged' }).icon, 'done');
  assert.ok(!deliveryOf({ ...base, state: 'acknowledged' }).label.includes('read'));
  assert.equal(deliveryOf({ ...base, state: 'failed', reason: 'x' }).label, 'Failed: x');
  assert.equal(deliveryOf({ ...base, state: 'unknown' }).icon, 'unknown');
  assert.match(deliveryOf({ ...base, state: 'unknown' }).label, /not sent again/);
  assert.match(
    deliveryOf({ ...base, state: 'acknowledged', reason: 'local-delivery' }).label,
    /no radio transmission/,
  );
});

test('the field simulator behaves as a full device over the real codec', async () => {
  const device = new FieldDevice({ pace: 0, scenario: false });
  const adapter = new SerialAdapter();
  await adapter.connect(device.createPort(), 'link-1');
  const { connection } = adapter;
  for (let i = 0; i < 100 && connection.sync.state !== 'ready'; i++)
    await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(connection.sync.state, 'ready');
  assert.equal(connection.device, FIELD_DEVICE_ID);
  assert.equal(connection.sync.config?.label, 'Reaper Dash');
  assert.equal(connection.messageBlockReason, undefined);
  assert.equal(connection.radioBlockReason, undefined);
  assert.ok(
    connection.supportsDiscovery && connection.supportsPosition && connection.supportsScreen,
  );

  const id = adapter.sendMessage('hello', 'node-00000000bb01e7f2', 0);
  for (let i = 0; i < 200; i++) {
    if (connection.messaging.history.find(m => m.id === id)?.state === 'acknowledged') break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(connection.messaging.history.find(m => m.id === id)?.state, 'acknowledged');

  // A lost link leaves unfinished work to be queried, and the same device is there on reconnect.
  device.drop();
  for (let i = 0; i < 100 && adapter.active; i++)
    await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(adapter.active, false);
  await adapter.connect(device.createPort(), 'link-2');
  for (let i = 0; i < 100 && connection.sync.state !== 'ready'; i++)
    await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(connection.sync.state, 'ready');
  await adapter.disconnect();
});

async function connectedModel(device: FieldDevice) {
  const model = new ConfigModel(new SerialAdapter());
  await model.adapter.connect(device.createPort(), 'link-1');
  const { connection } = model.adapter;
  for (let i = 0; i < 100 && connection.sync.state !== 'ready'; i++)
    await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(connection.sync.state, 'ready');
  return model;
}

/** Runs the app's settling pass until the save finishes, as the render loop does. */
async function settleSave<T>(model: ConfigModel, saving: Promise<T>) {
  let done = false;
  const finished = saving.finally(() => {
    done = true;
  });
  finished.catch(() => {});
  const { connection } = model.adapter;
  for (let i = 0; i < 400 && !done; i++) {
    settleCommands(model, connection.sync.state === 'ready', () => {});
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.ok(done, 'the save never finished');
  return finished;
}

test('a settings save finishes only once the new settings are here', async () => {
  const device = new FieldDevice({ pace: 0, scenario: false });
  const model = await connectedModel(device);
  const { connection } = model.adapter;
  const radio = connection.sync.config!.radio!;
  const removed = withChannel(radio, 1, '', 0);
  const saving = saveConfig(model, { ...connection.sync.config!, radio: removed });
  try {
    assert.equal(await settleSave(model, saving), 'committed');
    assert.equal(connection.sync.state, 'ready');
    assert.deepEqual(
      channelList(connection.sync.config!.radio!).map(channel => channel.name),
      ['Public'],
    );
    assert.equal(model.history.length, 0);
  } finally {
    await model.adapter.disconnect();
  }
});

test('a settings save reports a lost link instead of waiting for it to return', async () => {
  const device = new FieldDevice({ pace: 0, scenario: false });
  const model = await connectedModel(device);
  const { connection } = model.adapter;
  device.nextFault = 'disconnect';
  const saving = saveConfig(model, { ...connection.sync.config!, label: 'Changed' });
  assert.equal(await settleSave(model, saving), 'unknown');
  // The command is kept, so it can still be queried after reconnecting. It is never resent.
  assert.equal(model.history.length, 1);
  await model.adapter.disconnect();
});

test('a save fails rather than waits when the link goes before the new settings arrive', async () => {
  const device = new FieldDevice({ pace: 0, scenario: false });
  const model = await connectedModel(device);
  const { connection } = model.adapter;
  // The receipt starts a re-sync, and the link drops at that moment.
  const resynchronize = connection.sync.resynchronize.bind(connection.sync);
  connection.sync.resynchronize = () => {
    resynchronize();
    device.drop();
  };
  const saving = saveConfig(model, { ...connection.sync.config!, label: 'Changed' });
  await assert.rejects(settleSave(model, saving), /disconnected/);
  await model.adapter.disconnect();
});
