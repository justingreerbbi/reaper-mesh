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

The app initializes only reaper_nvs, opens namespace reaper, and commits a single configuration blob. Missing keys yield initial state; initialization, size, read, and record failures fail closed. Set/commit errors are indeterminate. There is no erase/reformat fallback. Fake NVS API tests cover missing, read, set, commit, and initialization failures; they do not qualify real flash crash safety. See FIRST_FLASH.md for the preserved NVS range and hardware gate.

## Radio settings record extension

Record 2 is now supported alongside record 1, with a maximum 151-byte blob. Existing/default radio configuration retains record 1; nondefault policy writes record 2 on an explicit revision-checked commit. The fields and fail-closed migration/downgrade behavior are specified in RADIO_CONFIG.md. Missing radio fields in old USB commands preserve current policy rather than replacing it with defaults.
