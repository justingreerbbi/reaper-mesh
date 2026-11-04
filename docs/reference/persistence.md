# Device configuration authority and storage boundary

`firmware/components/reaper_device/` is the portable C++ configuration authority intended for the USB-only firmware. It is compiled and fault-tested on the host; the ESP-IDF/NVS adapter and UART application now build, with real hardware validation pending.

## Serialized command behavior

The board application must own one serialized authority context, validate connection/link/owner identity, decode framed messages through the shared codec, and call `decode_command` before `apply`. The authority revalidates directly constructed commands too. Storage callbacks are synchronous and must not reenter mutating authority methods. Read-only test observations verify publication ordering; board access still belongs to the serialized context.

The authority checks boot identity, expected revision, exact retained requests, and per-owner sequence high-water marks. It retains 32 recent results and eight non-evicting owner marks. Evicted requests remain unknown and cannot execute again. Owners and receipts remain volatile; a real boot must create a fresh collision-resistant boot ID before constructing the authority. Never reconstruct/reset this authority under the same boot identity to reclaim marks. Transport reconnect alone must reuse it.

Successful mutations write a complete next configuration record before publishing the new in-memory snapshot or returning committed. A definite failure retains the original state and a rejected receipt. Failed requests still consume their sequence; repeating the same ID cannot write again. New request IDs may retry a deliberately revised operation against a synchronized revision.

The initial missing record yields revision 0, an empty label, and an unset region. Loading an unreadable, corrupt, unsupported-version, or invalid record does not substitute defaults or erase storage: the authority remains unhealthy. Revision wraparound is refused.

## Storage outcomes

| Outcome | Required backend guarantee | Authority behavior |
| --- | --- | --- |
| Committed | The entire new record was accepted durably/atomically | Publish new snapshot/revision and retain committed receipt |
| NotCommitted | The old record is unchanged | Keep original state; retain rejected receipt |
| Indeterminate | The record might have changed, or durability cannot be established | Retain unknown outcome; block mutations and snapshots |

An uncertain write never becomes a success just because a read might show matching bytes. The application must return/retain an unknown result when possible, end the logical connection, and expose a storage-recovery condition. It must not serve a possibly stale snapshot, keep advertising writable readiness, auto-reboot, or auto-format NVS. A later actual boot with a fresh identity loads whichever valid complete record survived; the old command outcome remains unknown because its receipt did not survive. Tests cover both old-record and new-record survival, not actual flash power cuts.

The backend must implement atomic replacement of one record and accurately classify failures. An NVS adapter must use indeterminate for any error that cannot prove no change. Its implementation and real storage guarantees need review/testing before hardware flashing.

## Stored record v1

The internal record format is independent of USB/radio protocol versions. It contains magic `RC`, one-byte schema version 1, little-endian u32 config revision, region byte (0 unset / 1 US / 2 EU), one-byte UTF-8 label length, label bytes, and a little-endian CRC-32/ISO-HDLC over all preceding bytes. Total size is 13–77 bytes. Unknown versions, invalid lengths/text/region, corruption, and truncation are rejected before publishing state. CRC detects corruption; it is not authentication or encryption. A future migration must explicitly support prior storage schemas and downgrade behavior.

## Evidence and remaining integration

Thirteen compiler-backed scenarios test commit ordering, lost-response duplicates, revision conflict, definite failure, uncertain old/new survival, reboot identity, receipt eviction, owner exhaustion, corruption/read failure, record bounds/revision exhaustion, malformed commands, and the framed-message-to-authority boundary. The full host check uses UBSan locally; Linux CI is configured for ASan too. Storage is a fault-injecting in-memory fake. No test here establishes NVS durability, ESP32 task-stack budgets, actual USB behavior, display output, or RF behavior.

Next implement the ESP-IDF app and NVS backend, with UART-only communications and radio transmission disabled. Preserve binary UART framing, supply authoritative snapshots through the serialized loop, and keep boot/debug logs off the protocol stream. Verify board/flash details, prepare recovery/backup instructions, and obtain first-flash authorization only after the image is built and reviewable.

## ESP-IDF backend

The device settings path initializes only reaper_nvs, opens namespace reaper, and commits a single configuration blob. Missing keys yield initial state; initialization, size, read, and record failures fail closed. Set/commit errors are indeterminate. There is no erase/reformat fallback. The separate `nvs` partition holds only [Bluetooth](bluetooth.md) keys, address and calibration, and may be reset. Fake NVS API tests cover missing, read, set, commit, and initialization failures; they do not qualify real flash crash safety. See ../guides/first-flash.md for the preserved NVS range and hardware gate.

## Radio settings record extension

Record 2 is now supported alongside record 1, with a maximum 151-byte blob. Existing/default radio configuration retains record 1; nondefault policy writes record 2 on an explicit revision-checked commit. The fields and fail-closed migration/downgrade behavior are specified in radio-configuration.md. Missing radio fields in old USB commands preserve current policy rather than replacing it with defaults.

## Fixed-position record4

The current reader accepts records1–4. Record4 keeps the complete record3 layout and inserts10 bytes immediately before CRC32: share0/1 byte, source0(none)/1(fixed) byte, latitudeLE32, longitudeLE32. Coordinates use degree*10^7 offsets+90/+180 (see protocol.md), including a valid geographic0,0. Maximum record166 bytes. Default position policy continues writing the applicable earlier format; nondefault saved coordinates/source/sharing require4. Unsupported older readers fail closed without erasing. All fields commit with label/region/radio/discovery under the existing CAS and durable-publication boundary. Legacy mutations omitting all position fields preserve them. Failed commits preserve prior policy; indeterminate commits block authority/snapshots and require reboot reconciliation. The actual Heltec8/T-Beam3 NVS record retained fixed coordinates across separately verified fresh boot identities with sharing disabled; see ../contributing/phase-2.md. This does not qualify power-cut atomicity at every commit phase.

## Screen settings record 5

Record 5 keeps the complete record 4 layout and adds 5 bytes before the CRC: the screen timeout
(little-endian u32 seconds, 0 or 10–3600) and the wake flag (0 or 1). The maximum record is 171
bytes. Readers accept records 1–5. Default screen settings (30 s, wake off) keep writing the
earlier applicable format, so a board that never changes them keeps its current record.
An invalid timeout or wake flag fails closed without erasing. Firmware that reads only records
1–4 fails closed on a record 5 after a downgrade; it never erases it. Screen settings commit
under the same revision check and durable-publication boundary as other settings, and writes
that omit them preserve them.

## Channel IDs record 6

Record 6 (`v0.3.0`, D45) keeps the complete record 5 layout and adds the eight slot channel IDs
(little-endian u32 each, 32 bytes) before the CRC. The maximum record is 203 bytes. Readers accept
records 1–6. Records 1–5 have no IDs: on load, a named slot *k* gets ID *k*, which is also what a
board upgraded from earlier firmware keeps using on air. Settings whose IDs equal that rule keep
writing the earlier applicable format; a channel with any other ID needs record 6. A table that
breaks the [channel ID rules](radio-configuration.md#channel-ids) fails closed without erasing.
Firmware that reads only records 1–5 fails closed on a record 6 after a downgrade.

## Transmit power levels record 7

Record 7 (`v0.4.0`, D46) has the same layout and size as record 6, and changes the meaning of the
radio power byte: bits 0–6 are the level (0 low, 1 medium, 2 high) and bit 7 is boost. In records
1–6 that byte holds dBm, which is checked and then ignored: those records load as medium with boost
off, so a board upgraded from earlier firmware moves to medium. Medium without boost keeps writing
the earlier applicable format; any other choice writes record 7. Readers accept records 1–7, and a
level above 2 fails closed without erasing. Firmware that reads only records 1–6 fails closed on a
record 7 after a downgrade.
