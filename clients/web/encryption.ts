import sodium from 'libsodium-wrappers-sumo';
import { ENCRYPTED_HEADER_BYTES, ENCRYPTED_MAGIC, ENCRYPTED_SUITE_XCHACHA20_POLY1305, MAX_MESSAGE_BYTES, parseEncryptedHeader } from '../../packages/protocol/encrypted-message.ts';

export const ENCRYPTION_VAULT_KEY = 'reaper-mesh.crypto-vault.v1';
export const ENCRYPTION_POLICY_KEY = 'reaper-mesh.crypto-policy.v1';
const TAG_BYTES = sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
await sodium.ready;

type KeyRecord = { channel: number; keyId: string; epoch: number; keyHex: string };
type VaultRecord = { v: 1; keys: KeyRecord[]; seen: [string, string][] };
type StoredVault = { version: 1; salt: string; nonce: string; ciphertext: string };
export type Decryption = { state: 'decrypted'; text: string } | { state: 'key-needed' | 'invalid' | 'replay' | 'plaintext-rejected' | 'locked' | 'unsupported'; text: string };

function hex(bytes: Uint8Array) { return sodium.to_hex(bytes); }
function fromHex(value: string) {
  if (!/^(?:[0-9a-f]{2})+$/u.test(value)) throw new Error('Malformed hexadecimal data');
  return sodium.from_hex(value);
}
function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((size, part) => size + part.length, 0)); let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}
function canonicalNode(id: string) { return /^heltec-[0-9a-f]{12}$/u.test(id) ? `node-0000${id.slice(7)}` : id; }
function cleanText(bytes: Uint8Array) {
  const text = textDecoder.decode(bytes);
  if (!text || textEncoder.encode(text).length !== bytes.length || /[\u0000-\u0008\u000b-\u001f\u007f]/u.test(text)) throw new Error('invalid message text');
  return text;
}
function contextBytes(channel: number, sender: string, destination: string) {
  return textEncoder.encode(JSON.stringify([channel, canonicalNode(sender), destination === 'broadcast' ? 'broadcast' : canonicalNode(destination)]));
}
function aad(header: Uint8Array, channel: number, sender: string, destination: string) {
  return concat(header.subarray(0, 18), header.subarray(42, 58), contextBytes(channel, sender, destination));
}
function validateChannel(channel: number) { if (!Number.isInteger(channel) || channel < 0 || channel > 7) throw new Error('invalid channel'); }

/** Client-only channel key vault. The device sees only the opaque RME1 envelope. */
export class EncryptionVault {
  #storage: Pick<Storage, 'getItem' | 'setItem'>;
  #writable: () => boolean;
  #vaultKey: Uint8Array | undefined;
  #salt: Uint8Array | undefined;
  #keys: KeyRecord[] = [];
  #seen = new Map<string, string>();
  #policies = new Set<number>();
  #exists = false;
  constructor(storage: Pick<Storage, 'getItem' | 'setItem'>, writable: () => boolean = () => true) {
    this.#storage = storage; this.#writable = writable; this.#exists = !!storage.getItem(ENCRYPTION_VAULT_KEY);
    const saved = storage.getItem(ENCRYPTION_POLICY_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { version?: unknown; required?: unknown };
        if (parsed.version !== 1 || !Array.isArray(parsed.required) || parsed.required.some((n: unknown) => !Number.isInteger(n) || Number(n) < 0 || Number(n) > 7)) throw new Error();
        this.#policies = new Set(parsed.required as number[]);
      } catch { throw new Error('Encryption policy is malformed; it was preserved and sending is blocked.'); }
    }
  }
  get exists() { return this.#exists; }
  get unlocked() { return !!this.#vaultKey; }
  get requiredChannels() { return [...this.#policies].sort((a, b) => a - b); }
  isRequired(channel: number) { return this.#policies.has(channel); }
  hasKey(channel: number) { return !!this.#current(channel); }
  unlock(passphrase: string, confirmation?: string) {
    if (!this.#writable()) throw new Error('This tab is read-only; open the device-owning tab to manage keys.');
    if (!passphrase || passphrase.length < 12) throw new Error('Use a vault passphrase of at least 12 characters.');
    if (!this.#exists && passphrase !== confirmation) throw new Error('Vault passphrases do not match.');
    if (!this.#exists) {
      const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
      const key = this.#derive(passphrase, salt); this.#vaultKey = key; this.#salt = salt; this.#keys = []; this.#seen.clear();
      try { this.#save(); this.#exists = true; }
      catch (error) { this.#lock(); throw error; }
      return;
    }
    const raw = this.#storage.getItem(ENCRYPTION_VAULT_KEY); if (!raw) throw new Error('Key vault disappeared.');
    let stored: StoredVault;
    try { stored = JSON.parse(raw) as StoredVault; } catch { throw new Error('Key vault is malformed; it was preserved.'); }
    if (stored.version !== 1) throw new Error('Unsupported key vault version.');
    const salt = fromHex(stored.salt), nonce = fromHex(stored.nonce), ciphertext = fromHex(stored.ciphertext);
    if (salt.length !== sodium.crypto_pwhash_SALTBYTES || nonce.length !== sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES) throw new Error('Key vault framing is invalid.');
    const key = this.#derive(passphrase, salt);
    try {
      const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, textEncoder.encode('Reaper Mesh key vault v1'), nonce, key);
      const record = JSON.parse(textDecoder.decode(plaintext)) as VaultRecord;
      if (record.v !== 1 || !Array.isArray(record.keys) || !Array.isArray(record.seen) || record.keys.length > 64 || record.seen.length > 1024) throw new Error();
      for (const item of record.keys) this.#validateKey(item);
      this.#keys = record.keys; this.#seen = new Map(record.seen);
      this.#vaultKey = key; this.#salt = salt;
    } catch { sodium.memzero(key); throw new Error('Incorrect passphrase or damaged key vault.'); }
  }
  lock() { this.#lock(); }
  generate(channel: number) {
    validateChannel(channel); this.#assertUnlocked();
    const epoch = this.#keys.filter(key => key.channel === channel).reduce((max, key) => Math.max(max, key.epoch), 0) + 1;
    if (epoch > 0xffffffff) throw new Error('Channel key epoch is exhausted.');
    const raw = sodium.randombytes_buf(32), record = { channel, epoch, keyId: hex(sodium.crypto_generichash(8, raw, null)), keyHex: hex(raw) };
    sodium.memzero(raw); this.#keys.push(record);
    try { this.#save(); this.#setPolicy(channel, true); } catch (error) { this.#keys.pop(); throw error; }
    return { epoch, keyId: record.keyId };
  }
  setRequired(channel: number, required: boolean) {
    validateChannel(channel);
    if (required && !this.#current(channel)) throw new Error('Generate or import a channel key before requiring encryption.');
    this.#setPolicy(channel, required);
  }
  exportBundle(channel: number) {
    const key = this.#current(channel); if (!key) throw new Error('No channel key is available.');
    const bundle = JSON.stringify({ format: 'RMKEY1', channel, epoch: key.epoch, keyId: key.keyId, key: key.keyHex });
    return `RMKEY1.${sodium.to_base64(textEncoder.encode(bundle), sodium.base64_variants.URLSAFE_NO_PADDING)}`;
  }
  importBundle(bundle: string, channel: number) {
    validateChannel(channel); this.#assertUnlocked();
    if (!bundle.startsWith('RMKEY1.')) throw new Error('Key transfer must start with RMKEY1.');
    let raw: { format?: unknown; epoch?: unknown; keyId?: unknown; key?: unknown };
    try { raw = JSON.parse(textDecoder.decode(sodium.from_base64(bundle.slice(7), sodium.base64_variants.URLSAFE_NO_PADDING))); }
    catch { throw new Error('Key transfer is invalid.'); }
    if (raw.format !== 'RMKEY1' || !Number.isInteger(raw.epoch) || Number(raw.epoch) < 1 || typeof raw.key !== 'string' || typeof raw.keyId !== 'string') throw new Error('Key transfer fields are invalid.');
    const key = fromHex(raw.key); if (key.length !== 32 || hex(sodium.crypto_generichash(8, key, null)) !== raw.keyId) throw new Error('Key transfer integrity check failed.');
    const record: KeyRecord = { channel, epoch: Number(raw.epoch), keyId: raw.keyId, keyHex: raw.key };
    this.#validateKey(record);
    if (!this.#keys.some(item => item.channel === channel && item.epoch === record.epoch && item.keyId === record.keyId)) this.#keys.push(record);
    try { this.#save(); this.#setPolicy(channel, true); } catch (error) { this.#keys = this.#keys.filter(item => item !== record); sodium.memzero(key); throw error; }
    sodium.memzero(key);
  }
  encrypt(plaintext: string, channel: number, sender: string, destination: string) {
    validateChannel(channel);
    if (!this.#policies.has(channel)) return textEncoder.encode(plaintext);
    this.#assertUnlocked(); const key = this.#current(channel); if (!key) throw new Error('Channel encryption is required but its key is missing.');
    const bytes = textEncoder.encode(plaintext);
    if (!bytes.length || bytes.length > MAX_MESSAGE_BYTES - ENCRYPTED_HEADER_BYTES - TAG_BYTES || cleanText(bytes) !== plaintext) throw new Error(`Encrypted messages must be 1–${MAX_MESSAGE_BYTES - ENCRYPTED_HEADER_BYTES - TAG_BYTES} UTF-8 bytes.`);
    const header = new Uint8Array(ENCRYPTED_HEADER_BYTES); header.set(ENCRYPTED_MAGIC, 0); header[4] = ENCRYPTED_SUITE_XCHACHA20_POLY1305; header[5] = channel;
    header.set(fromHex(key.keyId), 6); new DataView(header.buffer).setUint32(14, key.epoch, true);
    const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES); header.set(nonce, 18);
    header.set(sodium.randombytes_buf(16), 42);
    const cipher = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(bytes, aad(header, channel, sender, destination), null, nonce, fromHex(key.keyHex));
    const envelope = concat(header, cipher);
    if (envelope.length > MAX_MESSAGE_BYTES) throw new Error('Encrypted envelope exceeds the device message limit.');
    sodium.memzero(nonce); sodium.memzero(bytes); sodium.memzero(cipher);
    return envelope;
  }
  decrypt(envelope: Uint8Array, channel: number, sender: string, destination: string, transportIdentity?: string): Decryption {
    const header = parseEncryptedHeader(envelope);
    if (!header) return { state: 'unsupported', text: 'Encrypted message · unsupported or malformed envelope' };
    if (header.channel !== channel) return { state: 'invalid', text: 'Encrypted message · channel mismatch' };
    if (!this.#vaultKey) return { state: 'locked', text: 'Encrypted message · unlock the key vault' };
    const key = this.#keys.find(item => item.channel === channel && item.epoch === header.epoch && item.keyId === header.keyId);
    if (!key) return { state: 'key-needed', text: `Encrypted message · key ${header.keyId.slice(0, 8)} / epoch ${header.epoch} unavailable` };
    const replayId = `${key.keyId}:${hex(header.messageId)}`;
    let plaintext: Uint8Array;
    try { plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, envelope.subarray(ENCRYPTED_HEADER_BYTES), aad(envelope, channel, sender, destination), header.nonce, fromHex(key.keyHex)); }
    catch { return { state: 'invalid', text: 'Encrypted message · authentication failed' }; }
    if (transportIdentity) {
      const prior = this.#seen.get(replayId);
      if (prior && prior !== transportIdentity) { sodium.memzero(plaintext); return { state: 'replay', text: 'Encrypted duplicate suppressed' }; }
      if (!prior) {
        if (!this.#writable()) { sodium.memzero(plaintext); return { state: 'locked', text: 'Encrypted message · this tab cannot update replay protection' }; }
        this.#seen.set(replayId, transportIdentity); while (this.#seen.size > 1024) this.#seen.delete(this.#seen.keys().next().value!);
        try { this.#save(); } catch { this.#seen.delete(replayId); sodium.memzero(plaintext); return { state: 'locked', text: 'Encrypted message · replay state could not be saved' }; }
      }
    }
    try { return { state: 'decrypted', text: cleanText(plaintext) }; }
    catch { return { state: 'invalid', text: 'Encrypted message · invalid plaintext' }; }
    finally { sodium.memzero(plaintext); }
  }
  #current(channel: number) { return this.#keys.filter(key => key.channel === channel).sort((a, b) => b.epoch - a.epoch)[0]; }
  #validateKey(key: KeyRecord) {
    if (!key || !Number.isInteger(key.channel) || key.channel < 0 || key.channel > 7 || !Number.isInteger(key.epoch) || key.epoch < 1 || key.epoch > 0xffffffff || !/^[0-9a-f]{16}$/u.test(key.keyId) || !/^[0-9a-f]{64}$/u.test(key.keyHex) || hex(sodium.crypto_generichash(8, fromHex(key.keyHex), null)) !== key.keyId) throw new Error('Invalid channel key record.');
  }
  #setPolicy(channel: number, required: boolean) {
    const next = new Set(this.#policies); if (required) next.add(channel); else next.delete(channel);
    this.#storage.setItem(ENCRYPTION_POLICY_KEY, JSON.stringify({ version: 1, required: [...next].sort((a, b) => a - b) })); this.#policies = next;
  }
  #derive(passphrase: string, salt: Uint8Array) {
    return sodium.crypto_pwhash(32, passphrase, salt, sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE, sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE, sodium.crypto_pwhash_ALG_ARGON2ID13);
  }
  #save() {
    this.#assertUnlocked();
    const plaintext = textEncoder.encode(JSON.stringify({ v: 1, keys: this.#keys, seen: [...this.#seen] } satisfies VaultRecord));
    const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
    const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, textEncoder.encode('Reaper Mesh key vault v1'), null, nonce, this.#vaultKey!);
    try { this.#storage.setItem(ENCRYPTION_VAULT_KEY, JSON.stringify({ version: 1, salt: hex(this.#salt!), nonce: hex(nonce), ciphertext: hex(ciphertext) } satisfies StoredVault)); }
    finally { sodium.memzero(plaintext); sodium.memzero(nonce); sodium.memzero(ciphertext); }
  }
  #assertUnlocked() { if (!this.#vaultKey || !this.#salt) throw new Error('Unlock the local encryption vault first.'); if (!this.#writable()) throw new Error('This tab is read-only; open the device-owning tab to manage keys.'); }
  #lock() { if (this.#vaultKey) sodium.memzero(this.#vaultKey); for (const key of this.#keys) { const bytes = fromHex(key.keyHex); sodium.memzero(bytes); } this.#vaultKey = undefined; this.#salt = undefined; this.#keys = []; this.#seen.clear(); }
}
