# Reaper Mesh: AI contributor handoff

## Current stage

M0 foundations started on November 1, 2026 after owner clarification. The host foundations include configuration synchronization, bounded command/recovery tracking, USB framing, typed TLV payload validation, generated TypeScript declarations, and a byte-driven connection manager. A Web Serial adapter now owns asynchronous stream I/O and cleanup. Configuration commands/results and recovery queries now run through the serial stack. Capability negotiation gates writes by schema, safety features, owner admission, region, and label limits. Strict TypeScript checks, generated checks, and all 87 host tests pass on Node 25.9.0. A host-only reference device tests deduplication and revision conflicts; it is not firmware or evidence of durable flash behavior. The host stack checks envelope integrity, typed payload fields, link/session identity, snapshot correlation, and health deadlines. Serial I/O is tested with simulated ports only; no physical port has been opened. Firmware, web UI, and flash operations do not exist yet. Read `docs/PLAN.md`, `docs/DECISIONS.md`, and `docs/PROTOCOL.md` before implementation. Do not treat proposed choices as tested facts.

## Product intent

Build a deliberately small, reliable LoRa mesh messaging system. Start with one USB-connected Heltec WiFi LoRa 32 V3 and a desktop browser client. Grow to other boards, desktop/mobile clients, and BLE through explicit milestones. Avoid feature creep. Prioritize stable communications and compatibility rather than requiring all nodes and clients to update together.

Requested capabilities: channels (including public channels and defined channel roles/types), radio/power configuration, longer text messages, mesh relay, acknowledgments, and eventually channel encryption. Encryption is deferred, so early prototypes must clearly label radio traffic as plaintext and unauthenticated. Do not claim private or secure messaging.

Regional scope confirmed by the owner: initial development/operation in the US, with EU support later. Keep regional radio profiles separate from board capabilities and logical channels. Build the profile interface and tests from the start; do not enable EU transmission until the intended countries, hardware, and applicable settings are verified.

The owner confirmed an independent, documented Reaper Mesh protocol and defined RACE as synchronization/recovery reliability rather than a framework. Licensing is explicitly deferred. The board is owner-reported as a US Heltec V3; read-only USB inventory found a CP2102 bridge, which cannot verify RF band. See `docs/HARDWARE.md`.

## Engineering rules

- Keep device/client protocol, radio protocol, config schema, and firmware release versions separate. Negotiate supported versions and capabilities before mutations; refuse incompatible operations with actionable errors.
- Treat the device as authoritative for persisted configuration. Use revision-checked atomic writes, snapshot/event reconciliation, and explicit resynchronization after reboot, reconnect, or missing events.
- Make commands retry-safe with request IDs, bounded deduplication, session/boot identities, and documented behavior across reboot. Never blindly replay a message send after an ambiguous result.
- Distinguish queued, transmitted, recipient-acknowledged, failed, and unknown outcomes. USB acceptance and relay forwarding are not end-recipient delivery.
- Bound memory, queues, retries, message size, fragment count, reassembly lifetime, and airtime. No unbounded flooding or broadcast ACK storms.
- Race-condition tests are mandatory for meaningful communications changes. Include deterministic timing/fault injection and compatibility fixtures; do not use sleep-based tests as the primary correctness evidence.
- Keep transport-independent state out of UI components and board-specific pin/radio details out of the mesh core.
- Do not add GPS, MQTT, telemetry plugins, Wi-Fi networking, cloud accounts, voice, or arbitrary modules without a scope decision.
- Do not transmit until the board band, operating country/region, antenna, and allowed radio settings are confirmed. Never guess regulatory settings from the computer timezone.
- Do not erase or flash the owner's device until the specific image, backup/recovery plan, and flash operation are authorized. Planning authorization is not flash authorization.
- Never claim multi-device RF or real relay validation from a single board or simulator. Record untested cases.
- Do not burn irreversible security eFuses during prototyping. Firmware rollback and security anti-rollback require separate design decisions.
- Check dependency licenses before reuse. Do not assume Meshtastic code can be copied under an arbitrary project license.

## Working process

Proceed with M0 foundations within the confirmed independent-protocol and synchronization scope. Define observable acceptance criteria before coding. Run appropriate checks and report evidence and limitations. Update this file, the plan status, and decision log when scope or architecture changes. Keep protocol fixtures for previous supported releases so future agents cannot silently break compatibility.

## Next work

Continue M0: add embedded schema generation and the web UI, with write-blocked diagnostics and session retirement/owner-exhaustion recovery UX. Static type checks and a pinned GitHub CI workflow are configured; GitHub CI has not run because the repo has not been pushed. Configuration commands/results and query-only recovery are integrated with simulated USB tests; real firmware persistence remains pending. The serial adapter is implemented; read docs/SERIAL.md for ownership, cleanup, and native-I/O limits before integrating the UI. The dependency-free host TLV draft now uses schema.json for runtime descriptors and generated TS declarations; review serialization and add embedded code generation before firmware integration. Draft envelope v1 is implemented in packages/protocol/framing.ts with a shared golden fixture; Connection routes validated typed payloads to Synchronizer. Direct state-machine callers still require validated objects. Connection is caller-clocked and has bounded writes; it does not own a port or timers. Reset the decoder on reconnect and bound downstream queues. The reference device uses a bounded FIFO receipt cache plus non-evicting per-owner sequence high-water marks. Evicted IDs return unknown without reexecution. New owners are denied mutation admission when the owner table fills; capabilities expose the limits and reason, but safe session retirement/recovery UX remains pending. Do not erase those marks within a boot or wrap command counters. Read the retention draft in docs/PROTOCOL.md before changing it. Command manager incarnations must be freshly allocated and collision-resistant. Implement real device-side revision checks and persistence only after hardware verification. Verify hardware revision/band before firmware development. ESP-IDF is not currently on PATH. Channel semantics and message limits remain provisional; licensing is deferred by owner. EU support is a future requirement, not an enabled or validated region. Install pinned dev tools with `npm ci --ignore-scripts` and run `npm run check` (types, generated declarations, host tests). See docs/DEVELOPMENT.md. Runtime packages remain dependency-free; TypeScript/Node definitions are development dependencies only. Project licensing remains deferred.
