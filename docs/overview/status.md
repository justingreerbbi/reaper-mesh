# Current status

Last updated: November 3, 2026.

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
| Heltec WiFi LoRa 32 V3 (ESP32-S3, SX1262, US/915) | `usb-prototype-8` | Development tree, November 2 (`--allow-dirty`); last clean build `4209679` | `/dev/cu.usbserial-0001` |
| LILYGO T-Beam V1.2 (ESP32, SX1276, AXP2101, US/915) | `tbeam-reaper-mesh-v0.2.0` | Clean commit `bafa382`, November 3 | `/dev/cu.wchusbserial57700003341` |

Both antennas are owner-confirmed. The last recorded owner policies were: both boards in mesh
mode at 2 dBm; Heltec beacon/respond off; T-Beam beacon/respond on; 300-second interval;
position source none and sharing off. Always read the current settings from the device rather
than assuming these. Images now use `{device}-reaper-mesh-v{semver}` names; the Heltec gets its
first `heltec-reaper-mesh-v0.2.0` image when it is next updated.

## What works, and how it was verified

"Hardware" means tested on the physical boards; "host" means automated tests on a computer.

| Area | Implemented | Verified on hardware | Not yet verified |
| --- | --- | --- | --- |
| USB and configuration | Versioned handshake, capability gates, compare-and-set revisions, atomic NVS storage, startup retries, query-only recovery | Native browser saves and reconnects; lost reply, duplicate and reset recovery | Power cut, arbitrary cable removal, long soak |
| Device screen and buttons | Startup icon and title, main/nodes/debug pages, button gestures, T-Beam PWR shortcut; screen timeout and wake-on-message set from the portal; T-Beam battery percent and plugged-in indicator; bounded, fail-closed driver | Owner confirmed on the T-Beam: startup, pages, all gestures, PWR and 30 s timeout; battery percent with a battery fitted; bolt and `USB` when plugged in with no battery. Screen settings saved, read back and kept across a reboot over USB | Owner check of a changed timeout and wake-on-message on the screen; the portal Screen tab in a native browser; Heltec V3; induced I2C faults; LED not built yet |
| Messages | 1,024-byte UTF-8 messages, bounded queue, explicit outcomes, inbox, browser journal | Bidirectional direct delivery with destination ACK between the two boards | Extended loss and latency; field use |
| Mesh relay | Bounded managed-flooding core with hop limits and duplicate suppression | Host topology and fault tests only | **Any real relay**: needs a third board |
| Radio | Pinned Semtech SX1262 driver, first-party SX1276 driver, shared airtime budget, DMA SPI | Probe, receive, 7-fragment transmit, direct two-board delivery | Range, coexistence, measured spectrum and power |
| Channels and settings | Eight logical channels, power, mode, relay flag, record migration | Named-channel acceptance and policy changes | Channel isolation and interference measurements |
| Discovery | Beacons, manual requests, rate-limited replies, node snapshots; all off by default | Two-board discovery, opt-out silence, periodic beacon | Native browser QA of the controls |
| Fixed position | Saved coordinates, opt-in sharing, versioned reports | Two-board coordinate exchange, privacy switch, reboot persistence | Native browser QA of the controls |
| Encryption | Agent-side XChaCha20-Poly1305 group keys; devices carry ciphertext only | Encrypted direct messages in both directions | Reconnect or reboot during upload, key rotation over radio, relay, security review |
| Web portal | Messaging inbox, map with local and shared items, settings, optional PIN, local wipe, JSON plugins | Earlier portal versions checked in native Brave over USB | Native desktop QA of the map, sharing and plugin features |
| Firmware updates | Manifest-validating ROM updater that preserves NVS | Repeated installs on both boards | Interrupted flash, rollback, signed releases |

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

`npm run check` passes all 276 tests on macOS as of November 3 (strict TypeScript,
generated-schema and vendor checks, compiler-backed host tests and the web build). The
standalone firmware CTest suite passes 75 tests. CI runs the host checks, the CTest
suite, both firmware target builds and shell script lint; see
[Development and CI](../contributing/development.md).

## Not started or deferred

- GPS acquisition on the T-Beam (deferred by the owner on November 2).
- More than one device at a time in the browser (needs per-device journaling).
- Executable portal plugins and integrations such as Weather Radar, ADS-B and APRS (needs a
  plugin isolation decision first).
- EU transmission, BLE, mobile and native agents, other boards.
- Signed releases, automatic rollback and a published support policy.

## Hardware observations to keep in mind

These were each seen once and recovered. They are not failures to hide, and they are inputs to
future soak and interruption testing.

- Opening the Heltec's CP2102 port resets the board; negotiation must wait for boot.
- The T-Beam's first settings write once interrupted auxiliary reads; a reconnect recovered the
  committed revision without replay.
- The T-Beam once timed out reading a node snapshot during a long test; fresh sessions recovered.
- One Heltec install stopped responding at 70%; re-running the same validated install succeeded.
- The T-Beam's serial driver once rejected both interfaces until the USB cable was reconnected.
