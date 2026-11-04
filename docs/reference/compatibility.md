# Prototype compatibility and RACE coverage

There is no stable/public release yet. Firmware identifiers describe development builds; USB, radio, config and storage versions evolve independently. Do not force a agent update merely because the firmware build string changes. Negotiate capabilities and block unsupported writes while retaining readable device state.

| Firmware slice | USB v1 | Config schema | Record reads | Optional functions |
| --- | --- | --- | --- | --- |
| usb-prototype-0 / 1 | Base handshake/config/query | 1 | 1 | OLED added in 1 |
| usb-prototype-2 | Adds tags 12–14 | 1 | 1 | Bounded upload/queue status; no RF |
| usb-prototype-3 | Optional radio config fields | 1 | 1, 2 | Named channels/mode/power/relay; no RF |
| usb-prototype-4 | Adds diagnostics/inbox tags 15–21 | 1 | 1, 2 | Probe/RX, local delivery/inbox; antenna gate closed |
| usb-prototype-5 | Same wire/schema | 1 | 1, 2 | Antenna confirmed; superseded due to full-fragment SPI failure |
| tbeam-usb-prototype-1 | Same USB v1 | 1 | 1, 2 | ESP32/4MB, AXP2101/SX1276; real direct RF with Heltec6 passed |
| usb-prototype-6 | Same wire/schema | 1 | 1, 2 | DMA-backed full-fragment transfer; owner-confirmed US board/antenna |
| heltec/tbeam-reaper-mesh-v0.4.0 | `txLevel` replaces `txPower`, adds `txBoost` | 1 | 1–7 | Low, medium and high power; T-Beam boost |

Current agent to older firmware: missing message/radio/inbox capabilities disable those functions. Unknown optional fields are skipped by length; unsupported required behavior fails closed. Base agents editing label/region on newer firmware omit the five radio fields, preserving device-authoritative radio policy. A radio policy update is all-or-none, shares the revision CAS, and cancels stale queued work. Storage schema 1 remains readable; schema 2 is written only for nondefault radio policy. Downgrading to schema-1-only firmware with schema 2 on disk is unsupported: storage must fail closed, never erase itself.

Frozen envelopes/messages remain unchanged as additive fixtures are appended. Generated TS/C++ descriptors and vendor integrity are checked on every host run. The suite executes the actual C++ codec/session/authority/queue/mesh and real TS agent over byte transcripts, rather than relying solely on a parallel simulator model.

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

Before a stable release, define the support window, qualify current/previous stable agent and firmware releases, sign artifacts, and run physical power-cut, two-node delivery, three-node relay and field-soak tests. Future EU transmission, BLE and encryption require separately negotiated capabilities and qualification; no present compatibility promise covers them.

T-Beam V1.2 support was explicitly added by the owner. Actual 1024-byte direct RF reception/destination ACK/exact inbox verification passes in both directions with Heltec prototype-6, using two simultaneous USB ports. This does not extend the result to three-node relays or field conditions. See ../guides/t-beam-v12.md for exact hardware, image source, settings restoration and the initial first-write interruption observation.

Discovery extension: Heltec usb-prototype-7 / T-Beam tbeam-usb-prototype-2 retain USB1/config1/radio1 with additive discoveryVersion1/capabilitybit7, USB22–25 and radio control3–5. Records1/2/3 read; record3 is written only for nondefault discovery settings. Phase1 fixtures are unchanged; four new control fixtures are appended. Ordinary text/ACK frames retain their original bytes. Old peers ignore unknown controls. Actual two-board discovery plus text regression passed; see ../contributing/phase-2.md. GPS/location capability is not advertised by this slice.

## Fixed position (Heltec8 / T-Beam3)

USB/radio framing stays1; base config schema stays1. locationVersion1/feature256 gates none/fixed settings; discoveryVersion1/nodeCapacity32/feature128 is also required. Records1–4 are readable; nondefault position uses record4 (max166 bytes). Old agents omit location fields and preserve its policy. Future unsupported location capabilities leave this agent's base configuration usable while position edits are disabled. Existing frozen fixture bytes remain unchanged, with three position fixtures appended.

Location-bearing beacon/presence payloadv2 is rejected by discovery-v1-only receivers; name-only payloadv1 and manual requests remain supported. Text/data1/ACK2 are unchanged. Physically checked Heltec8↔T-Beam2 and Heltec8↔T-Beam3 with1024-byte messages, destination ACK and exact inbox body in each direction. New/new fixed reports and sharing-off identity-only responses are separately checked. This does not establish old firmware reading record4 after downgrade, relay, range or security.

## Channel IDs (`v0.3.0`)

Breaking, owner-approved before core v1 (D42, D45). The radio packet layout and USB v1 framing are
unchanged, but channels are now identified by 32-bit IDs and encrypted payloads use RME2. Earlier
firmware drops packets on channel IDs above 7 and rejects RME2, so update both boards together.
Channels from earlier settings keep working: slot *k* becomes ID *k* on both the device and the
agent, so two upgraded boards still share Public and their existing channels. Plaintext traffic
on Public and converted channels uses the same on-air values as earlier firmware, but mixed
versions were not tested on hardware. Records 1–6 are readable; record 6 is
written only for channels with other IDs. Downgrading with a record 6 stored fails closed without
erasing. The agent reads earlier firmware but does not change its channels or radio settings.
Encrypted messages saved by earlier builds (RME1) show as unsupported. The 31 earlier fixtures are
unchanged; three are appended.

## Screen settings (`v0.2.0`)

USB v1, config schema 1 and the radio protocol are unchanged. `screenVersion` 1 with feature bit
9 gates the screen timeout and wake settings. Agents without screen support omit both fields,
which preserves the device's values; this agent leaves screen settings alone on firmware that
does not advertise them or advertises another version. Records 1–5 are readable; record 5 is
written only for non-default screen settings. Downgrading to firmware that reads only records 1–4
with a record 5 stored is unsupported and fails closed without erasing. The 28 earlier fixtures
are unchanged; three are appended.
