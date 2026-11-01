# Reaper Mesh: AI contributor handoff

## Current stage

Planning only, as requested by the project owner on November 1, 2026. No firmware, web app, tests, or flash operations exist yet. Read `docs/PLAN.md` and `docs/DECISIONS.md` before proposing implementation. Do not treat proposed choices as tested facts.

## Product intent

Build a deliberately small, reliable LoRa mesh messaging system. Start with one USB-connected Heltec WiFi LoRa 32 V3 and a desktop browser client. Grow to other boards, desktop/mobile clients, and BLE through explicit milestones. Avoid feature creep. Prioritize stable communications and compatibility rather than requiring all nodes and clients to update together.

Requested capabilities: channels (including public channels and defined channel roles/types), radio/power configuration, longer text messages, mesh relay, acknowledgments, and eventually channel encryption. Encryption is deferred, so early prototypes must clearly label radio traffic as plaintext and unauthenticated. Do not claim private or secure messaging.

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

Implement one milestone at a time after the owner accepts the plan. Define observable acceptance criteria before coding. Run appropriate checks and report evidence and limitations. Update this file, the plan status, and decision log when scope or architecture changes. Keep protocol fixtures for previous supported releases so future agents cannot silently break compatibility.

## Next work

Resolve hardware band/revision and operating region; confirm what “RACE tests” means (currently interpreted as concurrency/race-condition testing); settle independent protocol versus Meshtastic interoperability, channel semantics, license, and provisional message limits. Then begin M0 in `docs/PLAN.md`.
