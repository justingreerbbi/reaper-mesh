# Prototype compatibility and RACE coverage

There is no stable/public release yet. Firmware identifiers describe development builds; USB, radio, config and storage versions evolve independently. Do not force a client update merely because the firmware build string changes. Negotiate capabilities and block unsupported writes while retaining readable device state.

| Firmware slice | USB v1 | Config schema | Record reads | Optional functions |
| --- | --- | --- | --- | --- |
| usb-prototype-0 / 1 | Base handshake/config/query | 1 | 1 | OLED added in 1 |
| usb-prototype-2 | Adds tags 12–14 | 1 | 1 | Bounded upload/queue status; no RF |
| usb-prototype-3 | Optional radio config fields | 1 | 1, 2 | Named channels/mode/power/relay; no RF |
| usb-prototype-4 | Adds diagnostics/inbox tags 15–21 | 1 | 1, 2 | Probe/RX, local delivery/inbox; antenna gate closed |
| usb-prototype-5 | Same wire/schema | 1 | 1, 2 | Antenna confirmed; superseded due to full-fragment SPI failure |
| tbeam-usb-prototype-1 | Same USB v1 | 1 | 1, 2 | ESP32/4MB, AXP2101/SX1276; real direct RF with Heltec6 passed |
| usb-prototype-6 | Same wire/schema | 1 | 1, 2 | DMA-backed full-fragment transfer; owner-confirmed US board/antenna |

Current client to older firmware: missing message/radio/inbox capabilities disable those functions. Unknown optional fields are skipped by length; unsupported required behavior fails closed. Base clients editing label/region on newer firmware omit the five radio fields, preserving device-authoritative radio policy. A radio policy update is all-or-none, shares the revision CAS, and cancels stale queued work. Storage schema 1 remains readable; schema 2 is written only for nondefault radio policy. Downgrading to schema-1-only firmware with schema 2 on disk is unsupported: storage must fail closed, never erase itself.

Frozen envelopes/messages remain unchanged as additive fixtures are appended. Generated TS/C++ descriptors and vendor integrity are checked on every host run. The suite executes the actual C++ codec/session/authority/queue/mesh and real TS client over byte transcripts, rather than relying solely on a parallel simulator model.

| RACE boundary | Automated evidence | Physical evidence / limit |
| --- | --- | --- |
| Commit/reply loss, duplicates, CAS conflict | Authority/session and TS serial integration; commit-before-publish, no second revision | Lost reply -> query; duplicate -> same revision; reset preserves settings |
| Snapshot/event overlap, gap, stale generation/boot | Both snapshot orderings, gap resync, stale callback rejection | Repeated opens and reset checked; arbitrary cable/power cuts remain |
| Partial upload/lost acceptance/reconnect | Maximum UTF-8, bitmap completeness, conflicts, bounded retries; query-only recovery | Local 1024-byte acceptance/inbox checked |
| Browser reload/storage/two tabs | Counter checkpoint before dispatch; unfinished -> unknown; corrupt/quota/lock failure | Native Brave local outgoing+inbox retained across reload |
| Radio loss/reorder/duplicates/ACK race | Three-node line/triangle, hop/queue limits, exact-deadline and early ACK | TX_DONE on one board; destination/relay timing needs more boards |
| Long-lived resource recovery | 120 messages, seeded loss/corruption/TX failure/duplicate traffic; 12 clean intervals must recover | Virtual time only; not a physical soak or throughput benchmark |
| Update incompatibility/corruption | Image checksum/hash, size/offset/partition/target/security rejection, extracted package validation | Three-image ROM verification and preserved NVS; interrupted flash remains |

The endurance seed is 0x73550728. It spans over four virtual hours with 10% per-link drops, 5% corruption and 2% TX failures during faulted intervals, plus duplicate/reordered traffic. This deterministic run acknowledges 103/120 messages (all 12 clean intervals recover), checks every delivered body and never accepts an ACK without complete destination data. Faulted-message failure is explicit, not silently converted to success. These are bounded-recovery checks, not a promised RF delivery rate; there is no shared-air/coexistence model in this core test.

Before a stable release, define the support window, qualify current/previous stable client and firmware releases, sign artifacts, settle licensing, and run physical power-cut, two-node delivery, three-node relay and field-soak tests. Future EU transmission, BLE and encryption require separately negotiated capabilities and qualification; no present compatibility promise covers them.

T-Beam V1.2 support was explicitly added by the owner. Actual 1024-byte direct RF reception/destination ACK/exact inbox verification passes in both directions with Heltec prototype-6, using two simultaneous USB ports. This does not extend the result to three-node relays or field conditions. See TBEAM.md for exact hardware, image source, settings restoration and the initial first-write interruption observation.

Discovery extension: Heltec usb-prototype-7 / T-Beam tbeam-usb-prototype-2 retain USB1/config1/radio1 with additive discoveryVersion1/capabilitybit7, USB22–25 and radio control3–5. Records1/2/3 read; record3 is written only for nondefault discovery settings. Phase1 fixtures are unchanged; four new control fixtures are appended. Ordinary text/ACK frames retain their original bytes. Old peers ignore unknown controls. Actual two-board discovery plus text regression passed; see PHASE2.md. GPS/location capability is not advertised by this slice.
