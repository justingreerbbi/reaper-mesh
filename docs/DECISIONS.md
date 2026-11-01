# Decisions and open questions

Status date: November 1, 2026. Proposed choices are reviewable recommendations, not implementation commitments.

| Topic | Current position | Status |
| --- | --- | --- |
| Repository | One Git repository for firmware, protocol, and clients; local `main` initialized | Established |
| First board | US Heltec WiFi LoRa 32 V3 / Version 3 with built-in display, over USB; confirm unit-specific PCB/flash details before flashing | Owner-confirmed board family; CP2102 observed |
| Regional scope | Initial development and operation in the US; future EU support. Design regional profiles now; validate EU settings and hardware before enabling EU transmission | Confirmed by owner |
| Client | Desktop browser web app; USB first, BLE later | User direction |
| Protocol | Independent, documented Reaper Mesh protocol; no Meshtastic interoperability | Confirmed by owner |
| Firmware stack | ESP-IDF/C++ with a thin SX1262 driver adapter; evaluate driver support/license in M0 | Proposed |
| Client stack | TypeScript + Vite with native DOM controls for the first small console; shared client state library; no runtime UI framework needed yet | Local implementation; React proposal deferred |
| Serialization | Draft schema-driven TLV with generated TS/C++ descriptors and bounded codecs; review TLV versus Protocol Buffers before target application/public release | Host/cross-language codec tests pass; target integration pending |
| Serial framing | Draft v1: COBS + zero delimiter, RM/version/flags/length header, max 2,048-byte payload, CRC-32/ISO-HDLC; logs on a separate path | Host implementation tested; release format not frozen |
| Initial channels | One public channel first; named logical channels next, sharing a radio preset; no privacy until crypto | Proposed |
| Node roles | Normal node and relay-enabled node; forwarding controlled separately from logical channel type | Proposed |
| Message length | Start with a configurable hard cap of 1,024 UTF-8 bytes, subject to airtime/memory measurements | Proposed, not a throughput promise |
| Encryption | Deferred feature; reserve versioned authenticated-envelope extension, not homegrown crypto | User direction |
| Testing | RACE means deliberate device/client synchronization and easy recovery after interrupted connections; implement deterministic race/recovery and compatibility tests | Confirmed by owner |
| Request history | Bounded FIFO receipts plus non-evicting per-owner sequence marks; query-only reconnect recovery; evicted results remain unknown and cannot reexecute | Host-tested draft with capacity/admission metadata; firmware persistence and owner-retirement UX pending |
| Host verification | Strict TypeScript, generated-schema checks, 128 host/cross-language tests plus the web production build; pinned Node 24/25 CI workflow | Locally passing on Node 25; remote CI pending |
| Update UX | Browser guided USB installation and recovery; versioned manifest, board checks, configuration migration | Proposed |
| Licensing | Decision deferred by owner; do not assign a license or import incompatible third-party code in the meantime | Deferred |

## Owner inputs needed before affected implementation

1. Board revision and band verification before firmware development. Owner confirms a US-model Heltec V3 / Version 3 with built-in display; USB inventory identifies only the CP2102 bridge. Identify intended EU countries/bands before the EU milestone.
2. Meaning of channel “types” and “power”: proposed interpretation is public/named logical channels, node forwarding roles, and transmit-power settings. Battery/power-saving behavior needs separate requirements.
3. Whether 1,024-byte messages are an appropriate initial target. Licensing remains deferred and does not block first-party foundations.

Do not block all planning on these answers. Do block RF transmission, irreversible operations, or protocol commitments that depend on them.

## November 1: USB target implementation

Pin ESP-IDF v5.5.4 (exact commit in firmware/esp-idf.lock.json). Use one serialized UART session and a single NVS blob, fail closed without automatic erase. Add explicit storage-error message 11 without changing existing fixtures. Preserve the original 0x9000/0x5000 NVS range; use a separate namespace. Build a single factory app for the first supervised test; OTA rollback remains unimplemented. Radio is held in reset and display initialization deferred. Read-only ROM inspection/reset is complete; the owner subsequently waived preserving the old firmware/settings, so backup integrity no longer gates first flash. 128 host tests and 24 CTest cases pass; these do not qualify hardware.

## Owner clarification: existing firmware need not be preserved

The owner explicitly declined keeping the factory/previous firmware and settings. Stop backup attempts and remove backup as a prerequisite. First flash still requires review/authorization of the concrete image and manual ROM USB reinstall route. No whole-chip/NVS erase is implied by this decision.

## First supervised flash and USB smoke

First flash completed November 1, 2026 using commit c41dc6e, USB app SHA-256 bf2be8a9514df3f463d7edcfe76752d791ec7b871284f7e099d42bbb81cff523. Esptool verified all three written artifacts. Physical USB smoke checks passed: handshake/snapshot, NVS configuration commit, logical reconnect, retained receipt query, serial reopen, and reset with fresh boot identity and persisted revision/settings. Opening this CP2102 port reset the board; immediate negotiation timed out, while waiting two seconds succeeded. Browser Web Serial startup/retry handling needs qualification before calling the web path ready. No display, RF, physical cable-removal, power-cut, or long-duration qualification is claimed.

## Bounded negotiation retries

USB startup recovery is implemented: repeat the same hello at most once per 500 ms while negotiating, without extending the five-second deadline. Retries do not accumulate behind queued writes; welcome retires any unsent hello. No configuration mutation is replayed. All 131 host tests and the web build pass. The actual TypeScript Connection reached ready on three consecutive physical serial opens in 647/646/650 ms using a Python byte bridge, with persisted revision 2 unchanged. This qualifies the client protocol startup path; browser permission/stream behavior remains unverified on hardware.

The owner requested continued development without routine confirmation prompts. This persists as authorization for ongoing reversible USB development/testing; no change to RF or irreversible eFuse boundaries.

## Browser USB milestone

November 1, 2026: native Brave Web Serial hardware QA passed against usb-prototype-0 on the Heltec V3. The browser chooser selected CP2102 cu.usbserial-0001; the console reached Connected · synchronized with revision 2. Saving label Reaper Mesh V3 returned Committed on device and revision 3. Explicit disconnect released the port and disabled editing; reconnect through the chooser returned the same label/revision and preserved the page-session command history. The radio remained disabled. Screenshot evidence is local/ignored at build/heltec-v3/browser-usb.png. Physical cable removal, browser reload during an uncertain command, real power loss, display, and RF remain unqualified.

Correct the console status copy to reflect available USB firmware/configuration while retaining explicit radio/browser-installer limits. Next prioritize minimal board status feedback before messaging; do not expand radio scope.

## Board status display

OLED status is implemented for Heltec V3 SSD1306: SDA17/SCL18, reset21, active-low Vext36, address0x3c. The first-party driver/font uses a fixed 1025-byte transfer buffer, 400 kHz I2C, 40 ms per-transfer timeout, and redraw-on-change at most twice per second. An initialization/transfer failure disables further display updates without blocking USB indefinitely. Screen rows show REAPER USB 1, logical USB READY/IDLE, persisted revision or UNKNOWN, STORE OK/FAULT, and RADIO OFF. READY requires synchronized state and a successful reply within eight seconds; it is not physical cable detection. Firmware advertises usb-prototype-1. All 134 host tests and the target build pass. Visual OLED rendering remains unverified until observed on the physical screen.

Keep presentation outside protocol state. Session exposes only a read-only synchronized accessor; display state does not control mutations. Use the pinned ESP-IDF I2C master directly to bound transfer time (the bundled esp_lcd I2C wrapper uses unbounded waits). No third-party display/font library is imported.

## OLED firmware installation evidence

Installed OLED update from commit 5a72fe6 on November 1, 2026. Application size 227,440 bytes; SHA-256 3baba75a548faca771733ec7e917c8d79fc25f9ee9f104c65de95c3fdbd70c7a. Esptool verified all three artifacts. Three physical TypeScript Connection/SerialAdapter opens confirmed usb-prototype-1 and persisted revision 3, reaching ready in 650/649/648 ms. NVS was not erased. These serial results do not verify visible OLED pixels or actual display-fault behavior; visual confirmation and real I2C fault injection remain pending.

## Sustained development and message acceptance

Owner confirms OLED rendering works and requests continued work through project completion without routine prompts. Physical configuration loss/reconnect/query/duplicate/reset tests pass. Message USB v1 uses bounded hex chunks to preserve embedded field buffers and whole-message UTF-8 validation. Eight volatile queue records and per-owner marks separate retry suppression from receipt retention. Queued does not mean transmitted or delivered; hardware RF stays off until board/antenna/profile checks. Additive tags and capabilities preserve prior fixtures. Host/native maximum-size and lost-acceptance tests use the actual C++ session and TS client; simulator claims remain separate from RF evidence.

## Message hardware and mesh core

usb-prototype-2 was installed from commit 443326d (230,960-byte application, SHA-256 5edcc60831f7ecdf2aa1873b3960001c72fe5a3050d8a10d97993a70323a5f87). Esptool verified all artifacts. Physical TS client/adapter testing accepted an exactly 1024-byte message, then observed failed/expired after the RF-disabled queue lifetime. Subsequent opens synchronized at persisted configuration revision 5. Native Brave also queued a multiline message, queried its status, and showed unknown on disconnect without resending it. Local screenshot: build/heltec-v3/browser-message.png. No RF transmission occurred.

Use an independent 54-byte-header/CRC radio frame with up to 160 fragment bytes and seven fragments per 1024-byte text. Bound flooding/reassembly and distinguish TX completion from destination ACK. Retry forwarding after a short duplicate horizon; retain destination receipts longer. Host topology tests cover the actual C++ implementation, while regional and RF hardware gates remain separate.
