# Phase 3 client-side channel encryption

Status: the first implementation is in the web portal and shared firmware transport. It passes 240 automated checks, both target builds, and a live Heltec V3 ↔ T-Beam V1.2 direct-message test in both directions. It has not received an independent security audit or full release/field qualification.

## Data path

1. The web client encrypts before USB when encryption is required for the selected numeric channel.
2. Firmware accepts a well-framed opaque payload, carries it in the same message fragmentation/relay/ACK path as plaintext, and stores the exact ciphertext in its inbox. Neither Heltec V3 nor T-Beam V1.2 contains a channel key or encryption primitive.
3. The receiver reads the envelope over USB. The client resolves the channel key ID and epoch, authenticates the envelope, then renders plaintext. Locked, missing-key, unsupported, malformed, authentication-failed, replayed and policy-rejected messages have distinct UI states; a failed decryption is never shown as plaintext.
4. The existing device ACK still means the device accepted/delivered ciphertext according to the route. It does not confirm that an agent was online, had the key, decrypted or displayed it.

Plaintext remains available on channels set to “Allow plaintext”. “Require encryption” is local to each web client: it blocks that client's outgoing plaintext and visibly rejects incoming unmarked plaintext. Encryption is automatically recognized from the envelope on other clients, but their policy must also be set to Required to reject plaintext. Policy and keys are not synchronized through the radio.

## RME1 envelope

All multi-byte integers are little-endian. The 58-byte authenticated header is followed by ciphertext and the 16-byte Poly1305 tag; current maximum envelope size is 1024 bytes, so encrypted UTF-8 plaintext is at most 950 bytes.

| Offset | Length | Value |
| --- | ---: | --- |
| 0 | 4 | ASCII `RME` followed by version byte `0x01` |
| 4 | 1 | Suite `1`: XChaCha20-Poly1305-IETF |
| 5 | 1 | Numeric channel, 0–7 |
| 6 | 8 | BLAKE2b-8 key identifier |
| 14 | 4 | Key epoch |
| 18 | 24 | Fresh random XChaCha20 nonce |
| 42 | 16 | Random stable envelope message ID |
| 58 | variable | Authenticated ciphertext followed by 16-byte tag |

AEAD additional data binds the suite/channel/key ID/epoch header, stable envelope ID, numeric channel, canonical sender node ID and destination. The key itself and plaintext never enter the device upload or client message-recovery record. Retries reuse the saved ciphertext byte-for-byte; reconnect recovery may query existing device state but never resends/re-encrypts an uncertain upload on a new session.

Malformed data beginning with `RME` is rejected instead of treated as text. Unknown framing or suite is kept opaque and shown as unsupported. Devices check marker, version, suite, channel, key ID, epoch and size; clients perform cryptography.

## Key management and operation

- In Settings → Channel encryption, create a vault, choose the numeric channel slot, and generate a key. This enables “Require encryption” for that client and channel. Export the RMKEY1 bundle and privately import it on each other client selecting the same channel slot. Re-lock/reload requires that client's vault passphrase before decrypting or sending.
- Each channel uses a random 256-bit shared key. The web app creates an encrypted local vault with libsodium's Argon2id password hashing and XChaCha20-Poly1305 vault encryption. A passphrase must be at least 12 characters.
- A newly created channel key is required for encryption on that channel. The agent must unlock the vault after a page reload. Locking clears in-memory key records on a best-effort basis. The encrypted vault is stored in browser local storage; encryption policy is stored separately and is not secret.
- Export produces an `RMKEY1` text bundle containing the raw channel key. Transfer it privately to each authorized client and import it there under that client's chosen vault passphrase. The bundle is secret material; do not paste it into chat, issues, logs or public storage. Imported keys are assigned to the channel selected in the importing UI.
- Rotation creates a higher epoch and retains old epochs locally to decrypt earlier messages. Every peer must receive/import the new bundle before it can decrypt messages using that epoch. Remove access by rotating and securely distributing the new key; old recorded ciphertext remains readable to anyone who kept the old key.
- Direct routes currently use the selected channel's group key. Anyone holding that channel key can decrypt direct-routed messages; this is not pairwise private messaging.

Keys map to numeric channel slots; use the same slot on every client. Renaming a displayed channel while keeping its slot is fine. Moving it to another slot requires importing the bundle for that slot on each client.

This is a simple group-key design, not forward-secure. Any group member can decrypt and create valid ciphertext for the group; the envelope does not authenticate an individual sender. A compromised device exposes routing metadata and ciphertext. A compromised unlocked client can expose keys and plaintext. A browser vault at rest does not protect an unlocked session from malicious scripts, extensions, malware or a compromised OS. Replay suppression is bounded to the most recent 1024 envelope IDs retained in the local encrypted vault; replay state is local to that agent.

## Validation and release status

Automated checks cover key vault locking/wrong passphrase, key transfer between independent agents, authenticated context/tag failure, required policy, and encrypted payload recovery. Protocol/firmware tests verify opaque envelope admission and inbox retention. Both firmware targets build. Physical test on November 2, 2026: Heltec V3 and T-Beam V1.2 exchanged direct encrypted messages in both directions; both reached a device ACK, inbox entries retained the exact ciphertext with no plaintext, the shared key decrypted at the receiving client, and an unrelated key could not decrypt. The hardware script restored each board's starting radio configuration and wrote a local result to `build/tbeam-v12/encryption-smoke.json`. Reconnect/reboot during an uncertain encrypted upload, key rotation over actual radio, long-duration/RF edge cases and relay remain unqualified. Reproduce with both radios enabled and browser serial connections closed: `node tools/hardware-encryption-smoke.ts .tools/espressif/python_env/idf5.5_py3.12_env/bin/python /dev/cu.usbserial-0001 /dev/cu.wchusbserial57700003341`.

The UI and documentation are an initial implementation, not a security audit. Before general release, review envelope test vectors and browser dependency provenance; add pairwise direct-message keys and sender authentication only through a separately reviewed protocol change. The portal plugin architecture must not expose keys; decrypted plaintext is sensitive application data, and an in-process plugin must be treated as trusted code until actual isolation exists.
