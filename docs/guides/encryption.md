# Phase 3 agent-side channel encryption

Status: the first implementation is in the web portal and shared firmware transport. It passes 240 automated checks, both target builds, and a live Heltec V3 ↔ T-Beam V1.2 direct-message test in both directions. It has not received an independent security audit or full release/field qualification.

## Data path

1. The web agent encrypts before USB when encryption is required for the selected numeric channel.
2. Firmware accepts a well-framed opaque payload, carries it in the same message fragmentation/relay/ACK path as plaintext, and stores the exact ciphertext in its inbox. Neither Heltec V3 nor T-Beam V1.2 contains a channel key or encryption primitive.
3. The receiver reads the envelope over USB. The agent resolves the channel key ID and epoch, authenticates the envelope, then renders plaintext. Locked, missing-key, unsupported, malformed, authentication-failed, replayed and policy-rejected messages have distinct UI states; a failed decryption is never shown as plaintext.
4. The existing device ACK still means the device accepted/delivered ciphertext according to the route. It does not confirm that an agent was online, had the key, decrypted or displayed it.

Plaintext remains available on channels set to “Allow plaintext”. “Require encryption” is local to each web agent: it blocks that agent's outgoing plaintext and visibly rejects incoming unmarked plaintext. Encryption is automatically recognized from the envelope on other agents, but their policy must also be set to Required to reject plaintext. Policy and keys are not synchronized through the radio.

## RME2 envelope

All multi-byte integers are little-endian. The 61-byte authenticated header is followed by ciphertext and the 16-byte Poly1305 tag; current maximum envelope size is 1024 bytes, so encrypted UTF-8 plaintext is at most 947 bytes. RME2 replaced RME1 in firmware `v0.3.0` to carry 32-bit channel IDs (D45); devices and agents reject RME1, so encrypted messages saved by earlier builds show as unsupported.

| Offset | Length | Value |
| --- | ---: | --- |
| 0 | 4 | ASCII `RME` followed by version byte `0x02` |
| 4 | 1 | Suite `1`: XChaCha20-Poly1305-IETF |
| 5 | 4 | Channel ID; must match the radio header |
| 9 | 8 | BLAKE2b-8 key identifier |
| 17 | 4 | Key epoch |
| 21 | 24 | Fresh random XChaCha20 nonce |
| 45 | 16 | Random stable envelope message ID |
| 61 | variable | Authenticated ciphertext followed by 16-byte tag |

AEAD additional data binds the suite/channel/key ID/epoch header, stable envelope ID, channel ID, canonical sender node ID and destination. The key itself and plaintext never enter the device upload or agent message-recovery record. Retries reuse the saved ciphertext byte-for-byte; reconnect recovery may query existing device state but never resends/re-encrypts an uncertain upload on a new session.

Malformed data beginning with `RME` is rejected instead of treated as text. Unknown framing or suite is kept opaque and shown as unsupported. Devices check marker, version, suite, channel, key ID, epoch and size; agents perform cryptography.

## Key management and operation

- PIN protection is optional and off by default. Without it, channel keys and replay records are stored locally without password encryption; channel message encryption still works normally.
- Device → This app lets you enable a 4–6 digit PIN or remove protection by confirming the current PIN. Both changes preserve every channel key, epoch and replay record. When enabled, connecting a device opens the app-wide PIN screen. One unlock opens the app and all keys; disconnect/reconnect, reload and Lock app require unlocking again.
- Existing password-protected keys migrate through a one-time prompt for the old password and a new PIN. All key epochs and replay records are retained. A failed save preserves the previous encrypted record.
- With PIN protection enabled, channel keys are encrypted in browser storage with Argon2id and XChaCha20-Poly1305. The PIN is never saved in plaintext. Five failed unlock attempts start a 30-second cooldown, increasing to five minutes; the browser stores cooldown state across reloads.
- This is a browser-local convenience lock, not device authentication or an OS-backed login. A short PIN has limited entropy and cannot provide strong protection against offline guessing of copied storage. Cooldowns cannot stop someone who controls browser storage or scripts. Other apps can connect to the device without this PIN. Forgotten PINs have no recovery bypass; keep channel-key backups private.
- In Device → Channels, create a channel with **Encrypt this channel** on, or open one and select **Create a key**. Share it with **Share channel and key**: the QR code and its text are an `RMCH1` invite carrying the channel's ID, name and current key. A person joins with **Scan a channel QR code**, and the key goes into their vault before the channel reaches their device, so they cannot end up half-joined. The same codes work in the mobile app. The code holds the secret, so anyone who gets it, including from a photo or a shared image, can read the channel.
- Public has no invite, because every device already has it. Its share code is an `RMKEY1` text bundle containing the raw channel key, which **Scan a channel QR code** also accepts. The bundle is secret material; do not paste it into chat, issues, logs or public storage.
- Rotation creates a higher epoch and retains old epochs locally to decrypt earlier messages. Every peer must receive/import the new bundle before it can decrypt messages using that epoch. Remove access by rotating and securely distributing the new key; old recorded ciphertext remains readable to anyone who kept the old key.
- Direct routes currently use the selected channel's group key. Anyone holding that channel key can decrypt direct-routed messages; this is not pairwise private messaging. The portal no longer shows this note in the composer (removed November 3 at the owner's request), so share this limitation with users another way.

Removing a channel from a device keeps its keys in the browser, so its history stays readable and rejoining restores it. **Reset Public** deletes Public's chat, keys and requirement. Keys belong to a channel ID, not a slot, so each agent can keep the channel in a different slot. Renaming a channel keeps its ID and keys. Keys saved by earlier builds for slots 1–7 apply to the channels converted to IDs 1–7.

This is a simple group-key design, not forward-secure. Any group member can decrypt and create valid ciphertext for the group; the envelope does not authenticate an individual sender. A compromised device exposes routing metadata and ciphertext. A compromised unlocked agent can expose keys and plaintext. A browser vault at rest does not protect an unlocked session from malicious scripts, extensions, malware or a compromised OS. Replay suppression is bounded to the most recent 1024 envelope IDs retained in the local encrypted vault; replay state is local to that agent.

## Validation and release status

Automated checks cover key vault locking/wrong passphrase, key transfer between independent agents, authenticated context/tag failure, required policy, and encrypted payload recovery. Protocol/firmware tests verify opaque envelope admission and inbox retention. Both firmware targets build. Physical test on November 2, 2026: Heltec V3 and T-Beam V1.2 exchanged direct encrypted messages in both directions; both reached a device ACK, inbox entries retained the exact ciphertext with no plaintext, the shared key decrypted at the receiving agent, and an unrelated key could not decrypt. The hardware script restored each board's starting radio configuration and wrote a local result to `build/tbeam-v12/encryption-smoke.json`. Reconnect/reboot during an uncertain encrypted upload, key rotation over actual radio, long-duration/RF edge cases and relay remain unqualified. Reproduce with both radios enabled and browser serial connections closed: `node tools/hardware-encryption-smoke.ts .tools/espressif/python_env/idf5.5_py3.12_env/bin/python /dev/cu.usbserial-0001 /dev/cu.wchusbserial57700003341`.

The UI and documentation are an initial implementation, not a security audit. Before general release, review envelope test vectors and browser dependency provenance; add pairwise direct-message keys and sender authentication only through a separately reviewed protocol change. The portal plugin architecture must not expose keys; decrypted plaintext is sensitive application data, and an in-process plugin must be treated as trusted code until actual isolation exists.


## Local emergency wipe

Device → This app → Erase everything in this browser removes all `reaper-mesh.*` entries from local/session storage, including keys, PIN/cooldown state, policies, USB journals, messages and read/deletion metadata. It requires typing WIPE; a PIN is not required, and the same action is available from the lock screen. Active app tabs are stopped through a storage signal, the existing browser writer lock is acquired before deletion, and sessions disconnect without a device command. A dedicated static completion page replaces the app document to discard its live state. Failed deletion never reports success and leaves the app stopped for retry.

Only this browser origin/profile is cleared. Device inboxes, other browsers, exported files/backups and browser/OS forensic remnants are not erased. Reconnecting may download messages still retained by the device. This is local application-data deletion, not a secure-overwrite or remote-wipe guarantee. No firmware or wire contract changes are involved.
