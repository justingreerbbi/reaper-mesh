# Current status

Last updated: November 4, 2026.

This page is the single source for **what is implemented and verified right now**. When the
state changes, edit this page in place rather than appending to it. Dated test evidence belongs
in the [changelog](changelog.md); priorities belong in the [roadmap](roadmap.md).

> [!IMPORTANT]
> Reaper Mesh is a development prototype, not a production or certified release.

## Summary

| Phase | State |
| --- | --- |
| 1 — Working communications | Complete by owner decision. Three-node relay, range and power-cut testing are still open release gates. |
| 2 — Discovery and field portal | Active. Discovery (2.1) and fixed position (2.2a) are verified on two boards. GPS (2.2b) is deferred by the owner. New portal features (2.3) are paused until relay and range testing pass. |
| 3 — Encrypted channels | First implementation done and verified for direct messages between two boards. Rotation, interrupted-upload recovery and a security review are still open. |
| 4 — Device presentation and power | In progress: screen pages, buttons and screen timeout verified on the T-Beam. |

## Installed firmware

| Board | Reported version | Built from | Port |
| --- | --- | --- | --- |
| Heltec WiFi LoRa 32 V3 (ESP32-S3, SX1262, US/915) | `heltec-reaper-mesh-v0.9.0` | Local development build on `cce981e` with uncommitted changes, November 4; hashes in the install receipt | `/dev/cu.usbserial-0001` |
| LILYGO T-Beam V1.2 (ESP32, SX1276, AXP2101, US/915) | `tbeam-reaper-mesh-v0.9.0` | Local development build on `cce981e` with uncommitted changes, November 4; hashes in the install receipt | `/dev/cu.wchusbserial57700003341` |

Both boards are in Open mode, so traffic is not protected until team keys are loaded, and both antennas are owner-confirmed. After the owner-requested Heltec storage wipe, its verified configuration is revision 0, region unset, radio off, only Public configured, discovery and message wake off, and no saved BLE pairings. The T-Beam was not wiped. Before the wipe, the November 4 diagnostic read both boards at low power in mesh mode, with relay on; revisions were Heltec 77 and T-Beam 64. Earlier on November 4 the Heltec read high power and the T-Beam low power. The last recorded owner discovery policies before the wipe were: Heltec beacon/respond off; T-Beam beacon/respond on; 300-second interval;
position source none and sharing off. Always read the current settings from the device rather
than assuming these. On November 3 the Heltec read beacon/respond on, a 60-second interval and a
shared fixed position, and its screen was left at a 10 s timeout with wake on.

## What works, and how it was verified

"Hardware" means tested on the physical boards; "host" means automated tests on a computer.

| Area | Implemented | Verified on hardware | Not yet verified |
| --- | --- | --- | --- |
| USB and configuration | Versioned handshake, capability gates, compare-and-set revisions, atomic NVS storage, startup retries, query-only recovery | Native browser saves and reconnects; lost reply, duplicate and reset recovery | Power cut, arbitrary cable removal, long soak |
| Device screen and buttons | Startup icon and title, main/nodes/debug pages, button gestures, T-Beam PWR shortcut; screen timeout and wake-on-message set from the portal; T-Beam battery percent and plugged-in indicator; Heltec calibrated battery-rail voltage and icon; reset reason on Debug in `v0.6.1`; bounded, fail-closed driver | Owner confirmed on the T-Beam: startup, pages, all gestures, PWR and 30 s timeout; battery percent with a battery fitted; bolt and `USB` when plugged in with no battery. Screen settings saved, read back and kept across a reboot over USB on both boards. Owner confirmed on the Heltec: a 10 s timeout and wake on a message from the T-Beam; battery icon and voltage visible after the `v0.6.1` install | Heltec voltage accuracy against a meter and battery-only behavior; the portal's Screen page in a native browser; Heltec page gestures; induced I2C faults; LED not built yet |
| Messages | 1,024-byte UTF-8 messages, bounded queue, explicit outcomes, inbox, browser journal | Bidirectional direct delivery with destination ACK between the two boards | Extended loss and latency; field use |
| Mesh relay | Bounded managed-flooding core with hop limits and duplicate suppression | Host topology and fault tests only | **Any real relay**: needs a third board |
| Radio | Radio version 2 frames (D50, Open mode). Pinned Semtech SX1262 driver, first-party SX1276 driver, shared airtime budget, DMA SPI; low, medium and high power with T-Beam boost in `v0.4.0` | Probe, receive, 7-fragment transmit, direct two-board delivery at every power level and with T-Beam boost; setting kept across a reset | Range, coexistence, measured spectrum and output power; the portal's power control in a native browser (clicked against the simulator) |
| Channels and settings | Eight channel slots identified on air by 32-bit channel IDs, `RMCH1` invites to join in any free slot, power level and boost, mode, relay flag, record migration (record 7) | Two boards on `v0.3.0`: existing channels kept after upgrade; a non-member neither shows nor can send on a channel; joined by invite in different slots (4 and 7) with direct, broadcast and encrypted messages; channel table survives reset; a removed channel can no longer be sent on or received | The new channel screens in a native browser over USB (clicked against the simulated device); relay on a channel ID; interference measurements |
| Discovery | Beacons, manual requests, rate-limited replies, node snapshots; all off by default | Two-board discovery, opt-out silence, periodic beacon | Native browser QA of the controls |
| Fixed position | Saved coordinates, opt-in sharing, versioned reports | Two-board coordinate exchange, privacy switch, reboot persistence | Native browser QA of the controls |
| Encryption | Agent-side XChaCha20-Poly1305 group keys per channel ID; devices carry RME2 ciphertext only | Encrypted direct messages in both directions, RME2 on a random-ID channel with the key from an invite | Reconnect or reboot during upload, key rotation over radio, relay, security review |
| Radio network | Radio version 2 frames (D50). Silent until a network is chosen; Open mode or a team with a stored relay key and a team key in memory; key changes need USB or the button window; no agent attached means no beacons or discovery replies | Two boards on `v0.9.0` over radio with throwaway keys: no network sends nothing, relay key alone cannot send, same team delivers both ways, a radio with the relay key but the wrong team key and a radio from another network each fail and are not heard, and a restart keeps the relay key and loses the team key. Open mode: encryption, channel, discovery, position and power checks all pass. The inbox alert arrives in both directions, and a 252-byte binary payload crosses exactly, with the inbox still reading afterward | **Relay in this format**, which needs a third board; radio silence and rejected frames measured by an independent receiver; a power cut during a key change on hardware; key change over Bluetooth; beacons stopping on detach; the placeholder for older agents on hardware; the portal's network control in a native browser; the mobile app, including background delivery; airtime; security review |
| Web portal | Follows the mobile app (D49): Comms, Map, Nodes and Device tabs, Night and Day themes, connect screen, rejoin on load and automatic reconnect, brevity phrases, channels with QR creation and scanning, deleting messages, conversations and channels, forgetting nodes and devices, measuring, MGRS readout, basemaps, following this browser's location, plus optional PIN, local wipe and JSON plugins | Earlier portal versions checked in native Brave over USB. The new interface was clicked through against the simulated device only, at desktop and phone sizes, including creating a channel, its QR code, reading that code from an image, encrypted sending, a lost link reconnecting, PIN lock, and deleting and forgetting | **Any real device with the new interface**: USB, Bluetooth, the camera scanner, browser location, and scanning between a phone and a browser; known map problems in the roadmap's [Planned after qualification](roadmap.md#planned-after-qualification) |
| Bluetooth link | Physical-access pairing by button or USB with a passkey on screen and in the portal, LE Secure Connections only, up to four paired devices, one session shared with USB, Web Bluetooth in the portal (D47) | Both boards boot `v0.6.0` with settings intact and open pairing over USB. Owner reported pairing, connecting and messages from the portal working. One pairing on the Heltec survived a firmware install, and the owner reported the browser reconnecting afterward without a passkey, and an unpaired phone being refused with the window closed. One earlier test run from Terminal.app did not pass, cause unknown | A wrong passkey,  effect on LoRa timing, iOS and Android |
| Firmware updates | Manifest-validating ROM updater that preserves NVS | Repeated installs on both boards | Interrupted flash, rollback, signed releases |

Map cleanup on November 4 adds explicit creation, a placement crosshair, visible-layer fit,
rectangle drag drawing with preview, consistent SVG symbols and full-screen mode. Host
checks pass. In-app browser QA verified full-screen mode, rectangle drag and local save;
touch drawing and physical-device workflows remain unqualified.
See the [map cleanup evidence](changelog.md#november-4-map-navigation-and-placement-cleanup).

## Next qualification work

New portal features are paused (November 3) until these pass; see the
[field qualification plan](../contributing/field-qualification.md).

| Test | State |
| --- | --- |
| Three-node relay | Not started: needs a third board and `tools/hardware-relay-smoke.ts` |
| Outdoor range (`US915_LAB1`) | Not started |
| Power loss and interrupted flash | Not started |
| 24-hour soak | Not started |

## Automated checks

`npm run check` passes all 352 tests on macOS as of November 4 (strict TypeScript,
generated-schema and vendor checks, compiler-backed host tests and the web build). The
standalone firmware CTest suite passes 116 tests. Both board target builds pass. CI runs the host checks, the CTest
suite, both firmware target builds and shell script lint; see
[Development and CI](../contributing/development.md).

## Not started or deferred

- GPS acquisition on the T-Beam (deferred by the owner on November 2).
- More than one device at a time in the browser (needs per-device journaling).
- Executable portal plugins and integrations such as Weather Radar, ADS-B and APRS (needs a
  plugin isolation decision first).
- EU transmission, other boards. No mobile app is in this repository, and iOS and Android are untested (D48). 
- Signed releases, automatic rollback and a published support policy.
- The rest of the trusted-device security model (D50, approved November 4). Step 1 is built and passes on two boards; see [Security architecture](../contributing/security-architecture.md). Not built: rotation and rekeying (step 2), background delivery in the mobile app (step 3), identity and private direct messages (step 4), channel rotation (step 5), creating or joining a team in the portal (step 6), so team keys can only be loaded with tools, and the host key and release hardening (step 7). An independent security review has not started.

## Hardware observations to keep in mind

The owner reports Heltec-only BLE disconnects after sending and receiving messages on
November 4. The owner clarified that the startup logo appeared on receipt, which points to a
reboot: normal message wake does not restart the logo sequence. The connected Heltec's application flash
matches the recorded `v0.6.0` binary by digest, so an older application under the same version
has been ruled out for the original report. `v0.6.2` is now installed with receive/output
backpressure handling, bounded notification retries, retained BLE reason codes and a shared-state
race fix. Device storage was wiped at the owner's request and default state verified. The original
logo/reboot cause remains unconfirmed, and phone BLE messaging after this fix is not yet verified.
The owner confirms the new battery icon and measured voltage are visible. See the
[fix and install evidence](changelog.md#november-4-ble-output-recovery-and-heltec-storage-reset-v062).
Twenty physical Heltec local deliveries over USB, including maximum-size messages and inbox
replacement, passed without reboot or heap loss. That check does not qualify BLE or RF reception.

These were each seen once and recovered. They are not failures to hide, and they are inputs to
future soak and interruption testing.

- Opening the Heltec's CP2102 port resets the board; negotiation must wait for boot.
- The T-Beam's first settings write once interrupted auxiliary reads; a reconnect recovered the
  committed revision without replay.
- The T-Beam once timed out reading a node snapshot during a long test; fresh sessions recovered.
- One Heltec install stopped responding at 70%; re-running the same validated install succeeded.
- The T-Beam's serial driver once rejected both interfaces until the USB cable was reconnected.
