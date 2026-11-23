# Current status

Last updated: November 17, 2026.

This page answers one question: **what works right now, and how do we know?** Edit it in place
when that changes. Plans belong in the [roadmap](roadmap.md) and release notes in the
[changelog](changelog.md).

> [!IMPORTANT]
> Reaper Mesh is a development prototype, not a production or certified release. "Verified on
> hardware" below means tested on two real boards on a bench, not in the field.

## At a glance

| Phase | State |
| --- | --- |
| 1 — Working communications | **Complete.** Two boards exchange messages with acknowledgments, and three boards relay on a desk. Relay with separated boards, range and power-cut tests are still open release gates |
| 2 — Discovery and field portal | **Active.** Discovery and fixed positions work on two boards. GPS is deferred. New portal features wait for field testing |
| 3 — Encrypted channels | **First version works** on two boards, including recovery from interrupted uploads. Channel key rotation and a security review are open |
| 4 — Device screen and power | **In progress.** Screen pages, buttons, screen settings, battery display and a status LED are built. Sleep modes are not |

## What works

**Hardware** means tested on the physical boards. **Host** means automated tests on a computer.

| Area | What is built | Verified on hardware | Not yet verified |
| --- | --- | --- | --- |
| USB link and settings | Versioned handshake, capability checks, revision-checked atomic saves, query-only recovery | Saves and reconnects from a real browser; recovery from a lost reply, a duplicate and a reset | Power cut, pulling the cable at random, long soak |
| Messages | 1,024-byte text, bounded queue, five distinct outcomes, inbox, browser journal | Direct delivery with acknowledgment in both directions between two boards | Long-term loss and latency; field use |
| Mesh relay | Bounded managed flooding with hop limits and duplicate suppression; origins space fragments so relays can forward them; a desk relay test build (D56) | Three boards on a desk: in Open mode nothing passes with relaying off; one-frame and 1,024-byte direct messages acknowledged both ways and broadcasts delivered once both ways through the relay. The same in Team mode with the relay as a member and holding only the relay key, and key rotation through the relay, including catching up after it was away | More than one relay; separated boards and range |
| Radio | Radio format version 2, SX1262, SX1276 and LR1110 drivers, shared airtime budget, low/medium/high power, T-Beam boost | Direct delivery at every power level, with and without boost; settings kept across a reset | Range, coexistence, measured output power |
| Channels | 8 slots with 32-bit on-air IDs, QR invites, remove and reset | Joining by invite into different slots; a non-member cannot see or send; channels survive a reset | Relay on a channel; the channel screens in a native browser over USB |
| Discovery and position | Beacons, manual discovery, rate-limited replies, saved fixed position, opt-in sharing | Two-board discovery, silence when opted out, periodic beacons, position exchange and persistence | Native browser QA of these controls |
| Channel encryption | XChaCha20-Poly1305 group keys in the app; boards carry ciphertext only | Encrypted direct messages both ways; faults during upload never resend, duplicate or leak plaintext | Restart during transmit, real cable pull, rotation over the air, relay, security review |
| Team networks | Open mode or a team; relay key stored, team key in memory; automatic key rotation with epoch proofs | Team membership, wrong-key and other-network rejection, restart behavior, and rotation on two boards and through a relay on a desk; set up and rotated through the portal by the owner | Rotation after the interval actually elapses, power cut during a key change, key changes over Bluetooth, security review |
| Bluetooth | Physical-access pairing, LE Secure Connections only, four paired devices, Web Bluetooth in the portal | Pairing, connecting, messaging and reconnecting after a firmware install, from the portal (owner-reported) | A wrong passkey; effect on LoRa timing. Phone results belong to the mobile app's repository |
| Device screen, buttons and LED | Startup screen, pages, button gestures, screen timeout, wake on message, battery display, status LED (off by default) | Confirmed by the owner on the Heltec V3 and T-Beam; settings round trip and persist over USB | Heltec battery voltage against a meter; the LED toggle in a native browser |
| Web portal | Comms, Map, Nodes and Device tabs; channels with QR codes; reconnect; optional PIN; local wipe; JSON plugins; map follow mode, node trails, track recording, USB GPS and message notifications (D59). Published at <https://reapermesh.com/web/> from `main` (D54) | Earlier versions in native Brave over USB; team setup, messaging and discovery on two boards (owner-reported) | The current interface on a real device for Bluetooth, the camera scanner and browser location; D59's follow, tracks, notifications and a real USB GPS receiver |
| Desktop app | Tauri 2 app for macOS, Windows and Linux with the portal and installer unchanged, a Rust USB serial bridge behind a Web Serial shim, and a tag-driven release workflow that publishes installers, firmware zips and checksums (D58); keeping the computer awake and system notifications (D59) | On the owner's Mac (November 17): the app builds (5 MB), lists both boards' USB ports in its own picker, connects the portal to the T1000-E with a live session (radio, power, nodes and packet counts), and opens the installer with its firmware list | Installing firmware from the app; keeping awake, notifications and location in the app (D59); the Windows and Linux builds; the release workflow, which has not run yet; Bluetooth (not built) |
| Firmware updates | Manifest-checking USB updater that keeps settings and keys; a browser installer at <https://reapermesh.com/flash/> with the same checks, serving the CI builds of `main` for every board in the [board list](../boards/README.md) (D54) | Many installs with the USB updater on the ESP32 boards; T1000-E installs and updates through the installer's serial DFU, including from the installer page | The installer page on an ESP32 board; interrupted flash, rollback, signed releases |
| Signals add-on (D60) | The [sensor protocol](../reference/sensor-protocol.md); add-on firmware for the XIAO ESP32-C5 (`xiaoc5-reaper-sensor-v0.1.0`) with a portable core; the agent's session and store; the portal's Signals tab with a radar, a detail panel, a kept history with notes and identification of each signal, radar zoom, Hunt, monitoring logs, Flock and Ring detection, alerts and known signals (D61), filters, CSV export, drone alerts and reconnecting; a simulated add-on | On the owner's C5: 2.4 and 5 GHz Wi-Fi and Bluetooth LE heard; a 60-second USB session from a scripted host using the agent's codec with no gaps or drops, and every report passing the agent's checks ([Phase 2](../contributing/signals-design.md#phase-2-add-on-firmware-and-the-portal-over-direct-usb)). The Signals tab was checked in a browser against the simulated add-on | The portal with the real add-on, including reconnecting it (owner to test); Remote ID and long-range Bluetooth from a real transmitter; current draw; the desktop app; installer and CI builds |

## Boards

Each board's own facts are on its [page](../boards/README.md); this table is what has been tested
on each. **Experimental** boards have not yet exchanged radio messages with the others.

| Board | Status | Verified on hardware | Not yet verified |
| --- | --- | --- | --- |
| [Heltec WiFi LoRa 32 V3](../boards/heltec-v3.md) | Supported | Everything in the table above, as the main bench board: messaging, relay, channels, discovery, team networks, Bluetooth, screen and LED, USB updater installs | Battery voltage against a meter; the browser installer on this board |
| [Heltec Wireless Stick V3](../boards/heltec-stick-v3.md) | Supported | Over the air with the T-Beam: direct both ways with acknowledgment, Public and channel broadcasts, invites, encryption, discovery both ways. Over USB: identity, SX1262 probe, local delivery, settings storage. The owner confirmed the compact screen shows content (D55) | Every compact page and the pairing passkey on screen; Bluetooth pairing; the LED, battery voltage and button gestures; installing from the browser installer |
| [LILYGO T-Beam V1.2](../boards/tbeam-v12.md) | Supported | Messaging, relay, channels, discovery, team networks and screen with the Heltec V3; every power level with and without boost; battery percent and plugged-in indicator | Measured output power; GPS (deferred) |
| [Seeed SenseCAP T1000-E](../boards/t1000-e.md) | Experimental | On the owner's unit (November 17): a first install over Meshtastic and updates, from the installer page (owner-reported) and with `tools/hardware-t1000e-install.ts`; USB sessions; the LR1110 probe (TCXO at 1.6 V, no errors); US receive mode; settings kept across reconnects, updates and restarts; a phone paired over Bluetooth and the app connects and sends messages through it (owner-reported) (D57). Host tests for the LR1110 driver and the DFU protocol | Transmitting and radio links with the other boards; the LED, button and battery voltage; PSA Crypto against the frame fixtures on the board |

## Website and mobile app

The website is live at <https://reapermesh.com/> (checked November 8): a landing page at the root,
the web portal at `/web/`, the firmware installer at `/flash/`, and the mobile app, support and
privacy pages the store listings link to. HTTPS works, and `www`, plain `http` and the old
`justingreerbbi.github.io/reaper-mesh/` address redirect to it. The installer serves
`v0.11.1` for all three boards, built by CI from a clean `31abc1b`. Installing from the live
installer onto a board has not been reported yet.

The iOS app is live on the [App Store](https://apps.apple.com/us/app/reaper-mesh/id6832375918)
(owner-reported, November 10), and the site's App Store buttons link to the listing. The Google
Play button says "Coming soon" until the Android app is approved. The app is developed in its own
repository (D48), which holds its test results.

## Development boards

These are the maintainer's bench boards. Settings change often during testing, so always read
the current settings from the board rather than this table.

| Board | Firmware | Port |
| --- | --- | --- |
| Heltec WiFi LoRa 32 V3 (ESP32-S3, SX1262, US/915) | `heltec-reaper-mesh-v0.11.1` | `/dev/cu.usbserial-0001` |
| LILYGO T-Beam V1.2 (ESP32, SX1276, AXP2101, US/915) | `tbeam-reaper-mesh-v0.11.1` | `/dev/cu.wchusbserial57700003341` |
| Heltec Wireless Stick V3 (ESP32-S3, SX1262, US/915) | `heltec-stick-reaper-mesh-v0.11.1` | `/dev/cu.usbserial-0001` (the same name the Heltec V3 gets) |
| Seeed SenseCAP T1000-E (nRF52840, LR1110, US/915) | `t1000e-reaper-mesh-v0.11.1` (local development build) | `/dev/cu.usbmodem2101` |

The Heltec V3 and T-Beam run local development builds on `9e17ca9` with uncommitted changes
(November 7), and both antennas are owner-confirmed. The Wireless Stick V3 runs a local
development build of `02db7a5` with its radio gate opened (November 8); its US/915 model and
antenna are owner-confirmed. The T1000-E's US/915 MHz model and built-in antenna are
owner-confirmed (November 17).

## Field qualification

New portal features are paused until these pass. Procedures are in the
[field qualification plan](../contributing/field-qualification.md).

| Test | State |
| --- | --- |
| Three-node relay | **Desk runs pass** in Open mode, in Team mode, with a relay-key-only relay and for key rotation through a relay, after a fragment-spacing fix. Separated boards are next ([details](../contributing/field-qualification.md#1-three-node-relay)) |
| Outdoor range (`US915_LAB1`) | Not started |
| Power loss and interrupted flash | Not started |
| 24-hour soak | Not started |

## Automated checks

`npm run check` passes all 510 tests on macOS (November 23): strict TypeScript, generated-schema
and vendor checks, compiler-backed host tests and the web and installer builds. The standalone
firmware CTest suite passes 144 tests. CI runs all of these plus formatting, shell lint and all
three board builds, and passed on `main` at `31abc1b`, which the site deploys only after; see
[Development and CI](../contributing/development.md).

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
