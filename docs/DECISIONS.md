# Decisions and open questions

Status date: November 1, 2026. Proposed choices are reviewable recommendations, not implementation commitments.

| Topic | Current position | Status |
| --- | --- | --- |
| Repository | One Git repository for firmware, protocol, and clients; local `main` initialized | Established |
| First board | Heltec WiFi LoRa 32 V3 over USB; verify actual revision, band, flash size, serial bridge, and port | User direction; identification pending |
| Regional scope | Initial development and operation in the US; future EU support. Design regional profiles now; validate EU settings and hardware before enabling EU transmission | Confirmed by owner |
| Client | Desktop browser web app; USB first, BLE later | User direction |
| Protocol | Independent Reaper Mesh protocol; no Meshtastic interoperability promise | Proposed; owner decision needed |
| Firmware stack | ESP-IDF/C++ with a thin SX1262 driver adapter; evaluate driver support/license in M0 | Proposed |
| Client stack | TypeScript + React + Vite; shared client state library | Proposed |
| Serialization | Versioned Protocol Buffers, bounded embedded decoding; evaluate Nanopb and generated TS bindings | Proposed |
| Serial framing | COBS-delimited binary frames with length limits and CRC; logs on a separate path | Proposed; specify before implementation |
| Initial channels | One public channel first; named logical channels next, sharing a radio preset; no privacy until crypto | Proposed |
| Node roles | Normal node and relay-enabled node; forwarding controlled separately from logical channel type | Proposed |
| Message length | Start with a configurable hard cap of 1,024 UTF-8 bytes, subject to airtime/memory measurements | Proposed, not a throughput promise |
| Encryption | Deferred feature; reserve versioned authenticated-envelope extension, not homegrown crypto | User direction |
| Testing | “RACE tests” interpreted as race-condition/concurrency tests plus protocol compatibility tests | Clarification pending |
| Update UX | Browser guided USB installation and recovery; versioned manifest, board checks, configuration migration | Proposed |
| Licensing | No license selected; choose before publication or importing copyleft code | Open |

## Owner inputs needed before affected implementation

1. Exact Heltec model/revision and frequency variant. Initial operating country is confirmed as the US. Read-only USB inventory can help identify the port but cannot establish all RF details. Identify intended EU countries/bands before the EU milestone.
2. Whether nodes must talk to existing Meshtastic nodes. If yes, revisit radio protocol and compatibility scope before designing it.
3. Whether RACE refers to a particular framework/process rather than race-condition testing.
4. Meaning of channel “types” and “power”: proposed interpretation is public/named logical channels, node forwarding roles, and transmit-power settings. Battery/power-saving behavior needs separate requirements.
5. License choice and whether 1,024-byte messages are an appropriate initial target.

Do not block all planning on these answers. Do block RF transmission, irreversible operations, or protocol commitments that depend on them.
