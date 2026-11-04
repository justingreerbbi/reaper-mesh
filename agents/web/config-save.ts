// Saving device settings and settling the commands that carry them. No DOM, so tests can drive it.
import type { Config } from '../../packages/agent-core/sync.ts';
import type { ConfigModel } from './model.ts';

export type SaveOutcome = 'committed' | 'conflict' | 'rejected' | 'unknown';

const waiting = new Map<string, (outcome: SaveOutcome) => void>();
const refreshing = new Set<{
  model: ConfigModel;
  resolve: () => void;
  reject: (error: Error) => void;
}>();
const queried = new Set<string>();

/**
 * Saves settings, and resolves with what the device did once the outcome is known. A receipt starts
 * a re-sync but doesn't carry the new settings, so this also waits for them: whatever runs next, such
 * as publishing a channel's key status, sees what the device now holds.
 */
export async function saveConfig(model: ConfigModel, config: Config) {
  const id = model.adapter.configure(config);
  const outcome = await new Promise<SaveOutcome>(resolve => waiting.set(id, resolve));
  if (outcome === 'committed' || outcome === 'conflict')
    await new Promise<void>((resolve, reject) => refreshing.add({ model, resolve, reject }));
  return outcome;
}

const settledMessage = {
  conflict: 'The device settings changed before your save arrived. The latest settings are shown.',
  rejected: 'The device rejected the settings change. Nothing was changed.',
  unknown:
    'A settings change may not have applied before the device restarted. The settings shown are what the device reports.',
};

/**
 * Releases settled configuration commands so the agent's bounded history never fills up.
 * A command with an unknown outcome is queried once per connection (never resent). It is
 * released once its result arrives, or once the device has rebooted and its receipt is gone;
 * the device snapshot already shows what actually applied.
 */
export function settleCommands(
  model: ConfigModel,
  ready: boolean,
  report: (message: string) => void,
) {
  const { connection } = model.adapter;
  const finish = (id: string, outcome: SaveOutcome, message?: string) => {
    const wait = waiting.get(id);
    waiting.delete(id);
    if (wait) wait(outcome);
    else if (message) report(message);
  };
  for (const entry of model.history) {
    const { outcome, result } = connection.commands.status(entry.id);
    if (outcome === 'pending') continue;
    if (outcome !== 'unknown' || result) {
      model.forget(entry.id);
      finish(entry.id, outcome, outcome === 'committed' ? undefined : settledMessage[outcome]);
      continue;
    }
    if (!ready) {
      // Nobody should wait on a lost link. The command stays, to be queried on reconnecting.
      const wait = waiting.get(entry.id);
      waiting.delete(entry.id);
      wait?.('unknown');
      continue;
    }
    const attempt = `${entry.id}:${connection.sync.session}`;
    if (queried.has(attempt)) continue;
    queried.add(attempt);
    try {
      if (!model.adapter.recover(entry.id)) {
        model.forget(entry.id);
        finish(entry.id, 'unknown', settledMessage.unknown);
      }
    } catch {
      // Another device, or firmware without result queries: keep it for the original device.
    }
  }
  for (const wait of refreshing) {
    if (wait.model !== model || (!ready && model.adapter.active)) continue;
    refreshing.delete(wait);
    if (ready) wait.resolve();
    else wait.reject(new Error('The device disconnected before its settings could be refreshed.'));
  }
  if (!ready) return;
  // One read-only message query per pass, so recovery can't flood the link. It never resends.
  for (const entry of connection.messaging.history) {
    const attempt = `${entry.id}:${connection.sync.session}`;
    if (entry.state !== 'unknown' || entry.device !== connection.device || queried.has(attempt))
      continue;
    queried.add(attempt);
    try {
      model.adapter.recoverMessage(entry.id);
    } catch {
      // Stays unknown, which the thread shows.
    }
    break;
  }
}
