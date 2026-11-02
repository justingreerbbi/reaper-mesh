# Reaper Mesh: AI contributor handoff


## Current stage

The focused single-board USB prototype is implemented. usb-prototype-6 from clean commit 56c8cf0 is installed with all three ROM hashes verified. The owner confirms the OLED works, the board is US Heltec V3 and its US/915 MHz antenna is attached. USB/NVS/RACE, browser saves/reconnect, local 1024-byte delivery/inbox, durable reload history, actual SX1262 probe/RX initialization and full-fragment TX are checked. All 194 host tests and 53 standalone CTests pass. See docs/STATUS.md and docs/COMPATIBILITY.md for precise evidence and release limits.

The RF test reached seven TX_DONE events for a 1024-byte broadcast, then three unreachable-unicast transmissions followed by explicit failure with no fabricated ACK. It restored off mode and verified three reconnects at revision 20. The owner subsequently selected mesh mode through the browser; final observed state was prototype-6/revision 21, probe OK, ready, TX 1 and local delivery. Preserve those user-selected settings; do not assume the device is still off.

The updater validates clean build provenance, target/schema/layout, outer and embedded hashes, ROM security state and immutable staged images; it preserves NVS and verifies each write. A local zip includes exact source, images, updater, hashes and retained notices. Native browser reload retains outgoing/inbox history. The SDK SPI non-DMA 64-byte limit caused prototype-5 to fail closed; prototype-6 enables DMA and checks the bus capacity. No old-firmware backup is required.

This is not a production-ready release. Actual remote RX/destination ACK needs a second board; relay qualification needs a third. Power-cut, interrupted-flash, coexistence and field-soak checks remain. EU/BLE/encryption/mobile/other boards and licensing stay deferred. Public signing/automatic rollback remain release hardening. Do not fabricate these external qualification results.

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
- The owner authorized the first Reaper flash, waived preserving previous firmware/settings, and asked to continue development/testing without repeated routine permission prompts. Continue reversible USB development and tests within this scope; review image/ROM recovery details for any further flash. Do not infer authorization for whole-chip erases, eFuse changes, or RF transmission.
- Never claim multi-device RF or real relay validation from a single board or simulator. Record untested cases.
- Do not burn irreversible security eFuses during prototyping. Firmware rollback and security anti-rollback require separate design decisions.
- Check dependency licenses before reuse. Do not assume Meshtastic code can be copied under an arbitrary project license.

## Working process

Proceed with M0 foundations within the confirmed independent-protocol and synchronization scope. Define observable acceptance criteria before coding. Run appropriate checks and report evidence and limitations. Update this file, the plan status, and decision log when scope or architecture changes. Keep protocol fixtures for previous supported releases so future agents cannot silently break compatibility.

## Next work

Use docs/STATUS.md as the current completion/qualification tracker. The focused single-board implementation and available hardware tests are complete; next qualify real two-/three-node receive/ACK/relay operation when hardware exists. Additional work should target the documented release gates, not add unrelated features. Never overwrite the owner's live radio settings as a side effect of a read-only check. The historical checkpoints below record earlier firmware states and must not override this current section.

## USB startup recovery evidence

USB startup recovery is implemented: repeat the same hello at most once per 500 ms while negotiating, without extending the five-second deadline. Retries do not accumulate behind queued writes; welcome retires any unsent hello. No configuration mutation is replayed. All 131 host tests and the web build pass. The actual TypeScript Connection reached ready on three consecutive physical serial opens in 647/646/650 ms using a Python byte bridge, with persisted revision 2 unchanged. This qualified the client protocol startup path before the subsequent native browser check below.

The physical check was also extended to the real SerialAdapter using standard Web Streams over the Python serial byte bridge. Three consecutive opens reached ready in 626/645/648 ms, with revision 2 unchanged. Native browser permission, chooser, and stream behavior were subsequently checked as recorded below.

## Browser hardware evidence

November 1, 2026: native Brave Web Serial hardware QA passed against usb-prototype-0 on the Heltec V3. The browser chooser selected CP2102 cu.usbserial-0001; the console reached Connected · synchronized with revision 2. Saving label Reaper Mesh V3 returned Committed on device and revision 3. Explicit disconnect released the port and disabled editing; reconnect through the chooser returned the same label/revision and preserved the page-session command history. The radio remained disabled. Screenshot evidence is local/ignored at build/heltec-v3/browser-usb.png. Physical cable removal, browser reload during an uncertain command, real power loss, display, and RF remain unqualified.

## OLED status implementation

OLED status is implemented for Heltec V3 SSD1306: SDA17/SCL18, reset21, active-low Vext36, address0x3c. The first-party driver/font uses a fixed 1025-byte transfer buffer, 400 kHz I2C, 40 ms per-transfer timeout, and redraw-on-change at most twice per second. An initialization/transfer failure disables further display updates without blocking USB indefinitely. Screen rows show REAPER USB 1, logical USB READY/IDLE, persisted revision or UNKNOWN, STORE OK/FAULT, and RADIO OFF. READY requires synchronized state and a successful reply within eight seconds; it is not physical cable detection. Firmware advertises usb-prototype-1. All 134 host tests and the target build pass. Visual OLED rendering remains unverified until observed on the physical screen.

Installed OLED update from commit 5a72fe6 on November 1, 2026. Application size 227,440 bytes; SHA-256 3baba75a548faca771733ec7e917c8d79fc25f9ee9f104c65de95c3fdbd70c7a. Esptool verified all three artifacts. Three physical TypeScript Connection/SerialAdapter opens confirmed usb-prototype-1 and persisted revision 3, reaching ready in 650/649/648 ms. NVS was not erased. These serial results do not verify visible OLED pixels or actual display-fault behavior; visual confirmation and real I2C fault injection remain pending.

Owner report: OLED rendering works on the installed usb-prototype-1 hardware (November 1, 2026). Physical config fault-injection passed lost committed reply -> query recovery, duplicate replay without a second revision, and reset with persisted config plus unknown previous-boot outcome. tools/hardware-recovery-smoke.ts reproduces these checks.

## Message and mesh checkpoint

usb-prototype-2 was installed from commit 443326d (230,960-byte application, SHA-256 5edcc60831f7ecdf2aa1873b3960001c72fe5a3050d8a10d97993a70323a5f87). Esptool verified all artifacts. Physical TS client/adapter testing accepted an exactly 1024-byte message, then observed failed/expired after the RF-disabled queue lifetime. Subsequent opens synchronized at persisted configuration revision 5. Native Brave also queued a multiline message, queried its status, and showed unknown on disconnect without resending it. Local screenshot: build/heltec-v3/browser-message.png. No RF transmission occurred.

The C++ radio packet codec and Mesh core pass host topology/fault tests; see docs/RADIO_PROTOCOL.md for resource bounds and remaining RF work. No mesh code is yet connected to the board radio.

Radio configuration checkpoint: additive capability-gated fields preserve base-client writes, migrate old NVS records without erasing, and quiesce queued messages on policy changes. See docs/RADIO_CONFIG.md. Radio remains physically disabled in this firmware.

Physical usb-prototype-3 testing now passes named-channel queue acceptance and radio-policy quiesce. A power change caused radio-config-changed; the client now preserves accepted messages during config snapshot resync and observes the failure by query. Previous settings were restored to mode off, power 2, relay enabled, Public/Camp channels; revision 12 survives repeated opens. No RF was enabled. The failed first test exposed an integration path omitting device identity; a Connection-level regression now covers it.

Integrated board checkpoint: docs/INBOX.md defines separate inbox sequencing and correlated live diagnostics. A one-board local send reaches the inbox without RF; host service tests distinguish that from TX_DONE/destination ACK. Owner confirmed the supplied US/915 MHz antenna is attached; board profile records this fact for usb-prototype-5. See docs/STATUS.md for the full completion tracker; the active goal is not complete.

## Integrated hardware and browser recovery evidence

usb-prototype-4 was installed from commit 6692d12, application 267,632 bytes. Esptool verified all three artifacts with NVS preserved. Three physical TS client/adapter opens reached ready in 665/662/668 ms; SX1262 probe succeeded, receive-only initialized then restored off, and three 1024-byte local sends were acknowledged with local-delivery and retrieved from the inbox. TX stayed zero; configuration revision 14 persisted. Free heap was 274,496 bytes; minimum free main stack was 17,260 bytes. These are single-board/local results.

The browser now journals USB identity/counters/command outcomes/message bodies/inbox in localStorage before mutation dispatch. Web Locks admits one writer per browser storage bucket; malformed/unavailable storage fails writes closed and preserves raw data for export. Reload converts unfinished work to unknown, never replays uploads, and permits explicit same-device/same-boot queries. History reset is explicit and disconnected; it consumes a fresh owner identity, whose device slots remain bounded. Plaintext local storage is disclosed. 191 host tests and the web build pass. Native Brave delivered a multiline local message with TX zero, reloaded, and retained both acknowledged outgoing and received entries; screenshot build/heltec-v3/browser-recovery.png.

## Updater qualification

The manifest-validating updater tools/update-firmware.py passed seven host test groups and physically reinstalled usb-prototype-4 from its clean 6692d12 build. ROM verified three images; three follow-up adapter opens reached ready in 649/648/643 ms with revision 14 preserved. See docs/UPDATES.md. No NVS erase, eFuse changes or rollback claim. Owner now confirms the US/915 MHz antenna is attached; this clears the board antenna gate for the next firmware/transmit qualification. Actual multi-node delivery is still outstanding.

## US transmit qualification build

Owner confirmed the supplied US/915 MHz antenna is attached. usb-prototype-5 enables that development-board fact, while default/persisted off mode is preserved. The explicit --rf-test checks 1024-byte broadcast fragmentation/TX_DONE, unreachable unicast failure without fabricated ACK, and restores original off policy. TX completion is not remote reception. No additional RF devices are available.

## First RF attempt and SPI correction

usb-prototype-5 installed with verified hashes, but the first maximum-message TX attempt failed closed with radio-driver-fault. Off policy was restored. Pinned IDF source confirms non-DMA SPI is limited to 64 bytes even when max_transfer_sz requests more. usb-prototype-6 enables SPI DMA, aligns persistent transfer buffers and checks the actual host maximum at startup before claiming a probe. Re-run physical RF qualification after deployment; no TX success is claimed for prototype-5.

## Final single-board checkpoint

Prototype-6 RF results and package/browser verification are recorded in docs/STATUS.md. Local ignored evidence: build/heltec-v3/reaper-manifest.json, flash-result.json, reaper-mesh-usb-prototype-6.zip and browser-final.png. Package SHA256 0a6dbc4121b3295f08d1f8ddfd8065feeb1f55f53091a9f0bed34a68c27327a6. No remote push/public release was performed by the agent.

Final browser review also corrected confirmed broadcasts degrading to unknown while waiting for a nonexistent recipient ACK. Confirmed broadcast transmission is now terminal across deadline/disconnect/receipt eviction/reload; unicast ambiguity remains unchanged. The new regression brings npm run check to 194 passing tests.
