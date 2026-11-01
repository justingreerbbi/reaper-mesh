# Reaper Mesh: AI contributor handoff


First flash completed November 1, 2026 using commit c41dc6e, USB app SHA-256 bf2be8a9514df3f463d7edcfe76752d791ec7b871284f7e099d42bbb81cff523. Esptool verified all three written artifacts. Physical USB smoke checks passed: handshake/snapshot, NVS configuration commit, logical reconnect, retained receipt query, serial reopen, and reset with fresh boot identity and persisted revision/settings. Opening this CP2102 port reset the board; immediate negotiation timed out, while waiting two seconds succeeded. Browser Web Serial startup/retry handling needs qualification before calling the web path ready. No display, RF, physical cable-removal, power-cut, or long-duration qualification is claimed.

## Current stage

The USB-only ESP-IDF v5.5.4 application now builds for ESP32-S3/8 MB. It integrates the portable session engine, framed UART0 at 115200, fresh boot IDs, and a fail-closed NVS backend. GPIO12 holds the SX1262 in reset; Wi-Fi, BLE, display initialization, and RF transmission are disabled. All 128 host tests, strict/generated checks, web build, and 24 CTest cases pass locally. Native wire tests exercise the real TypeScript client against the C++ session, including reconnect recovery and uncertain persistence. Real device connection/persistence and power-loss qualification remain pending. ROM inspection/reset confirmed ESP32-S3 revision v0.2, 8 MB flash, secure boot disabled, and flash encryption disabled. The earlier read-only stage is superseded by the first-flash evidence above; no eFuses were changed. The owner explicitly declined preservation of the existing firmware/settings. Backup attempts are discontinued; the unverified partial read is not a recovery image. Review the exact image and ROM USB reinstall procedure before first-flash authorization. See docs/FIRST_FLASH.md.
## Product intent

Build a deliberately small, reliable LoRa mesh messaging system. Start with one USB-connected Heltec WiFi LoRa 32 V3 and a desktop browser client. Grow to other boards, desktop/mobile clients, and BLE through explicit milestones. Avoid feature creep. Prioritize stable communications and compatibility rather than requiring all nodes and clients to update together.

Requested capabilities: channels (including public channels and defined channel roles/types), radio/power configuration, longer text messages, mesh relay, acknowledgments, and eventually channel encryption. Encryption is deferred, so early prototypes must clearly label radio traffic as plaintext and unauthenticated. Do not claim private or secure messaging.

Regional scope confirmed by the owner: initial development/operation in the US, with EU support later. Keep regional radio profiles separate from board capabilities and logical channels. Build the profile interface and tests from the start; do not enable EU transmission until the intended countries, hardware, and applicable settings are verified.

The owner confirmed an independent, documented Reaper Mesh protocol and defined RACE as synchronization/recovery reliability rather than a framework. Licensing is explicitly deferred. The owner confirms a US Heltec V3 / Version 3 board with built-in display; Heltec calls its standard screen an OLED. Read-only USB inventory found a CP2102 bridge, which cannot verify RF band. See `docs/HARDWARE.md`.

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

Prioritize bounded hello negotiation recovery when opening USB resets the board, with deterministic tests, then qualify the actual browser Web Serial path. The initial immediate-reopen handshake timed out; a two-second settling interval worked in the physical smoke script. Do not replay mutations as connection recovery. Display, physical unplug/power-cycle, flash power-loss, messaging, owner retirement/page-reload recovery, and RF remain pending. The owner waived preservation of prior firmware/settings. Hardware smoke is explicitly opt-in and writes test settings/reset: see docs/FIRST_FLASH.md. Licensing remains deferred.
