/**
 * Channel invites (D45): one text bundle carrying a channel's on-air ID and name, and for an
 * encrypted channel its RMKEY1 key bundle. Importing one puts the channel in any free slot.
 * The bundle is versioned JSON so later fields can be added; unknown fields are ignored.
 */
export const INVITE_PREFIX = 'RMCH1.';
const NAME = /^[A-Za-z0-9_-]{1,8}$/;

export type ChannelInvite = Readonly<{ id: number; name: string; key?: string }>;

function toBase64Url(text: string) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Channel invite is invalid.');
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder('utf-8', { fatal: true }).decode(
    Uint8Array.from(binary, char => char.charCodeAt(0)),
  );
}

function validInvite(invite: ChannelInvite) {
  return (
    Number.isInteger(invite.id) &&
    invite.id > 0 &&
    invite.id < 0xffffffff &&
    NAME.test(invite.name) &&
    (invite.key === undefined || invite.key.startsWith('RMKEY1.'))
  );
}

export function formatInvite(invite: ChannelInvite) {
  if (!validInvite(invite)) throw new Error('Channel invite is invalid.');
  return (
    INVITE_PREFIX +
    toBase64Url(
      JSON.stringify({
        format: 'RMCH1',
        id: invite.id.toString(16).padStart(8, '0'),
        name: invite.name,
        ...(invite.key ? { key: invite.key } : {}),
      }),
    )
  );
}

export function parseInvite(text: string): ChannelInvite {
  const value = text.trim();
  if (!value.startsWith(INVITE_PREFIX)) throw new Error('A channel invite starts with RMCH1.');
  if (value.length > 4096) throw new Error('Channel invite is too long.');
  let raw: { format?: unknown; id?: unknown; name?: unknown; key?: unknown };
  try {
    raw = JSON.parse(fromBase64Url(value.slice(INVITE_PREFIX.length)));
  } catch {
    throw new Error('Channel invite is invalid.');
  }
  if (
    raw?.format !== 'RMCH1' ||
    typeof raw.id !== 'string' ||
    !/^[0-9a-f]{8}$/.test(raw.id) ||
    typeof raw.name !== 'string' ||
    (raw.key !== undefined && typeof raw.key !== 'string')
  )
    throw new Error('Channel invite fields are invalid.');
  const invite: ChannelInvite = {
    id: Number.parseInt(raw.id, 16),
    name: raw.name,
    ...(raw.key !== undefined ? { key: raw.key as string } : {}),
  };
  if (!validInvite(invite)) throw new Error('Channel invite fields are invalid.');
  return invite;
}
