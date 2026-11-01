# Decisions and open questions

Status date: November 1, 2026. Proposed choices are reviewable recommendations, not implementation commitments.

| Topic | Current position | Status |
| --- | --- | --- |
| Repository | One Git repository for firmware, protocol, and clients; local `main` initialized | Established |
| First board | Heltec WiFi LoRa 32 V3 over USB; verify actual revision, band, flash size, serial bridge, and port | User direction; identification pending |
| Regional scope | Initial development and operation in the US; future EU support. Design regional profiles now; validate EU settings and hardware before enabling EU transmission | Confirmed by owner |
| Client | Desktop browser web app; USB first, BLE later | User direction |
| Protocol | Independent, documented Reaper Mesh protocol; no Meshtastic interoperability | Confirmed by owner |
| Firmware stack | ESP-IDF/C++ with a thin SX1262 driver adapter; evaluate driver support/license in M0 | Proposed |
| Client stack | TypeScript + React + Vite; shared client state library | Proposed |
| Serialization | Host draft uses schema-driven TLV with generated TypeScript declarations and bounded validation; review TLV versus Protocol Buffers before embedded implementation/public release | Provisional host implementation; embedded generator pending |
| Serial framing | Draft v1: COBS + zero delimiter, RM/version/flags/length header, max 2,048-byte payload, CRC-32/ISO-HDLC; logs on a separate path | Host implementation tested; release format not frozen |
| Initial channels | One public channel first; named logical channels next, sharing a radio preset; no privacy until crypto | Proposed |
| Node roles | Normal node and relay-enabled node; forwarding controlled separately from logical channel type | Proposed |
| Message length | Start with a configurable hard cap of 1,024 UTF-8 bytes, subject to airtime/memory measurements | Proposed, not a throughput promise |
| Encryption | Deferred feature; reserve versioned authenticated-envelope extension, not homegrown crypto | User direction |
| Testing | RACE means deliberate device/client synchronization and easy recovery after interrupted connections; implement deterministic race/recovery and compatibility tests | Confirmed by owner |
| Request history | Bounded FIFO receipts plus non-evicting per-owner sequence marks; query-only reconnect recovery; evicted results remain unknown and cannot reexecute | Host-tested draft with capacity/admission metadata; firmware persistence and owner-retirement UX pending |
| Host verification | Strict TypeScript, generated-schema checks, 87 host tests; pinned Node 24/25 CI workflow | Locally passing on Node 25; remote CI pending |
| Update UX | Browser guided USB installation and recovery; versioned manifest, board checks, configuration migration | Proposed |
| Licensing | Decision deferred by owner; do not assign a license or import incompatible third-party code in the meantime | Deferred |

## Owner inputs needed before affected implementation

1. Board revision and band verification before firmware development. Owner confirms a US-model Heltec V3; USB inventory identifies only the CP2102 bridge. Identify intended EU countries/bands before the EU milestone.
2. Meaning of channel “types” and “power”: proposed interpretation is public/named logical channels, node forwarding roles, and transmit-power settings. Battery/power-saving behavior needs separate requirements.
3. Whether 1,024-byte messages are an appropriate initial target. Licensing remains deferred and does not block first-party foundations.

Do not block all planning on these answers. Do block RF transmission, irreversible operations, or protocol commitments that depend on them.
