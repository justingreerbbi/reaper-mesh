# Reaper Mesh: AI contributor handoff

## Current stage

M0 foundations started on November 1, 2026 after owner clarification. The independent protocol semantics and a transport-independent TypeScript configuration synchronizer have been added, with 11 passing host tests on Node 25.9.0. No firmware, web UI, wire decoder, or flash operations exist yet. Read `docs/PLAN.md`, `docs/DECISIONS.md`, and `docs/PROTOCOL.md` before implementation. Do not treat proposed choices as tested facts.

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

Continue M0: specify command/result retention and ambiguous-write recovery; choose bounded USB schemas/framing and generated bindings; add wire validation, lifecycle timeouts, and device-side revision checks. Verify hardware revision/band before firmware development. ESP-IDF is not currently on PATH. Channel semantics and message limits remain provisional; licensing is deferred by owner. EU support is a future requirement, not an enabled or validated region. Run host checks with `npm test`; no dependencies are currently required.
