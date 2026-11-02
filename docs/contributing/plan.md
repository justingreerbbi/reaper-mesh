# Development plan

Current product priorities are in the [roadmap](../overview/roadmap.md). Phase 1 is complete by owner direction; Phase 2 is active. Its contract and acceptance criteria are in the [Phase 2 contract](phase-2.md). The M0–M5 table below is historical engineering organization, not the current product phase order.

Status: focused USB/local-messaging prototype implemented and hardware-tested. Independent protocol, US-first operation, synchronization/recovery focus and licensing deferral are confirmed. See ../overview/status.md for evidence and remaining external qualification gates.

## Progress

USB authority/NVS, RACE recovery, OLED, public/named channels and radio settings, 1024-byte messages, local inbox, bounded independent mesh, browser reload journal, live diagnostics and manifest-validating ROM updater are implemented. Native Brave settings/reconnect/local messaging/reload checks pass. The US board and attached 915 MHz antenna are owner-confirmed. Full-fragment radio TX qualification is separate from real two-/three-node delivery. Power-cut, interference and field tests remain release gates; later BLE/encryption/mobile/EU scope is unchanged.

## Product boundary

Deliver reliable text messaging and device configuration through a small USB web agent, backed by custom firmware on Heltec V3. Start with one public channel and a fixed regional radio preset. Add bounded long-message fragmentation, relay behavior, and additional logical channels deliberately. BLE, mobile/native agents, encryption, and extra boards follow later. No cloud service is required.

Longer messages consume more radio airtime and may reduce reliability. A successful first release needs explicit resource budgets and realistic measurements, not just a larger text field. Maintaining old versions indefinitely is also not a security strategy: publish a support window, compatible release ranges, and security advisories without making routine upgrades mandatory for communication.

## Architecture

Use a monorepo with separately testable embedded core, board adapter, schema package, transport-independent agent core, and web UI. Firmware is provisionally ESP-IDF/C++; the first agent uses TypeScript/Vite with native DOM controls; a runtime UI framework is deferred until needed. Evaluate a maintained SX1262 driver and bounded Protocol Buffers implementation before committing dependencies. Pin toolchains and dependencies once validated.

The board adapter owns pins, reset/boot behavior, SX1262 access, display, and storage. The embedded core owns scheduling, queues, messages, configuration, and forwarding. UI and firmware consume generated bindings from reviewed schemas and common golden fixtures; hand-maintained duplicate schemas are prohibited.

Desktop USB uses Web Serial in a supported Chromium browser with explicit port selection and secure-context requirements (HTTPS or local development). Browser support must be documented; do not promise all browsers or mobile USB. The app initially runs on the computer, not the device. Keep the transport interface suitable for later BLE without implementing BLE now.

## Regional support: US first, EU later

Initial development and operation are in the US; EU support is an explicit future requirement. Design a versioned regional-profile interface in M0 and implement the verified US profile first. Keep frequency plans, permitted modem settings, transmit-power constraints, and airtime/access policies in profiles rather than scattering US assumptions throughout routing and UI code. Numeric regulatory limits must be researched against current authoritative sources when implementing each profile.

Validate the selected profile against the board's supported band and antenna configuration in firmware; agent-side validation alone is insufficient. An unset, unsupported, or incompatible profile leaves transmission disabled while USB configuration remains available. Expose the active profile and profile version through the handshake and configuration snapshot. Region changes use revision-checked configuration and must quiesce pending transmissions so queued packets cannot leak out under stale settings.

The airtime scheduler must account for fragments, retries, ACKs, and forwarded traffic under the active profile. Test profile mismatch, invalid power/frequency requests, region changes during queued sends, reboot persistence, and airtime exhaustion from the beginning. Use synthetic restrictive profiles for host tests until actual EU profiles are specified; simulation is not evidence of regulatory compliance.

Before enabling EU support, identify target countries/bands, verify compatible hardware, research applicable requirements, and run region-specific hardware and airtime qualification. Do not assume a US device can switch to EU operation solely through a software setting.

## Protocol and synchronization contract

Specify USB and radio protocols independently before implementing the core:

- Handshake reports device ID, boot/session identity, firmware build, supported protocol ranges, capabilities, limits, configuration schema/revision, and current event sequence.
- USB frames have bounded size, explicit delimiter/framing, integrity check, typed payload, request ID, and structured errors. Parsers tolerate split/concatenated/corrupt frames and recover without interpreting debug logs as commands.
- Connection states: disconnected, opening, negotiating, synchronizing, ready, recovering, incompatible. Mutations are allowed only after negotiation and synchronization.
- Subscribe and snapshot must define a common sequence boundary. Buffer/replay events around the snapshot; detect gaps and resnapshot. A reboot changes boot identity and invalidates stale replies/events.
- Configuration uses compare-and-set revisions and atomic persistence. ACK a successful write only after persistence succeeds. A dropped response is resolved by querying state/request status, not blindly overwriting.
- Message sends use stable sender/message identity and bounded retry-safe acceptance. Define deduplication lifetime and retention across reboot. Crash ambiguity becomes `unknown` until resolved; exactly-once delivery is not promised.
- Radio packets carry network/protocol identity, origin/message ID, destination/channel, hop budget, fragment metadata, and payload limits. Validate all metadata before allocating memory.
- Start with bounded managed flooding: randomized forwarding, duplicate suppression, hop limit, queue limits, expiry, and airtime scheduling. Freeze retransmission/dedup rules in fixtures.
- Unicast destination ACKs indicate complete reassembly/acceptance at the destination; they do not prove a human read the message. Broadcast has no all-recipient delivery guarantee. Never ACK every broadcast at every node.
- Distinguish channel identity from physical frequency/modem presets. Nodes need compatible radio settings to communicate; logical channels do not create additional RF capacity or confidentiality.
- Unknown optional fields remain compatible; unsupported required behavior is rejected explicitly. Publish a release compatibility matrix and fixtures, with a proposed minimum of current and previous stable agent/device minor versions within one major protocol version.

## Mandatory verification

Use a deterministic simulator with a fake clock, seeded scheduler, virtual radio/serial transports, and reproducible failure traces. Test the actual protocol/state-machine code wherever possible; simulator-only duplicate implementations are insufficient.

Required race/fault cases: ACK before timeout handling; timeout and ACK at the same instant; duplicate request; lost response after durable commit; disconnect during send/configuration; reboot during handshake or snapshot; delayed event from an old boot; event gap during snapshot; concurrent configuration writes; fragmented/coalesced/corrupt serial reads; dropped, duplicate, reordered, missing, and conflicting radio fragments; relay loops; queue exhaustion; slow consumers; and retry storms. Assert bounded memory/retries, no stale-state overwrite, no duplicate user-visible acceptance inside the dedup window, and explicit ambiguous outcomes outside it.

Test two- and three-node topologies in simulation, including hidden links and asymmetric loss. Keep old/new protocol fixtures and generated-binding checks in CI. Add parser fuzzing and malformed-input limits. Use hardware checks for USB reconnect, persistent settings across reboot, and recovery. Keep destructive/flash hardware checks explicitly invoked.

One physical board can validate USB, local state, flash/recovery, and radio-driver initialization. It cannot establish RF delivery, RF ACK timing, interference behavior, or real multi-hop operation. Require at least two physical nodes for delivery tests and three for real relay qualification before claiming mesh reliability.

## Firmware updates

Provide a guided USB installer: identify board, show installed/target versions and protocol compatibility, offer configuration export, validate image/manifest and board target, flash with progress and recovery instructions, reconnect, then verify boot identity, version, configuration migration, and USB health. Research a browser serial flasher such as Espressif's implementation in M0; keep a documented CLI recovery route.

Separate factory installation through ROM serial flashing from application-level updates. Whole-flash writes do not inherit application rollback guarantees. Prototype a dual-slot application update path over USB only after boot/partition support is verified; hash images, validate target/size, retain a working slot, mark the new image valid after self-tests, and roll back failed boots. Test interrupted transfers, power loss, wrong-board/corrupt images, full storage, failed migrations, and older agent/newer firmware combinations.

Release artifacts need a board-specific manifest with firmware version, USB/radio protocol ranges, config schema, size, hash, toolchain, and release notes. Plan authenticated release manifests/images and trust-key distribution before public updater release; checksums alone do not authenticate firmware. Do not enable irreversible secure-boot/anti-rollback eFuses in development. Config migration must be transactional and recovery-aware, including what happens if downgraded firmware cannot read a newer schema.

## Milestones and acceptance gates

| Milestone | Deliverable | Acceptance gate |
| --- | --- | --- |
| M0: foundations | Confirm hardware/region, defer license per owner, choose dependencies, freeze first schemas, budgets and compatibility policy, reproducible toolchains and CI | Reviewed protocol fixtures and race-test harness run on host; resource budget documented; no RF or flashing required |
| M1: USB vertical slice | Firmware handshake/status/config storage; web connect/status/config UI | One board connects, safely reconnects, persists config, rejects incompatible peers and stale revisions; mandatory USB race cases pass |
| M2: message model | Agent send/history/status with simulated peers and bounded firmware queues | Duplicate/retry/loss cases converge or report unknown; ACK semantics and overflow behavior visible and tested |
| M3: radio and mesh | Regional preset, public channel, fragmentation, unicast ACK, forwarding | Simulator topology suite passes; real two-node and three-node gates separately recorded; RF claims blocked until hardware available |
| M4: channels and release UX | Named channels, roles, transmit-power configuration; guided USB installer/recovery | Channel isolation semantics documented; region enforcement tested; update interruption, migration, and compatibility tests pass |
| M5: release hardening | Resource/airtime measurements, soak tests, signed release artifacts, published support policy | No unresolved release-critical race faults; supported matrix passes; remaining hardware gaps block relevant reliability claims |
| Later | Authenticated channel encryption, BLE, other boards, native/mobile agents | Separate reviewed requirements and protocol extensions; no scope expansion by default |

## Documentation and evidence

Each milestone records what ran, against which firmware/agent versions, simulation seed or hardware revision, pass/fail, and remaining limits. Track firmware size, peak RAM, queue/reassembly capacity, latency, retry counts, and radio airtime. Define numerical thresholds during M0/M3 measurement work before declaring a release ready.

## Primary references checked during planning

- [Heltec V3 product details](https://heltec.org/project/wifi-lora-32-v3/): ESP32-S3 and SX1262 baseline; verify the actual board variant separately.
- [Web Serial API](https://developer.chrome.com/docs/capabilities/serial): browser permissions, streams, and connection lifecycle.
- [ESP-IDF ESP32-S3 updates](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/system/ota.html): partitions, validation, and rollback; these mechanisms require appropriate application/bootloader configuration.
- [Meshtastic radio configuration](https://meshtastic.org/docs/configuration/radio/lora/): reference terminology and regional configuration, not a Reaper Mesh specification or legal authorization.

Recheck implementation APIs against the exact pinned versions before coding.

## Immediate priority: first USB-only board test

The USB-only application and NVS adapter are implemented and target-built. The owner waived backup/preservation, authorized the first flash, and the initial USB hardware checks now pass; see ../guides/first-flash.md. The partial backup is not a recovery image. Display and RF remain disabled.

## USB startup recovery evidence

USB startup recovery is implemented: repeat the same hello at most once per 500 ms while negotiating, without extending the five-second deadline. Retries do not accumulate behind queued writes; welcome retires any unsent hello. No configuration mutation is replayed. All 131 host tests and the web build pass. The actual TypeScript Connection reached ready on three consecutive physical serial opens in 647/646/650 ms using a Python byte bridge, with persisted revision 2 unchanged. This qualifies the agent protocol startup path; browser permission/stream behavior remains unverified on hardware.

The physical check was also extended to the real SerialAdapter using standard Web Streams over the Python serial byte bridge. Three consecutive opens reached ready in 626/645/648 ms, with revision 2 unchanged. Native browser permission, chooser, and browser-specific stream behavior remain pending.

## Browser hardware evidence

November 1, 2026: native Brave Web Serial hardware QA passed against usb-prototype-0 on the Heltec V3. The browser chooser selected CP2102 cu.usbserial-0001; the console reached Connected · synchronized with revision 2. Saving label Reaper Mesh V3 returned Committed on device and revision 3. Explicit disconnect released the port and disabled editing; reconnect through the chooser returned the same label/revision and preserved the page-session command history. The radio remained disabled. Screenshot evidence is local/ignored at build/heltec-v3/browser-usb.png. Physical cable removal, browser reload during an uncertain command, real power loss, display, and RF remain unqualified.

## OLED status implementation

OLED status is implemented for Heltec V3 SSD1306: SDA17/SCL18, reset21, active-low Vext36, address0x3c. The first-party driver/font uses a fixed 1025-byte transfer buffer, 400 kHz I2C, 40 ms per-transfer timeout, and redraw-on-change at most twice per second. An initialization/transfer failure disables further display updates without blocking USB indefinitely. Screen rows show REAPER USB 1, logical USB READY/IDLE, persisted revision or UNKNOWN, STORE OK/FAULT, and RADIO OFF. READY requires synchronized state and a successful reply within eight seconds; it is not physical cable detection. Firmware advertises usb-prototype-1. All 134 host tests and the target build pass. Visual OLED rendering remains unverified until observed on the physical screen.

Installed OLED update from commit 5a72fe6 on November 1, 2026. Application size 227,440 bytes; SHA-256 3baba75a548faca771733ec7e917c8d79fc25f9ee9f104c65de95c3fdbd70c7a. Esptool verified all three artifacts. Three physical TypeScript Connection/SerialAdapter opens confirmed usb-prototype-1 and persisted revision 3, reaching ready in 650/649/648 ms. NVS was not erased. These serial results do not verify visible OLED pixels or actual display-fault behavior; visual confirmation and real I2C fault injection remain pending.

## Message/mesh progress

usb-prototype-2 was installed from commit 443326d (230,960-byte application, SHA-256 5edcc60831f7ecdf2aa1873b3960001c72fe5a3050d8a10d97993a70323a5f87). Esptool verified all artifacts. Physical TS agent/adapter testing accepted an exactly 1024-byte message, then observed failed/expired after the RF-disabled queue lifetime. Subsequent opens synchronized at persisted configuration revision 5. Native Brave also queued a multiline message, queried its status, and showed unknown on disconnect without resending it. Local screenshot: build/heltec-v3/browser-message.png. No RF transmission occurred.

The actual C++ Mesh/codec passes bounded line/triangle topology tests. Regional policy, persisted channel/radio configuration, board radio I/O, inbox synchronization, firmware updater UX, and real multi-node qualification remain.

## Current completion tracking

Use ../overview/status.md for implemented/evidenced versus remaining work. Integrated board SPI, diagnostics, inbox, local delivery, durable browser recovery and guided updater validation are implemented and exercised on hardware where applicable. Public release requires the separate hardening gates above. Physical multi-node gates remain explicit.

## Second board scope

Owner explicitly requested T-Beam V1.2 support after connecting it beside the Heltec. Add only the required board/radio/power adapter and safe target-aware build/update validation. Reuse the independent protocol and state machines; qualify USB/probe/local behavior before two-node RF. See ../guides/t-beam-v12.md.

Current Phase2 checkpoint: discovery2.1 and fixed-position2.2a are implemented/physically checked. Next2.2b is actual T-Beam GPS, followed by map/nodes/messaging portal2.3. See phase-2.md for current evidence and transient fault observations; the historical milestones above do not reorder owner phases.


## November 2: app-wide PIN and portal spacing

Owner replaces the vault UI with a browser-local, app-wide 4–6 digit PIN gate on device connection. One unlock opens every channel key and the workspace; manual Lock app, disconnect/reconnect and reload clear key access. Existing encrypted key records migrate without discarding key epochs or replay records. Argon2id/encrypted storage is retained, with a credential marker and persisted failed-attempt cooldown. This is not firmware/device authentication or an OS-backed login; short PINs remain susceptible to offline guessing. No USB/RF schemas or firmware changed. Settings and channel editor spacing now share a consistent rhythm, with anchored, viewport-bounded scrolling dialogs. Type checks, agent tests and web build are checked separately; full npm check is blocked by CRLF generated-file comparison and unavailable C++ compiler on this Windows host. No hardware qualification repeated.


### Optional PIN and emergency local wipe (owner clarification)

PIN protection is optional, off by default. Settings → Privacy enables or removes the browser-only PIN without losing channel keys or replay records. Unprotected storage is explicitly version2/protection=none; existing encrypted version1 records remain readable and protected until unlocked/migrated. The PIN does not authenticate or configure a device. Privacy and the lock screen offer a typed-WIPE local reset, with a cross-tab stop marker, checkpoint suppression, writer-lock coordination, local/session namespace deletion and a static replacement document. Never invoke the actual wipe against owner data merely to test it. Device inboxes/settings, exports, other profiles and forensic remnants are outside the local reset. No firmware/protocol files changed. Type checking, 166 non-compiler agent tests and production build pass; the full project check remains limited by Windows CRLF generated-file comparison and missing C++ toolchain.

## November 2: agent terminology

Repository terminology and application/core/tool paths now use agent consistently. Acceptance: imports and build commands resolve the renamed paths; strict TypeScript, frozen TS/C++ compatibility checks, compiler-backed recovery tests and the web build pass through `npm run check`. Validation: `npm ci --ignore-scripts` and `npm run check` pass on macOS, including strict TypeScript, generated schema/vendor verification, compiler-backed host tests and the production web build. This rename introduces no synchronization behavior change or new hardware qualification claim.

## November 2: separate sent retention from recovery admission

Completed outgoing messages no longer exhaust the 32-message recovery admission budget. Keep a rolling 160-entry outgoing history and retire only the oldest completed record when a validated new send needs space. Preserve unknown/unacknowledged unicast outcomes, monotonic IDs, checkpoint-before-dispatch and query-only reload recovery. Explicitly explain the remaining 32-unresolved safety limit. Browser journal bound is 1 MiB serialized characters; old journals remain readable without identity reset. No firmware/wire change or hardware qualification is implied. Regression exercises 500 completed sends, protected uncertainty and reload/counter continuity.

## November 2: task-first portal UX

Design for mixed technical experience: routine setup first, technical maintenance under Advanced, concise contextual explanations, proportional control widths, and primary actions beside their section or after their form. Region precedes name; Create channel sits beside Channels. Preserve opt-in privacy, explicit destructive confirmations and transport recovery semantics. See docs/guides/web-portal.md for review scope. No hardware/protocol change.
