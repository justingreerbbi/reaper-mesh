# Development plan

Status: M0 started. Independent protocol, US-first operation, synchronization/recovery focus, and licensing deferral are confirmed. Remaining architectural choices are provisional.

## Progress

The transport-independent TypeScript configuration synchronizer, command tracker, and bounded USB envelope codec now include typed payload validation, generated TS declarations, and byte-driven connection management with 55 deterministic host tests. Run `npm test` with Node 24–25 (locally verified on 25.9.0). Tests cover snapshot/event ordering, duplicates, gaps, revision mismatch, buffer overflow, delayed snapshot responses, incompatible versions, reconnect isolation, lost command responses, bounded retries, concurrent writes, query-only recovery, and reboot ambiguity. The host reference device tests command semantics without real persistence; production receipt retention/reclamation is still pending. See `docs/PROTOCOL.md` for the implemented semantic boundary and remaining work. Draft envelope v1 framing is implemented with COBS, length/version checks, CRC, and a golden fixture. Split reads, corruption, oversize recovery, and seeded noise are tested. Typed negotiation/sync/health messages, link/session isolation, bounded outgoing work, deadline handling, and rollback-resistant snapshots are implemented. Physical serial I/O, wire config commands/results, firmware, web UI, radio messages, and RF behavior remain unimplemented. Serialization is a provisional schema-driven TLV draft; embedded code generation and serialization review are pending. M0 is not complete.

## Product boundary

Deliver reliable text messaging and device configuration through a small USB web client, backed by custom firmware on Heltec V3. Start with one public channel and a fixed regional radio preset. Add bounded long-message fragmentation, relay behavior, and additional logical channels deliberately. BLE, mobile/native clients, encryption, and extra boards follow later. No cloud service is required.

Longer messages consume more radio airtime and may reduce reliability. A successful first release needs explicit resource budgets and realistic measurements, not just a larger text field. Maintaining old versions indefinitely is also not a security strategy: publish a support window, compatible release ranges, and security advisories without making routine upgrades mandatory for communication.

## Architecture

Use a monorepo with separately testable embedded core, board adapter, schema package, transport-independent client core, and web UI. Firmware is provisionally ESP-IDF/C++; client is provisionally TypeScript/React/Vite. Evaluate a maintained SX1262 driver and bounded Protocol Buffers implementation before committing dependencies. Pin toolchains and dependencies once validated.

The board adapter owns pins, reset/boot behavior, SX1262 access, display, and storage. The embedded core owns scheduling, queues, messages, configuration, and forwarding. UI and firmware consume generated bindings from reviewed schemas and common golden fixtures; hand-maintained duplicate schemas are prohibited.

Desktop USB uses Web Serial in a supported Chromium browser with explicit port selection and secure-context requirements (HTTPS or local development). Browser support must be documented; do not promise all browsers or mobile USB. The app initially runs on the computer, not the device. Keep the transport interface suitable for later BLE without implementing BLE now.

## Regional support: US first, EU later

Initial development and operation are in the US; EU support is an explicit future requirement. Design a versioned regional-profile interface in M0 and implement the verified US profile first. Keep frequency plans, permitted modem settings, transmit-power constraints, and airtime/access policies in profiles rather than scattering US assumptions throughout routing and UI code. Numeric regulatory limits must be researched against current authoritative sources when implementing each profile.

Validate the selected profile against the board's supported band and antenna configuration in firmware; client-side validation alone is insufficient. An unset, unsupported, or incompatible profile leaves transmission disabled while USB configuration remains available. Expose the active profile and profile version through the handshake and configuration snapshot. Region changes use revision-checked configuration and must quiesce pending transmissions so queued packets cannot leak out under stale settings.

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
- Unknown optional fields remain compatible; unsupported required behavior is rejected explicitly. Publish a release compatibility matrix and fixtures, with a proposed minimum of current and previous stable client/device minor versions within one major protocol version.

## Mandatory verification

Use a deterministic simulator with a fake clock, seeded scheduler, virtual radio/serial transports, and reproducible failure traces. Test the actual protocol/state-machine code wherever possible; simulator-only duplicate implementations are insufficient.

Required race/fault cases: ACK before timeout handling; timeout and ACK at the same instant; duplicate request; lost response after durable commit; disconnect during send/configuration; reboot during handshake or snapshot; delayed event from an old boot; event gap during snapshot; concurrent configuration writes; fragmented/coalesced/corrupt serial reads; dropped, duplicate, reordered, missing, and conflicting radio fragments; relay loops; queue exhaustion; slow consumers; and retry storms. Assert bounded memory/retries, no stale-state overwrite, no duplicate user-visible acceptance inside the dedup window, and explicit ambiguous outcomes outside it.

Test two- and three-node topologies in simulation, including hidden links and asymmetric loss. Keep old/new protocol fixtures and generated-binding checks in CI. Add parser fuzzing and malformed-input limits. Use hardware checks for USB reconnect, persistent settings across reboot, and recovery. Keep destructive/flash hardware checks explicitly invoked.

One physical board can validate USB, local state, flash/recovery, and radio-driver initialization. It cannot establish RF delivery, RF ACK timing, interference behavior, or real multi-hop operation. Require at least two physical nodes for delivery tests and three for real relay qualification before claiming mesh reliability.

## Firmware updates

Provide a guided USB installer: identify board, show installed/target versions and protocol compatibility, offer configuration export, validate image/manifest and board target, flash with progress and recovery instructions, reconnect, then verify boot identity, version, configuration migration, and USB health. Research a browser serial flasher such as Espressif's implementation in M0; keep a documented CLI recovery route.

Separate factory installation through ROM serial flashing from application-level updates. Whole-flash writes do not inherit application rollback guarantees. Prototype a dual-slot application update path over USB only after boot/partition support is verified; hash images, validate target/size, retain a working slot, mark the new image valid after self-tests, and roll back failed boots. Test interrupted transfers, power loss, wrong-board/corrupt images, full storage, failed migrations, and older client/newer firmware combinations.

Release artifacts need a board-specific manifest with firmware version, USB/radio protocol ranges, config schema, size, hash, toolchain, and release notes. Plan authenticated release manifests/images and trust-key distribution before public updater release; checksums alone do not authenticate firmware. Do not enable irreversible secure-boot/anti-rollback eFuses in development. Config migration must be transactional and recovery-aware, including what happens if downgraded firmware cannot read a newer schema.

## Milestones and acceptance gates

| Milestone | Deliverable | Acceptance gate |
| --- | --- | --- |
| M0: foundations | Confirm hardware/region, choose license and dependencies, freeze first schemas, budgets and compatibility policy, reproducible toolchains and CI | Reviewed protocol fixtures and race-test harness run on host; resource budget documented; no RF or flashing required |
| M1: USB vertical slice | Firmware handshake/status/config storage; web connect/status/config UI | One board connects, safely reconnects, persists config, rejects incompatible peers and stale revisions; mandatory USB race cases pass |
| M2: message model | Client send/history/status with simulated peers and bounded firmware queues | Duplicate/retry/loss cases converge or report unknown; ACK semantics and overflow behavior visible and tested |
| M3: radio and mesh | Regional preset, public channel, fragmentation, unicast ACK, forwarding | Simulator topology suite passes; real two-node and three-node gates separately recorded; RF claims blocked until hardware available |
| M4: channels and release UX | Named channels, roles, transmit-power configuration; guided USB installer/recovery | Channel isolation semantics documented; region enforcement tested; update interruption, migration, and compatibility tests pass |
| M5: release hardening | Resource/airtime measurements, soak tests, signed release artifacts, published support policy | No unresolved release-critical race faults; supported matrix passes; remaining hardware gaps block relevant reliability claims |
| Later | Authenticated channel encryption, BLE, other boards, native/mobile clients | Separate reviewed requirements and protocol extensions; no scope expansion by default |

## Documentation and evidence

Each milestone records what ran, against which firmware/client versions, simulation seed or hardware revision, pass/fail, and remaining limits. Track firmware size, peak RAM, queue/reassembly capacity, latency, retry counts, and radio airtime. Define numerical thresholds during M0/M3 measurement work before declaring a release ready.

## Primary references checked during planning

- [Heltec V3 product details](https://heltec.org/project/wifi-lora-32-v3/): ESP32-S3 and SX1262 baseline; verify the actual board variant separately.
- [Web Serial API](https://developer.chrome.com/docs/capabilities/serial): browser permissions, streams, and connection lifecycle.
- [ESP-IDF ESP32-S3 updates](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/system/ota.html): partitions, validation, and rollback; these mechanisms require appropriate application/bootloader configuration.
- [Meshtastic radio configuration](https://meshtastic.org/docs/configuration/radio/lora/): reference terminology and regional configuration, not a Reaper Mesh specification or legal authorization.

Recheck implementation APIs against the exact pinned versions before coding.
