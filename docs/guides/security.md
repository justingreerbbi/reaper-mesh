# Security and privacy

This page explains what Reaper Mesh protects, how to set each protection up, and where the
limits are. It describes what is built today. The approved plan for the rest is in
[Security architecture](../contributing/security-architecture.md) (decision D50).

> [!WARNING]
> None of this has had an independent security audit. Treat it as a well-designed first
> implementation, not a guarantee.

## What protects what

Reaper Mesh has three independent layers. You can use any combination.

| Layer | Protects | Where the keys live | Set it up in |
| --- | --- | --- | --- |
| **Team network** | Who can read, send and relay over the radio at all, including discovery and positions | Relay key on the board; team key in the app, loaded into the board's memory | **Device → Radio network** |
| **Channel encryption** | The text of messages on one channel | Only in the apps. Boards never see channel keys | **Device → Channels** |
| **App PIN** | Keys and messages saved in this browser | In this browser | **Device → This app** |

**Open mode** is the alternative to a team: any Reaper Mesh radio can hear and join, and
discovery and positions are readable by anyone in range. Channel encryption still protects
message text in Open mode.

## Team networks

A team is a private radio network. Radios outside it cannot read your traffic, send into it, or
relay it.

**Set up a team:**

1. Connect a board over USB and open **Device → Radio network**.
2. Select **Create** to make a new team, or **scan** a teammate's team QR code.
3. Choose **Add this radio to the team**, or **Add as a relay only** for a radio that just
   forwards traffic. Adding a radio needs a USB cable, or the board's main button held for
   5 seconds when connected over Bluetooth.
4. Share the team code with teammates **in person**. Anyone who has it can join and read team
   traffic.

**How it behaves:**

- A board forgets its team key when it restarts, and the app reloads it on connect. So a
  member radio only works once an app that holds the keys connects to it. A relay radio never
  holds the team key at all.
- **Keys rotate automatically**, every 24 hours by default (6 hours to 7 days, or
  **Rotate now**). Rotation needs one radio on the team connected to an app on the team, since
  boards have no clock. Other radios follow when they hear it, and messages carry on across a
  rotation. Rotation limits what a key stolen later can read; it does not remove anyone.
- The page warns you if keys move well ahead of schedule (which can mean a wrong clock or
  someone misusing the keys), or when the team is running low on rotations (it has 4,096). A
  radio that was off for more than 1,024 rotations must be added again.
- Scanning a later code for a team you already have keeps your radios and moves you to the
  newer keys. An older code changes nothing.
- **There is no member removal yet.** To remove someone, create a new team and add every radio
  again.

## Channel encryption

Channel encryption keeps message text private between the people who have the channel's key.

**Set it up:**

1. In **Device → Channels**, create a channel with **Encrypt this channel** on (the default),
   or open an existing channel and select **Create a key**.
2. Select **Share**. The QR code is an `RMCH1` invite with the channel's ID, name and key.
3. Others select **Scan a channel QR code**. The key is saved before the channel reaches their
   board, so nobody ends up half-joined.

Public has no invite because every board already has it; its share code is an `RMKEY1` key
bundle. Treat every code as a secret: anyone who sees it, even in a photo, can read the channel.

**How it behaves:**

- The app encrypts before the message leaves your phone or computer. Boards carry and store
  only ciphertext, and the radio acknowledgment means the board received the ciphertext, not
  that anyone decrypted it.
- **Require encryption** is set per app. It blocks your outgoing plaintext and rejects incoming
  plaintext on that channel. It is not shared over the radio, so each person turns it on.
- **Rotate key** creates a new key generation (epoch). Older epochs are kept so earlier messages
  stay readable. Everyone must import the new code before they can read new messages.
- Removing a channel from a board keeps its key in the browser, so rejoining restores its
  history. Keys belong to the channel ID, not the slot.

## App PIN and local wipe

- **PIN lock** is optional and off by default. Turn it on in **Device → This app** with 4–6
  digits. Then keys are encrypted at rest, and connecting, reloading or **Lock app** asks for the
  PIN. Five wrong tries start a 30-second cooldown, growing to five minutes. There is no
  recovery if you forget it.
- **Erase everything in this browser** (type `WIPE` to confirm, also reachable from the lock
  screen) removes all Reaper Mesh keys, messages, settings and journals from this browser. It
  does not erase the board's settings or inbox, other browsers, or exported files. Messages
  still on the board may download again on reconnect.

## Limits to know

- **Shared keys are shared.** Anyone with a channel key can read every message on it and send
  messages that look like they came from another member. Direct messages use the channel's key,
  so they are not private from other key holders.
- **Not forward-secret.** Someone who keeps an old key can read recordings made with it.
  Rotation protects new traffic only.
- **Metadata shows.** Even encrypted, radios can see that traffic exists, its size and timing.
  In Open mode, discovery and positions are readable by anyone in range.
- **The PIN is a convenience lock.** A 4–6 digit PIN cannot resist offline guessing of copied
  browser storage, and nothing protects an unlocked app from malicious extensions or malware.
- **Plugins** never receive keys, but anything that runs inside the app must be trusted until
  code plugins run in an isolated sandbox (D40).

## Technical details

### RME2 message envelope

An encrypted message is an `RME2` envelope. Integers are little-endian. The 61-byte header is
authenticated, followed by the ciphertext and a 16-byte Poly1305 tag. The maximum envelope is
1,024 bytes, so encrypted text is at most 947 bytes.

| Offset | Length | Value |
| --- | ---: | --- |
| 0 | 4 | ASCII `RME` and version byte `0x02` |
| 4 | 1 | Suite `1`: XChaCha20-Poly1305-IETF |
| 5 | 4 | Channel ID; must match the radio header |
| 9 | 8 | BLAKE2b-8 key identifier |
| 17 | 4 | Key epoch |
| 21 | 24 | Random XChaCha20 nonce |
| 45 | 16 | Random, stable envelope message ID |
| 61 | variable | Ciphertext followed by the 16-byte tag |

The additional authenticated data binds the header, the envelope ID, the channel ID, the sender
node ID and the destination. Retries reuse the saved ciphertext byte for byte; recovery after a
lost link only queries and never re-encrypts. Boards check the marker, version, suite, channel,
key ID, epoch and size; only apps do cryptography. Data starting with `RME` that is malformed is
rejected, never shown as text. Replay protection remembers the last 1,024 envelope IDs per app.

### Key storage

Without a PIN, keys are stored in browser storage without a password. With a PIN, they are
encrypted with a key derived by Argon2id and sealed with XChaCha20-Poly1305 (libsodium). The PIN
is never stored. Cooldown state survives reloads.

### Team codes and radio frames

A team code is `RMTEAM2.` followed by base64url JSON holding `format`, `name`, `generation`,
`epoch`, `relay`, `team`, `proof`, `proofStart` and `rotationHours`. It carries the keys for the
current epoch only, so someone joining cannot read traffic recorded before then. How frames are
sealed, how epochs and proofs work and what each radio stores are in
[Radio protocol](../reference/radio-protocol.md) and the
[rotation design](../contributing/rotation-design.md).

### Test it on hardware

With both radios on and browser connections closed:

```sh
node tools/hardware-encryption-smoke.ts .tools/espressif/python_env/idf5.5_py3.12_env/bin/python \
  /dev/cu.usbserial-0001 /dev/cu.wchusbserial57700003341
```
