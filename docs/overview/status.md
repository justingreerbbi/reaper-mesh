# Current status

Last updated: November 7, 2026.

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
| 3 — Encrypted channels | First implementation done and verified for direct messages between two boards, including recovery from interrupted uploads. Channel key rotation and a security review are still open. |
| 4 — Device presentation and power | In progress: screen pages, buttons, screen settings, battery display and a status LED are built. Sleep modes are not. |

## Installed firmware

| Board | Reported version | Built from | Port |
| --- | --- | --- | --- |
| Heltec WiFi LoRa 32 V3 (ESP32-S3, SX1262, US/915) | `heltec-reaper-mesh-v0.11.1` | Local development build on `9e17ca9` with uncommitted changes, November 7; hashes in the install receipt | `/dev/cu.usbserial-0001` |
| LILYGO T-Beam V1.2 (ESP32, SX1276, AXP2101, US/915) | `tbeam-reaper-mesh-v0.11.1` | Local development build on `9e17ca9` with uncommitted changes, November 7; hashes in the install receipt | `/dev/cu.wchusbserial57700003341` |

Both antennas are owner-confirmed, and on November 5 both boards read region US in mesh mode. On November 7 both boards read Open mode, which protects nothing. Settings change often during testing, so always read the current settings from the device rather than relying on this page.

## What works, and how it was verified

"Hardware" means tested on the physical boards; "host" means automated tests on a computer.

| Area | Implemented | Verified on hardware | Not yet verified |
| --- | --- | --- | --- |
| USB and configuration | Versioned handshake, capability gates, compare-and-set revisions, atomic NVS storage, startup retries, query-only recovery | Native browser saves and reconnects; lost reply, duplicate and reset recovery | Power cut, arbitrary cable removal, long soak |
| Device screen and buttons | Startup icon and title, main/nodes/debug pages, button gestures, T-Beam PWR shortcut; screen timeout and wake-on-message set from the portal; T-Beam battery percent and plugged-in indicator; Heltec calibrated battery-rail voltage and icon; reset reason on Debug in `v0.6.1`; bounded, fail-closed driver | Owner confirmed on the T-Beam: startup, pages, all gestures, PWR and 30 s timeout; battery percent with a battery fitted; bolt and `USB` when plugged in with no battery. Screen settings saved, read back and kept across a reboot over USB on both boards. Owner confirmed on the Heltec: a 10 s timeout and wake on a message from the T-Beam; battery icon and voltage visible after the `v0.6.1` install | Heltec voltage accuracy against a meter and battery-only behavior; the portal's Screen page in a native browser; Heltec page gestures; induced I2C faults |
| Status LED | One second lit at startup, pulse on radio activity, slow blink for waiting messages, and a setting in the portal that is off by default, stored in record 8 (D53), in `v0.11.1` | On both boards over USB: the setting reads off after install, and saved on and off, each kept across a restart, with other settings unchanged. 1,024-byte messages cross in both directions with a destination ACK on this build. On the T-Beam, the owner saw the red light flash on sending and on receiving, blink for a waiting message, and stop on a button press. On the Heltec, the owner saw the white light at startup and flashing while direct messages arrived. Those two checks were on `v0.11.0`, when it was on by default, and have not been repeated | The toggle in a native browser (clicked against the simulated device); the Heltec's slow blink stopping on a button press |
| Messages | 1,024-byte UTF-8 messages, bounded queue, explicit outcomes, inbox, browser journal | Bidirectional direct delivery with destination ACK between the two boards | Extended loss and latency; field use |
| Mesh relay | Bounded managed-flooding core with hop limits and duplicate suppression | Host topology and fault tests only | **Any real relay**: needs a third board |
| Radio | Radio version 2 frames (D50, Open mode). Pinned Semtech SX1262 driver, first-party SX1276 driver, shared airtime budget, DMA SPI; low, medium and high power with T-Beam boost in `v0.4.0` | Probe, receive, 7-fragment transmit, direct two-board delivery at every power level and with T-Beam boost; setting kept across a reset | Range, coexistence, measured spectrum and output power; the portal's power control in a native browser (clicked against the simulator) |
| Channels and settings | Eight channel slots identified on air by 32-bit channel IDs, `RMCH1` invites to join in any free slot, power level and boost, mode, relay flag, record migration (record 7) | Two boards on `v0.3.0`: existing channels kept after upgrade; a non-member neither shows nor can send on a channel; joined by invite in different slots (4 and 7) with direct, broadcast and encrypted messages; channel table survives reset; a removed channel can no longer be sent on or received | The new channel screens in a native browser over USB (clicked against the simulated device); relay on a channel ID; interference measurements |
| Discovery | Beacons, manual requests, rate-limited replies, node snapshots; all off by default | Two-board discovery, opt-out silence, periodic beacon | Native browser QA of the controls |
| Fixed position | Saved coordinates, opt-in sharing, versioned reports | Two-board coordinate exchange, privacy switch, reboot persistence | Native browser QA of the controls |
| Encryption | Agent-side XChaCha20-Poly1305 group keys per channel ID; devices carry RME2 ciphertext only | Encrypted direct messages in both directions, RME2 on a random-ID channel with the key from an invite. [Faults during upload and inbox reads](changelog.md#november-5-interrupted-encrypted-uploads) on two boards over radio, in Open mode both ways and on a team one way, with a test tool: a message is never resent or duplicated, a partial upload is never delivered, and no plaintext reaches USB or a journal | A restart while a message is going over the air, a cable physically pulled mid-upload, a real browser reload, channel key rotation over radio, relay, security review |
| Radio network | Radio version 2 frames (D50). Silent until a network is chosen; Open mode or a team with a stored relay key and a team key in memory; key changes need USB or the button window; no agent attached means no beacons or discovery replies. Keys rotate automatically with epoch proofs (D52), set from the portal | Two boards on `v0.9.0` over radio with throwaway keys: no network sends nothing, relay key alone cannot send, same team delivers both ways, a radio with the relay key but the wrong team key and a radio from another network each fail and are not heard, and a restart keeps the relay key and loses the team key. Open mode: encryption, channel, discovery, position and power checks all pass. The inbox alert arrives in both directions, and a 252-byte binary payload crosses exactly, with the inbox still reading afterward. Through the portal in native Brave over USB, the owner reported on November 5: [team setup on two boards](changelog.md#november-5-team-page-on-two-real-boards), joining by a pasted code, messages under the team key, the key reloading after a restart, moving a radio to relay and back, and leaving for Open mode. On `v0.10.0` over radio with throwaway keys and a test tool: [rotation on two boards](changelog.md#november-5-automatic-key-rotation-v0100-d50-step-2a): a radio follows a proof it hears with its team key carried along, messages cross a rotation both ways, a wrong proof is refused, a radio that was away reads newer traffic and later catches up from one proof, a radio with only the relay key follows, and a restart keeps the epoch. The owner reported rotation working through the portal on both boards, in native Brave over USB | The interval actually elapsing, because only **Rotate now** has been used on real boards; a relay-key thief over the air (host tests only, because firmware won't send a frame it can't verify); lockout after more than 1,024 epochs on hardware; **Relay in this format**, which needs a third board; radio silence and rejected frames measured by an independent receiver; a power cut during a key change on hardware; key change over Bluetooth, including the portal's button-window path; beacons stopping on detach; the placeholder for older agents on hardware; the mobile app, including background delivery; airtime; security review |
| Web portal | Follows the mobile app (D49): Comms, Map, Nodes and Device tabs, Night and Day themes, connect screen, rejoin on load and automatic reconnect, brevity phrases, channels with QR creation and scanning, deleting messages, conversations and channels, forgetting nodes and devices, measuring, MGRS readout, basemaps, following this browser's location, plus optional PIN, local wipe and JSON plugins. A radio that refuses a move to relay keeps its earlier role, and only a valid envelope marks a channel as encrypted | Earlier portal versions checked in native Brave over USB. The new interface was clicked through against the simulated device only, at desktop and phone sizes, including creating a channel, its QR code, reading that code from an image, encrypted sending, a lost link reconnecting, PIN lock, and deleting and forgetting. On November 5 the owner reported the Radio network page, messages and discovery working on two boards over USB in native Brave | **The rest of the new interface on a real device**: Bluetooth, the camera scanner, browser location, and scanning between a phone and a browser; a radio refusing a move to relay, and an unknown payload on a channel with no key (host tests only); known map problems in the roadmap's [Planned after qualification](roadmap.md#planned-after-qualification) |
| Bluetooth link | Physical-access pairing by button or USB with a passkey on screen and in the portal, LE Secure Connections only, up to four paired devices, one session shared with USB, Web Bluetooth in the portal (D47) | Both boards boot `v0.6.0` with settings intact and open pairing over USB. Owner reported pairing, connecting and messages from the portal working. One pairing on the Heltec survived a firmware install, and the owner reported the browser reconnecting afterward without a passkey, and an unpaired phone being refused with the window closed. One earlier test run from Terminal.app did not pass, cause unknown | A wrong passkey and the effect on LoRa timing. Phone results belong to the mobile app, which is tested outside this repository (D48) |
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
| Three-node relay | Not started: the owner expects a third board on November 7, and `tools/hardware-relay-smoke.ts` is not built yet |
| Outdoor range (`US915_LAB1`) | Not started |
| Power loss and interrupted flash | Not started |
| 24-hour soak | Not started |

## Automated checks

`npm run check` passes all 382 tests on macOS as of November 7 (strict TypeScript,
generated-schema and vendor checks, compiler-backed host tests and the web build). The
standalone firmware CTest suite passes 127 tests. Both board target builds pass. CI runs the host checks, the CTest
suite, both firmware target builds and shell script lint; see
[Development and CI](../contributing/development.md).

## Not started or deferred

- GPS acquisition on the T-Beam (deferred by the owner on November 2).
- More than one device at a time in the browser (needs per-device journaling).
- Executable portal plugins and integrations such as Weather Radar, ADS-B and APRS (needs a
  plugin isolation decision first).
- Processor sleep modes (Phase 4).
- EU transmission, other boards. The mobile app is built and tested outside this repository, so no iOS or Android results are recorded here (D48).
- Signed releases, automatic rollback and a published support policy.
- The rest of the trusted-device security model (D50, approved November 4). Steps 1 and 2a are built and pass on two boards; see [Security architecture](../contributing/security-architecture.md). Not built: rekeying and relay status (step 2b), background delivery in the mobile app (step 3), identity and private direct messages (step 4), channel rotation (step 5), the full team flows in the portal (step 6; a first version is built, D51, and passes on two boards over USB), and the host key and release hardening (step 7). An independent security review has not started.

## Hardware observations to keep in mind

The Bluetooth disconnects the owner reported on the Heltec on November 4 are closed. On November 7 the
owner reported the cause: a misaligned Bluetooth buffer in the mobile app that could break the
connection, fixed in the app, outside this repository. See the
[changelog](changelog.md#november-7-bluetooth-cause-and-documentation-review). The firmware's flow
control work from that investigation stays in place. If the startup logo ever appears on receiving
a message again, read the reset reason on the Debug page, because it would mean the board restarted.

A team radio writes to flash when it hears an epoch proof, and serial traffic arriving during that write used to overflow the serial buffer and end the session, on the Heltec in 9 of 22 runs of a stress sequence. `v0.10.0` keeps the serial interrupt running during flash writes, and the same sequence then passed 20 of 20 on the Heltec and 12 of 12 on the T-Beam. See the [changelog](changelog.md#november-5-automatic-key-rotation-v0100-d50-step-2a). The same fix covers settings saves, which had the same exposure.

These all recovered. They are not failures to hide, and they are inputs to future soak and
interruption testing.

- Opening the Heltec's CP2102 port resets the board; negotiation must wait for boot.
- The T-Beam's first settings write once interrupted auxiliary reads; a reconnect recovered the
  committed revision without replay.
- The T-Beam once timed out reading a node snapshot during a long test; fresh sessions recovered.
- One Heltec install stopped responding at 70%; re-running the same validated install succeeded.
- The T-Beam's serial driver once rejected both interfaces until the USB cable was reconnected. The Heltec's did the same on November 5, with `termios.error 22`, and reconnecting its cable cleared it. Later that day the T-Beam's did it again and the Heltec dropped off USB altogether, and properly reconnecting each cable at the computer cleared both.
