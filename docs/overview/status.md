# Current status

Last updated: November 7, 2026.

This page answers one question: **what works right now, and how do we know?** Edit it in place
when that changes. Plans belong in the [roadmap](roadmap.md) and release notes in the
[changelog](changelog.md).

> [!IMPORTANT]
> Reaper Mesh is a development prototype, not a production or certified release. "Verified on
> hardware" below means tested on two real boards on a bench, not in the field.

## At a glance

| Phase | State |
| --- | --- |
| 1 — Working communications | **Complete.** Two boards exchange messages with acknowledgments. Three-node relay, range and power-cut tests are still open release gates |
| 2 — Discovery and field portal | **Active.** Discovery and fixed positions work on two boards. GPS is deferred. New portal features wait for field testing |
| 3 — Encrypted channels | **First version works** on two boards, including recovery from interrupted uploads. Channel key rotation and a security review are open |
| 4 — Device screen and power | **In progress.** Screen pages, buttons, screen settings, battery display and a status LED are built. Sleep modes are not |

## What works

**Hardware** means tested on the physical boards. **Host** means automated tests on a computer.

| Area | What is built | Verified on hardware | Not yet verified |
| --- | --- | --- | --- |
| USB link and settings | Versioned handshake, capability checks, revision-checked atomic saves, query-only recovery | Saves and reconnects from a real browser; recovery from a lost reply, a duplicate and a reset | Power cut, pulling the cable at random, long soak |
| Messages | 1,024-byte text, bounded queue, five distinct outcomes, inbox, browser journal | Direct delivery with acknowledgment in both directions between two boards | Long-term loss and latency; field use |
| Mesh relay | Bounded managed flooding with hop limits and duplicate suppression | Host tests only | **Any real relay**: needs a third board |
| Radio | Radio format version 2, SX1262 and SX1276 drivers, shared airtime budget, low/medium/high power, T-Beam boost | Direct delivery at every power level, with and without boost; settings kept across a reset | Range, coexistence, measured output power |
| Channels | 8 slots with 32-bit on-air IDs, QR invites, remove and reset | Joining by invite into different slots; a non-member cannot see or send; channels survive a reset | Relay on a channel; the channel screens in a native browser over USB |
| Discovery and position | Beacons, manual discovery, rate-limited replies, saved fixed position, opt-in sharing | Two-board discovery, silence when opted out, periodic beacons, position exchange and persistence | Native browser QA of these controls |
| Channel encryption | XChaCha20-Poly1305 group keys in the app; boards carry ciphertext only | Encrypted direct messages both ways; faults during upload never resend, duplicate or leak plaintext | Restart during transmit, real cable pull, rotation over the air, relay, security review |
| Team networks | Open mode or a team; relay key stored, team key in memory; automatic key rotation with epoch proofs | Team membership, wrong-key and other-network rejection, restart behavior, and rotation on two boards; set up and rotated through the portal by the owner | Rotation after the interval actually elapses, relay in this format, power cut during a key change, key changes over Bluetooth, security review |
| Bluetooth | Physical-access pairing, LE Secure Connections only, four paired devices, Web Bluetooth in the portal | Pairing, connecting, messaging and reconnecting after a firmware install, from the portal (owner-reported) | A wrong passkey; effect on LoRa timing. Phone results belong to the mobile app's repository |
| Device screen, buttons and LED | Startup screen, pages, button gestures, screen timeout, wake on message, battery display, status LED (off by default) | Confirmed by the owner on both boards; settings round trip and persist over USB | Heltec battery voltage against a meter; the LED toggle in a native browser |
| Web portal | Comms, Map, Nodes and Device tabs; channels with QR codes; reconnect; optional PIN; local wipe; JSON plugins. Published on GitHub Pages from `main` (D54) | Earlier versions in native Brave over USB; team setup, messaging and discovery on two boards (owner-reported) | The current interface on a real device for Bluetooth, the camera scanner and browser location |
| Wireless Stick Lite V3 target | `heltec-wsl-v3` build, updater, CI and browser installer support (D55) | Installed with the updater (all four images verified by the ROM). Five USB sessions; the board reports its own firmware name; SX1262 probe passes; 1,024-byte local delivery and inbox read; settings saved, read back on a new session and restored; the radio starts in listen-only mode and returns to its mode with nothing transmitted | Delivery to and from another board over the air; Bluetooth pairing over USB; the LED, battery voltage and button gestures; installing from the browser installer |
| Firmware updates | Manifest-checking USB updater that keeps settings and keys; a browser installer on GitHub Pages with the same checks (D54) | Many installs on both boards with the USB updater | **The browser installer on a real board**; interrupted flash, rollback, signed releases |

## Development boards

These are the maintainer's bench boards. Settings change often during testing, so always read
the current settings from the board rather than this table.

| Board | Firmware | Port |
| --- | --- | --- |
| Heltec WiFi LoRa 32 V3 (ESP32-S3, SX1262, US/915) | `heltec-reaper-mesh-v0.11.1` | `/dev/cu.usbserial-0001` |
| LILYGO T-Beam V1.2 (ESP32, SX1276, AXP2101, US/915) | `tbeam-reaper-mesh-v0.11.1` | `/dev/cu.wchusbserial57700003341` |
| Heltec Wireless Stick Lite V3 (ESP32-S3, SX1262, US/915) | `heltec-wsl-reaper-mesh-v0.11.1` | `/dev/cu.usbserial-0001` (the same name the Heltec V3 gets) |

The Heltec V3 and T-Beam run local development builds on `9e17ca9` with uncommitted changes
(November 7), and both antennas are owner-confirmed. The Wireless Stick Lite V3 runs a local
development build of `02db7a5` with its radio gate opened (November 8); its US/915 model and
antenna are owner-confirmed.

## Field qualification

New portal features are paused until these pass. Procedures are in the
[field qualification plan](../contributing/field-qualification.md).

| Test | State |
| --- | --- |
| Three-node relay | Not started. Waiting for a third board and `tools/hardware-relay-smoke.ts` |
| Outdoor range (`US915_LAB1`) | Not started |
| Power loss and interrupted flash | Not started |
| 24-hour soak | Not started |

## Automated checks

`npm run check` passes all 391 tests on macOS (November 7): strict TypeScript, generated-schema
and vendor checks, compiler-backed host tests and the web build. The standalone firmware CTest
suite passes 127 tests, and both board builds pass. CI runs all of these plus formatting and
shell lint; see [Development and CI](../contributing/development.md).

## Not started or deferred

- GPS on the T-Beam (deferred by the owner).
- More than one board at a time in the browser (needs per-device journaling).
- Code plugins such as weather radar, ADS-B and APRS (needs the sandbox design first, D40).
- Processor sleep modes.
- EU transmission and other boards.
- Signed releases, automatic rollback and a published support policy.
- The rest of the security model (D50): rekeying and relay status (step 2b), background
  delivery in the mobile app (3), private direct messages (4), channel rotation (5), full team
  flows (6) and host key and release hardening (7). See
  [Security architecture](../contributing/security-architecture.md). No independent security
  review has started.

## Known hardware quirks

These all recovered, and they are inputs to future soak and interruption testing.

- Opening the Heltec's CP2102 USB port resets the board, so the app waits for it to boot.
- The macOS serial driver has occasionally refused to open either board until the USB cable was
  reconnected at the computer.
- One Heltec install stopped at 70%. Running the same install again succeeded.
- If the startup logo ever appears when a message arrives, the board restarted. Check the reset
  reason on the screen's Debug page.
