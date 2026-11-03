import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Synchronizer } from '../../packages/agent-core/sync.ts';

function fixture(capacity = 64) {
  const agent = new Synchronizer(capacity);
  const session = agent.connect();
  agent.hello(session, 'boot-A', 1, 1);
  const frame = (sequence = 0, label = 'initial') => ({
    session,
    boot: 'boot-A',
    sequence,
    revision: sequence,
    config: { region: 'US', label },
  });
  const snapshot = (sequence = 0, label = 'initial') =>
    agent.snapshot({
      ...frame(sequence, label),
      request: agent.snapshotRequest,
    });
  return { agent, session, frame, snapshot };
}

test('mutations require a complete handshake and snapshot', () => {
  const { agent, snapshot } = fixture();
  assert.throws(() => agent.mutationContext());
  snapshot();
  assert.equal(agent.state, 'ready');
  assert.equal(agent.mutationContext().expectedRevision, 0);
});

test('event arriving before snapshot is replayed beyond its boundary', () => {
  const { agent, frame, snapshot } = fixture();
  agent.event(frame(1, 'newer'));
  snapshot();
  assert.equal(agent.config?.label, 'newer');
  assert.equal(agent.revision, 1);
});

test('snapshot already containing buffered events does not apply them twice', () => {
  const { agent, frame, snapshot } = fixture();
  agent.event(frame(1, 'earlier'));
  snapshot(2, 'latest');
  assert.equal(agent.config?.label, 'latest');
  assert.equal(agent.sequence, 2);
});

test('gap blocks mutations until a fresh snapshot reconciles state', () => {
  const { agent, frame, snapshot } = fixture();
  snapshot();
  agent.event(frame(2));
  assert.equal(agent.state, 'synchronizing');
  assert.throws(() => agent.mutationContext());
  snapshot(2, 'recovered');
  assert.equal(agent.state, 'ready');
  assert.equal(agent.config?.label, 'recovered');
});

test('gap in buffered events requests another snapshot', () => {
  const { agent, frame, snapshot } = fixture();
  const request = agent.snapshotRequest;
  agent.event(frame(2));
  snapshot();
  assert.equal(agent.state, 'synchronizing');
  assert.equal(agent.snapshotRequest, request + 1);
});

test('duplicate events never roll state backwards', () => {
  const { agent, frame, snapshot } = fixture();
  snapshot();
  agent.event(frame(1, 'new'));
  agent.event(frame(1, 'stale'));
  assert.equal(agent.config?.label, 'new');
});

test('old connection callbacks cannot overwrite a reconnected device', () => {
  const { agent, frame, snapshot } = fixture();
  snapshot();
  const oldRequest = agent.snapshotRequest;
  agent.disconnect();
  const session = agent.connect();
  agent.hello(session, 'boot-B', 1, 1);
  agent.snapshot({ ...frame(99, 'stale'), request: oldRequest });
  agent.event(frame(100, 'stale'));
  assert.equal(agent.config, undefined);
  agent.snapshot({ ...frame(), session, boot: 'boot-B', request: agent.snapshotRequest });
  assert.equal(agent.state, 'ready');
  assert.equal(agent.revision, 0);
});

test('an old snapshot response cannot finish a newer resync', () => {
  const { agent, frame, snapshot } = fixture(1);
  const request = agent.snapshotRequest;
  agent.event(frame(1));
  agent.event(frame(2)); // Overflow invalidates the outstanding snapshot.
  agent.snapshot({ ...frame(), request });
  assert.equal(agent.state, 'synchronizing');
  snapshot(2);
  assert.equal(agent.state, 'ready');
});

test('revision mismatch triggers reconciliation rather than overwriting', () => {
  const { agent, frame, snapshot } = fixture();
  snapshot();
  agent.event({ ...frame(1), revision: 9 });
  assert.equal(agent.state, 'synchronizing');
  assert.equal(agent.revision, 0);
});

test('incompatible protocol never permits mutations', () => {
  const agent = new Synchronizer();
  const session = agent.connect();
  agent.hello(session, 'boot-A', 2, 3);
  assert.equal(agent.state, 'incompatible');
  assert.throws(() => agent.mutationContext());
});

test('both snapshot/event orderings converge to the same state', () => {
  for (const eventFirst of [true, false]) {
    const { agent, frame, snapshot } = fixture();
    if (eventFirst) agent.event(frame(1, 'final'));
    snapshot();
    if (!eventFirst) agent.event(frame(1, 'final'));
    assert.equal(agent.state, 'ready');
    assert.equal(agent.config?.label, 'final');
    assert.equal(agent.sequence, 1);
  }
});
