/**
 * Notifications for messages that arrive while the portal isn't in front: its tab is hidden, or
 * another window has focus. They are shown by this browser (or the desktop app, through its
 * notification plugin); there is no push service, so nothing arrives while the page is closed and
 * nothing about them leaves this computer. Same wording and setting as the mobile app.
 */
import { canonicalNode, channelLabel, nodeLabel, type ChannelName } from './conversations.ts';

export type Level = 'sender' | 'full' | 'off';

export type Alert = Readonly<{ title: string; body: string; destination: string; channel: number }>;

/** A burst after a long gap shouldn't bury the screen. The rest show as unread in the portal. */
export const MAX_PER_BATCH = 5;

/**
 * What a notification says, by the user's choice:
 * - 'sender': who it's from and where, never the message itself (the default);
 * - 'full': the message too;
 * - 'off': nothing.
 */
export function alertFor(
  item: Readonly<{
    origin: string;
    destination?: string | null;
    channel: number;
    text: string;
  }>,
  context: { channels: readonly ChannelName[]; nodes: readonly { node: string; name: string }[] },
  level: Level,
): Alert | undefined {
  if (level === 'off') return undefined;
  const direct = !!item.destination && item.destination !== 'broadcast';
  const sender = nodeLabel(
    context.nodes.find(node => canonicalNode(node.node) === canonicalNode(item.origin))?.name,
    item.origin,
  );
  const where = channelLabel(context.channels, item.channel);
  const full = level === 'full';
  return {
    title: direct ? sender : where,
    body: direct
      ? full
        ? item.text
        : 'New message'
      : full
        ? `${sender}: ${item.text}`
        : `New message from ${sender}`,
    // A direct message's conversation is the sender; a channel's is broadcast on that channel.
    destination: direct ? item.origin : 'broadcast',
    channel: item.channel,
  };
}

/**
 * Remembers which messages have been seen, so each is announced once. The first look at a device
 * only takes note: messages already waiting when the page opens are not new.
 */
export class Announcer {
  #seen = new Map<string, Set<string>>();

  /** The keys among `keys` not seen before for `scope`. */
  fresh(scope: string, keys: readonly string[]) {
    let seen = this.#seen.get(scope);
    if (!seen) {
      this.#seen.set(scope, new Set(keys));
      return [];
    }
    const added = keys.filter(key => !seen!.has(key));
    for (const key of added) seen.add(key);
    return added;
  }
}

type Api = {
  permission: NotificationPermission;
  requestPermission(): Promise<NotificationPermission | string>;
  new (title: string, options?: NotificationOptions): Notification;
};
const api = () => (globalThis as { Notification?: Api }).Notification;

export const notificationsSupported = () => !!api();
export const notificationPermission = (): NotificationPermission | 'unsupported' =>
  api()?.permission ?? 'unsupported';

/** Asks to show notifications. Needs a click in most browsers. */
export async function requestNotifications() {
  try {
    await api()?.requestPermission();
  } catch {
    // Refused or unavailable; the setting shows which.
  }
}

/** Whether the portal is out of sight, so a new message would otherwise go unnoticed. */
export const away = () => document.visibilityState === 'hidden' || !document.hasFocus();

/** Shows one notification, if allowed. `open` runs when it is clicked, where that is possible. */
export function notify(title: string, body: string, tag: string, open: () => void) {
  const Notify = api();
  if (!Notify || Notify.permission !== 'granted') return;
  try {
    const shown = new Notify(title, { body, tag });
    // The desktop app's notifications return nothing to click; the browser's do.
    if (shown && 'onclick' in shown)
      shown.onclick = () => {
        window.focus();
        open();
        shown.close();
      };
  } catch {
    // Android Chrome only shows notifications from a service worker; nothing more to do.
  }
}

/** Shows the alerts, up to MAX_PER_BATCH. `open` brings up the conversation on a click. */
export function show(alerts: readonly Alert[], open: (alert: Alert) => void) {
  for (const alert of alerts.slice(0, MAX_PER_BATCH))
    notify(
      alert.title,
      alert.body,
      `reaper-mesh:${alert.channel}:${canonicalNode(alert.destination)}`,
      () => open(alert),
    );
}
