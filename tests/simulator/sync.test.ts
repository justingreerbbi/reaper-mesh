import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Synchronizer } from '../../packages/client-core/sync.ts';

function fixture(capacity = 64) {
  const client = new Synchronizer(capacity);
  const session = client.connect();
  client.hello(session, 'boot-A', 1, 1);
  const frame = (sequence = 0, label = 'initial') => ({
    session, boot: 'boot-A', sequence, revision: sequence, config: { region: 'US', label },
  });
  const snapshot = (sequence = 0, label = 'initial') => client.snapshot({
    ...frame(sequence, label), request: client.snapshotRequest,
  });
  return { client, session, frame, snapshot };
}

test('mutations require a complete handshake and snapshot', () => {
  const { client, snapshot } = fixture();
  assert.throws(() => client.mutationContext());
  snapshot();
  assert.equal(client.state, 'ready');
  assert.equal(client.mutationContext().expectedRevision, 0);
});

test('event arriving before snapshot is replayed beyond its boundary', () => {
  const { client, frame, snapshot } = fixture();
  client.event(frame(1, 'newer'));
  snapshot();
  assert.equal(client.config?.label, 'newer');
  assert.equal(client.revision, 1);
});

test('snapshot already containing buffered events does not apply them twice', () => {
  const { client, frame, snapshot } = fixture();
  client.event(frame(1, 'earlier'));
  snapshot(2, 'latest');
  assert.equal(client.config?.label, 'latest');
  assert.equal(client.sequence, 2);
});

test('gap blocks mutations until a fresh snapshot reconciles state', () => {
  const { client, frame, snapshot } = fixture();
  snapshot();
  client.event(frame(2));
  assert.equal(client.state, 'synchronizing');
  assert.throws(() => client.mutationContext());
  snapshot(2, 'recovered');
  assert.equal(client.state, 'ready');
  assert.equal(client.config?.label, 'recovered');
});

test('gap in buffered events requests another snapshot', () => {
  const { client, frame, snapshot } = fixture();
  const request = client.snapshotRequest;
  client.event(frame(2));
  snapshot();
  assert.equal(client.state, 'synchronizing');
  assert.equal(client.snapshotRequest, request + 1);
});

test('duplicate events never roll state backwards', () => {
  const { client, frame, snapshot } = fixture();
  snapshot();
  client.event(frame(1, 'new'));
  client.event(frame(1, 'stale'));
  assert.equal(client.config?.label, 'new');
});

test('old connection callbacks cannot overwrite a reconnected device', () => {
  const { client, frame, snapshot } = fixture();
  snapshot();
  const oldRequest = client.snapshotRequest;
  client.disconnect();
  const session = client.connect();
  client.hello(session, 'boot-B', 1, 1);
  client.snapshot({ ...frame(99, 'stale'), request: oldRequest });
  client.event(frame(100, 'stale'));
  assert.equal(client.config, undefined);
  client.snapshot({ ...frame(), session, boot: 'boot-B', request: client.snapshotRequest });
  assert.equal(client.state, 'ready');
  assert.equal(client.revision, 0);
});

test('an old snapshot response cannot finish a newer resync', () => {
  const { client, frame, snapshot } = fixture(1);
  const request = client.snapshotRequest;
  client.event(frame(1));
  client.event(frame(2)); // Overflow invalidates the outstanding snapshot.
  client.snapshot({ ...frame(), request });
  assert.equal(client.state, 'synchronizing');
  snapshot(2);
  assert.equal(client.state, 'ready');
});

test('revision mismatch triggers reconciliation rather than overwriting', () => {
  const { client, frame, snapshot } = fixture();
  snapshot();
  client.event({ ...frame(1), revision: 9 });
  assert.equal(client.state, 'synchronizing');
  assert.equal(client.revision, 0);
});

test('incompatible protocol never permits mutations', () => {
  const client = new Synchronizer();
  const session = client.connect();
  client.hello(session, 'boot-A', 2, 3);
  assert.equal(client.state, 'incompatible');
  assert.throws(() => client.mutationContext());
});

test('both snapshot/event orderings converge to the same state', () => {
  for (const eventFirst of [true, false]) {
    const { client, frame, snapshot } = fixture();
    if (eventFirst) client.event(frame(1, 'final'));
    snapshot();
    if (!eventFirst) client.event(frame(1, 'final'));
    assert.equal(client.state, 'ready');
    assert.equal(client.config?.label, 'final');
    assert.equal(client.sequence, 1);
  }
});
