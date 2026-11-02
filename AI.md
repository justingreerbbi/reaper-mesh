# Reaper Mesh: AI contributor handoff


## Active product roadmap

The owner marks Phase 1 complete and directs Phase 2 next. Read docs/overview/roadmap.md and docs/contributing/phase-2.md before new development; these supersede the older milestone priorities below. Phase 2: bounded discovery/beacons and opt-in responses, optional shared GPS/fixed position, then a map/nodes/messaging portal inspired by the supplied MeshMonitor/EvoCare references. Discovery slice2.1 is done. Fixed-position slice2.2a is implemented and physically qualified; GPS is deferred by the owner (November 2). The current priority is the messaging/asset portal: dark technical styling, conversation inbox, unified message view, asset map/list and separate settings. Multi-device journaling remains open. Slice2.1 discovery v1, atomic policy persistence, USB/node snapshots, client recovery and minimal discovery UI are implemented. Real two-board requests/replies/names, periodic beacon and text regressions pass. GPS acquisition is deferred; the portal is implemented and has browser layout checks.

Phase 3 is client-side channel encryption plus portal configuration; its first implementation now exists but still needs both-board hardware qualification. See `docs/guides/encryption.md` for envelope, vault, limitations and verification status. Phase 4 is screen management/sleep, RX/TX and battery indication. GPS acquisition is explicitly deferred by the owner; broad telemetry/cloud/MQTT is out of scope. Automatic beaconing, responses and location sharing default off; do not start broadcasting the owner's position merely because GPS hardware exists. Preserve the Phase 1 text/ACK and recovery contracts with capability-gated additions.

The owner requests token-efficient development. Prefer targeted code/CLI reads and automated tests; use desktop/browser control only for necessary visual/hardware UI checks. Avoid repeated full-file/log dumps or unrelated exploration. Do not equate functioning radio drivers with a finished discovery/privacy/synchronization contract.

Firmware naming rule (owner request, November 2, 2026): on the next firmware update, replace prototype labels with `{device}-reaper-mesh-v{semver}`. Examples: `heltec-reaper-mesh-v8.0.2` and `tbeam-reaper-mesh-v8.0.2`. Apply the board-specific name consistently to firmware identification, build manifests, update/package outputs and docs. Do not rename/reflash the images currently installed just for this convention; use it when firmware is next changed.

## Current stage

The focused single-board USB prototype is implemented. usb-prototype-6 from clean commit 56c8cf0 is installed with all three ROM hashes verified. The owner confirms the OLED works, the board is US Heltec V3 and its US/915 MHz antenna is attached. USB/NVS/RACE, browser saves/reconnect, local 1024-byte delivery/inbox, durable reload history, actual SX1262 probe/RX initialization and full-fragment TX are checked. All 197 host tests and 56 standalone CTests pass. See docs/overview/status.md and docs/reference/compatibility.md for precise evidence and release limits.

The RF test reached seven TX_DONE events for a 1024-byte broadcast, then three unreachable-unicast transmissions followed by explicit failure with no fabricated ACK. It restored off mode and verified three reconnects at revision 20. The owner subsequently selected mesh mode through the browser; final observed state was prototype-6/revision 21, probe OK, ready, TX 1 and local delivery. Preserve those user-selected settings; do not assume the device is still off.

The updater validates clean build provenance, target/schema/layout, outer and embedded hashes, ROM security state and immutable staged images; it preserves NVS and verifies each write. A local zip includes exact source, images, updater, hashes and retained notices. Native browser reload retains outgoing/inbox history. The SDK SPI non-DMA 64-byte limit caused prototype-5 to fail closed; prototype-6 enables DMA and checks the bus capacity. No old-firmware backup is required.

This is not a production-ready release. Actual direct RF receive/destination ACK and encrypted direct delivery now pass with the Heltec and T-Beam (see `docs/guides/encryption.md`); relay qualification still needs a third board. Power-cut, interrupted-flash, coexistence and field-soak checks remain. EU/BLE/mobile/other boards and licensing stay deferred. Public signing/automatic rollback remain release hardening. Do not fabricate these external qualification results.

## Product intent

Build a deliberately small, reliable LoRa mesh messaging system. Start with one USB-connected Heltec WiFi LoRa 32 V3 and a desktop browser client. Grow to other boards, desktop/mobile clients, and BLE through explicit milestones. Avoid feature creep. Prioritize stable communications and compatibility rather than requiring all nodes and clients to update together.

Requested capabilities: channels (including public channels and defined channel roles/types), radio/power configuration, longer text messages, mesh relay, acknowledgments, and client-side channel encryption. Plaintext remains the default unless that client requires encryption on a channel. Do not claim pairwise privacy, sender identity authentication, forward secrecy, or production security; limitations and supported flows are documented in `docs/guides/encryption.md`.

Regional scope confirmed by the owner: initial development/operation in the US, with EU support later. Keep regional radio profiles separate from board capabilities and logical channels. Build the profile interface and tests from the start; do not enable EU transmission until the intended countries, hardware, and applicable settings are verified.

The owner confirmed an independent, documented Reaper Mesh protocol and defined RACE as synchronization/recovery reliability rather than a framework. Licensing is explicitly deferred. The owner confirms a US Heltec V3 / Version 3 board with built-in display; Heltec calls its standard screen an OLED. Read-only USB inventory found a CP2102 bridge, which cannot verify RF band. See `docs/guides/hardware.md`.

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

## T-Beam support and two-board qualification

Owner added a US/915 T-Beam V1.2 and confirmed its attached antenna. Latest installed image is tbeam-usb-prototype-3 on ESP32-D0WDQ6-V3 rev3.1 / Winbond4MB, MAC08:b6:1f:9f:e5:48, port /dev/cu.wchusbserial57700003341 (the other 57700003341 serial name is an alias). Latest Heltec V3 image is usb-prototype-8 on /dev/cu.usbserial-0001. Both are documented in docs/guides/t-beam-v12.md and docs/guides/encryption.md.

AXP2101 identification/radio rail readback and SX1276-family version/configuration probe passed. Three local test opens reached ready in 671/669/670 ms, each delivering/retrieving 1024 bytes with TX zero; heap201748 bytes and minimum free main stack17484 bytes. Receive-only initialization and restoration off passed. Initial first settings write interrupted auxiliary reads; an explicit reconnect recovered the committed revision1 without replay, and the subsequent full checks passed. Keep this observation visible for interruption/soak work.

T-Beam RF test completed seven 1024-byte broadcast fragments with TX_DONE, then three unreachable-unicast transmissions followed by failure with no false ACK; restored off/revision5, reconnects675/671/671 ms. tools/hardware-pair-smoke.ts then operated both real TS adapters simultaneously: 1024 bytes Heltec -> T-Beam and T-Beam -> Heltec each received a destination ACK and exact inbox body, once per message identity. Original settings were restored afterward (Heltec mesh policy preserved, T-Beam off). This is actual two-node RF evidence, not relay/range/coexistence qualification.

Both ESP32 and ESP32-S3 target builds and manifests validate. 197 host tests and 56 standalone CTests pass; wrong-target/ESP32 eFuse preflight tests are included. Local T-Beam package contains exact images/source/notices/updater and passed extracted-image/checksum validation. Node ID node-000008b61f9fe548 is already compatible with the installed Heltec protocol. The web console still handles one device at a time; pair testing uses separate CLI SerialAdapters. Per-device browser journaling/multi-device UI is separate work.

## Next work

Owner defers GPS. Continue portal UX and asset/messaging workflows; read docs/guides/web-portal.md and docs/contributing/phase-2.md. Preserve name-only discovery and text compatibility. Fixed positions support the current asset map without waiting for GPS. Mark each slice with implementation and actual hardware evidence. Keep relay/field/power-cut release gates visible without reopening the owner's completed Phase 1 product milestone. Historical checkpoints below do not override the active roadmap.

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

The C++ radio packet codec and Mesh core pass host topology/fault tests; see docs/reference/radio-protocol.md for resource bounds and remaining RF work. No mesh code is yet connected to the board radio.

Radio configuration checkpoint: additive capability-gated fields preserve base-client writes, migrate old NVS records without erasing, and quiesce queued messages on policy changes. See docs/reference/radio-configuration.md. Radio remains physically disabled in this firmware.

Physical usb-prototype-3 testing now passes named-channel queue acceptance and radio-policy quiesce. A power change caused radio-config-changed; the client now preserves accepted messages during config snapshot resync and observes the failure by query. Previous settings were restored to mode off, power 2, relay enabled, Public/Camp channels; revision 12 survives repeated opens. No RF was enabled. The failed first test exposed an integration path omitting device identity; a Connection-level regression now covers it.

Integrated board checkpoint: docs/reference/inbox.md defines separate inbox sequencing and correlated live diagnostics. A one-board local send reaches the inbox without RF; host service tests distinguish that from TX_DONE/destination ACK. Owner confirmed the supplied US/915 MHz antenna is attached; board profile records this fact for usb-prototype-5. See docs/overview/status.md for the full completion tracker; the active goal is not complete.

## Integrated hardware and browser recovery evidence

usb-prototype-4 was installed from commit 6692d12, application 267,632 bytes. Esptool verified all three artifacts with NVS preserved. Three physical TS client/adapter opens reached ready in 665/662/668 ms; SX1262 probe succeeded, receive-only initialized then restored off, and three 1024-byte local sends were acknowledged with local-delivery and retrieved from the inbox. TX stayed zero; configuration revision 14 persisted. Free heap was 274,496 bytes; minimum free main stack was 17,260 bytes. These are single-board/local results.

The browser now journals USB identity/counters/command outcomes/message bodies/inbox in localStorage before mutation dispatch. Web Locks admits one writer per browser storage bucket; malformed/unavailable storage fails writes closed and preserves raw data for export. Reload converts unfinished work to unknown, never replays uploads, and permits explicit same-device/same-boot queries. History reset is explicit and disconnected; it consumes a fresh owner identity, whose device slots remain bounded. Plaintext local storage is disclosed. 191 host tests and the web build pass. Native Brave delivered a multiline local message with TX zero, reloaded, and retained both acknowledged outgoing and received entries; screenshot build/heltec-v3/browser-recovery.png.

## Updater qualification

The manifest-validating updater tools/update-firmware.py passed seven host test groups and physically reinstalled usb-prototype-4 from its clean 6692d12 build. ROM verified three images; three follow-up adapter opens reached ready in 649/648/643 ms with revision 14 preserved. See docs/guides/flashing-firmware.md. No NVS erase, eFuse changes or rollback claim. Owner now confirms the US/915 MHz antenna is attached; this clears the board antenna gate for the next firmware/transmit qualification. Actual multi-node delivery is still outstanding.

## US transmit qualification build

Owner confirmed the supplied US/915 MHz antenna is attached. usb-prototype-5 enables that development-board fact, while default/persisted off mode is preserved. The explicit --rf-test checks 1024-byte broadcast fragmentation/TX_DONE, unreachable unicast failure without fabricated ACK, and restores original off policy. TX completion is not remote reception. No additional RF devices are available.

## First RF attempt and SPI correction

usb-prototype-5 installed with verified hashes, but the first maximum-message TX attempt failed closed with radio-driver-fault. Off policy was restored. Pinned IDF source confirms non-DMA SPI is limited to 64 bytes even when max_transfer_sz requests more. usb-prototype-6 enables SPI DMA, aligns persistent transfer buffers and checks the actual host maximum at startup before claiming a probe. Re-run physical RF qualification after deployment; no TX success is claimed for prototype-5.

## Final single-board checkpoint

Prototype-6 RF results and package/browser verification are recorded in docs/overview/status.md. Local ignored evidence: build/heltec-v3/reaper-manifest.json, flash-result.json, reaper-mesh-usb-prototype-6.zip and browser-final.png. Package SHA256 0a6dbc4121b3295f08d1f8ddfd8065feeb1f55f53091a9f0bed34a68c27327a6. No remote push/public release was performed by the agent.

Final browser review also corrected confirmed broadcasts degrading to unknown while waiting for a nonexistent recipient ACK. Confirmed broadcast transmission is now terminal across deadline/disconnect/receipt eviction/reload; unicast ambiguity remains unchanged. The new regression brings npm run check to 194 passing tests.

Final read-only two-port state verification: Heltec usb-prototype-6/revision21 remains mesh/2dBm; T-Beam tbeam-usb-prototype-1/revision7 restored off/2dBm. Local reports are build/tbeam-v12/pair-smoke.json and hardware-state.json. T-Beam package SHA256 3a79222f814d1aebf8c5b4551f5f45d116b844e20c15ab7b299aef5f3ea57242. No Heltec flash or settings change remained from this task.

## Discovery v1 implementation checkpoint

Phase2.1 uses additive radio kinds3/4/5 and USB22–25, featurebit7, discoveryVersion1. Defaults remain beaconoff/respond off; no location is acquired/transmitted. Config record3 extends2, preserves1/2 reads, and older clients preserve new settings when omitted. Fixed USB node snapshots avoid starvation under live observations; separate control sequences/owner marks/receipt retention prevent replay. Host checks and real hardware acceptance pass as recorded below. See docs/reference/protocol.md for frozen layout/bounds. Firmware versions are Heltec usb-prototype-7 and T-Beam tbeam-usb-prototype-2.

## Discovery deployment evidence

Both discovery builds from a44319b are installed: Heltec usb-prototype-7 (274256-byte app) and T-Beam tbeam-usb-prototype-2 (244416). ROM verified all artifacts with NVS preserved. T-Beam driver initially rejected both serial interfaces before writes; owner USB reconnect resolved it. Actual manual discovery verified zero replies when disabled, one reply each direction when enabled, and matching configured node names. The periodic beacon test (60-second interval) passed without manual query or any response TX. Bidirectional 1024-byte text/destination ACK/inbox regression passed. No location transmitted. Both opt-in flags restored false, interval300; final Heltec revision28 mesh and T-Beam revision17 off.

210 host tests and 64 CTests pass. New UI is built but not manually desktop-tested to honor token preference; actual shared client/USB/device behavior is qualified. Heap/stack: Heltec260592/16892 bytes; T-Beam187924/17116. The local-test harness assumed restoration always meant radiooff; corrected it to verify the owner's original mode (Heltec mesh), without changing firmware. docs/contributing/phase-2.md has evidence and remaining scope.

## Fixed-position implementation checkpoint

USB locationVersion1/feature256, opt-in fixed source/sharing, offset degree*1e7 coordinates, record4 (max166/read1–4), payloadv2 beacon/presence and frozen position-bearing node rows are implemented. Manual requests remain name-onlyv1; older discovery receivers reject v2 but text/ACK remains unchanged. Privacy changes cancel queued/selected controls; already emitted RF cannot be recalled. UI supports fixed positions/list details, no map/GPS yet. New RACE and compatibility tests are included. Heltec8/T-Beam3 are built and installed from clean4209679. Both boards pass synthetic fixed-coordinate RF/privacy checks and actual reboot/NVS persistence; mixed Heltec8/T-Beam2 and new/new1024-byte text/ACK/inbox checks pass. Host220/CTest67 pass; see docs/contributing/phase-2.md for precise evidence. Do not claim Phase2.2 complete until GPS and remaining acceptance gates are met.


Fixed-position hardware follow-up: Heltec first flash stopped at70% app write; identical validated reinstall succeeded, all three ROM hashes verified/NVS preserved. One extended attempt saw a T-Beam node-snapshot timeout before reboot; fresh sessions restored settings and separate actual reboot tests passed. Do not hide this serial/soak observation. The test harness now prevents unrelated node-read errors from blocking configuration restoration; query-only reconnect recovery is deterministic-tested. Final expected position none/sharefalse on both. Preserve current owner policies: both mesh/2dBm; Heltec beacon/respond false, T-Beam beacon/respond true, intervals300. Resource heap/stack259064/16692 and186396/16916 bytes. Updated controls have not had native desktop QA. Ignored packages for8/3 include exact clean4209679 source/notices/hashes; no public release/push. Next GPS work must verify UART/AXP2101 ALDO3 with official wiring, bound parsing/checksums/fix freshness, distinguish acquisition from sharing, and preserve fixed-only client compatibility.

Final fixed-position qualification state: Heltec8 revision38; T-Beam3 revision32. Exact original non-position settings were compared with the pre-update snapshot. Sharing false/source none on both; owner beacon/respond policies preserved. Repeated RF/privacy test passed after the recovered auxiliary-read incident. Reboot persistence is reproduced separately with tools/hardware-position-persistence.ts, with sharing disabled throughout.

## November 2: messaging and asset portal

Owner rejected the prior light/map-first portal and requests a polished Signal-style messaging workspace with dark technical styling and restrained corners. GPS is explicitly deferred. Portal now has searchable channel/peer conversations, unified sent/received bubbles with real delivery states, per-transport/device/conversation volatile drafts (bounded64), Enter/Shift+Enter composition, received history filtering by device/channel, and a separate full asset workspace. Wide screens also show the tracker beside conversations. Device/radio/position/discovery/recovery settings remain available in a dialog. Existing shared connection/journal/no-replay contracts and firmware are unchanged.

223 host tests/type checks/generated checks and production build pass. Browser checked at390px and1440px: no horizontal overflow, settings open/close, asset navigation and Public→new-recipient→Public draft preservation; no console errors in the checked desktop state. Local preview build/portal-redesign.png. No physical USB/RF or firmware flashing was repeated for this UI task. The simulator models config only; do not invent active assets/messages to fill the interface. Incoming wire history does not carry destination/timestamps: channel views mean traffic received on that channel; peer views group by sender. Restored cross-direction ordering is reconstructed; no fabricated dates, read receipts or online claims. Drafts survive switching/disconnect in this tab, not browser reload; submitted history uses the existing journal.

## November 2: message management / unread UX

Portal supports sent/received Delete and Delete chat confirmation, local received-body removal, persistent deletion tombstones, conversation hiding/reopening on new traffic, per-thread/nav unread counts and browser title(N). Read state is local UX only; ACKs/firmware/wire schemas are unchanged. Active uploads cannot be removed; sent deletion frees local history and abandons query recovery without resetting counters. Confirmation uses a snapshot of message IDs; later arrivals survive. Metadata lives in reaper-mesh.message-ui.v1 under BrowserRecovery.writable; bounds4096 IDs/1024 conversations/2MiB, no tombstone eviction. Storage failure leaves deletion unapplied. InboxReader.forget / Connection.forgetReceived only remove local history/checkpoint, retaining stream cursors and never emitting a packet. Deleted device-inbox redownloads are suppressed and removed again from the local journal.

232 tests and the web build pass. Isolated synthetic-history browser QA verified title2→read0, received Delete surviving reload, Delete chat surviving reload, then new arrival count1 with earlier deleted history absent. No physical USB/RF tests or user-history changes; QA pages are temporary and removed. New-message metadata has no text bodies. Read-on-view requires visible/focused Messages, active mobile conversation and bottom-of-thread; background/older-message reading stays unread. Mark all read and jump-to-new controls are provided. The current portal history still has the existing one-device writer boundary; browser storage clearing can allow device-retained messages to reappear. See docs/guides/web-portal.md for limits and evidence.

Channel/direct separation update (November 2): portal inbox rows are now grouped into configured Channels and Direct Messages; direct rows remain scoped to peer plus channel. Inbox protocol v2 adds the original RF destination so broadcasts stay in channel threads and addressed messages appear only in peer threads. Version-1 firmware remains readable, but its missing route metadata means incoming messages are shown in the channel only. Firmware source advertises inboxVersion2; physical boards need the updated image for fully accurate incoming direct-message placement. 234 host tests and production build pass; no hardware flash/RF retest was part of this portal correction. See docs/reference/inbox.md and docs/guides/web-portal.md.

Portal plugin planning (November 2): owner wants a simple web-app extension architecture for optional features such as Weather Radar, Reaper ADS-B and Reaper APRS bridge. Track this under Phase2 portal planning and revisit soon; do not implement the framework or integrations yet. See docs/overview/roadmap.md and docs/contributing/phase-2.md.

Phase3 encryption implementation (November 2): browser-side XChaCha20-Poly1305 channel envelopes, Argon2id-wrapped local vault, RMKEY1 manual transfer, local require-encryption policy, ciphertext-only firmware transport and ciphertext RACE recovery are implemented. `npm run check` passes (240 tests), both target builds pass, and live Heltec/T-Beam encrypted direct messages passed in both directions with ACK, exact ciphertext retention, matching-key decrypt and unrelated-key rejection. Reconnect/reboot uncertainty and release/field qualification remain. Direct routes use the channel group key (not pairwise private); group members can forge messages; no forward secrecy. Future portal plugins must not gain crypto keys/plaintext by default.
