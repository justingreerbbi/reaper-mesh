# Completion tracker

Product status: **Phase 1 complete; Phase 2 active (2.1 discovery complete; 2.2 position next)**. See [ROADMAP.md](ROADMAP.md) for all four phases and [PHASE2.md](PHASE2.md) for the next implementation contract. Discovery is implemented and physically checked; location and the redesigned portal remain ahead. The qualification details below remain relevant release gates.

The focused single-board USB prototype is implemented and verified to the limits below. This is not a production release or a claim of real multi-node mesh qualification. Later BLE/mobile/encryption/EU support remains outside this slice.

| Area | Implemented / evidence | Remaining qualification |
| --- | --- | --- |
| USB/config | Atomic NVS authority, version/capability gates, CAS, startup retries, native browser saves/reconnect, physical lost-reply/query/duplicate/reset | Real power-cut, arbitrary cable interruption, field soak |
| OLED | Owner confirms visible operation; bounded fail-closed updates, live radio status rows | Visual confirmation of every new row and induced I2C faults |
| Messages | 1024-byte UTF-8 upload, bounded queue, explicit outcomes, local delivery/inbox, durable browser history, query-only recovery | Extended loss/latency and field soak; direct remote ACK passed with T-Beam |
| Mesh | Independent packet/relay core; line/triangle loss/reorder/duplicate/hop/ACK races; 120-cycle seeded endurance | Three-board relay qualification; two-board direct delivery passed |
| Channels/settings | Eight public/named slots, power/mode/relay, compatible base-client edits, record migration, policy cancellation; native browser RX/off commits passed | Physical channel-isolation/interference measurements |
| SX1262 | Pinned Semtech core, shared airtime accounting, DMA SPI, actual probe/RX and seven-fragment TX_DONE; unreachable unicast retries -> failure | Range/coexistence and measured spectrum/power/airtime; direct receive passed with T-Beam |
| Inbox/diagnostics | Bounded ring/chunk reads, gaps/reconnect, local 1024-byte delivery checked, live probe/memory/stack/counters | Extended hardware soak; actual direct remote input passed |
| Updates | Hashed manifest, embedded image/layout/security checks, staged immutable images, ROM verification, preserved NVS, validated extracted package with source/notices | Interrupted flash/power loss, automatic rollback and authenticated public releases |
| Compatibility/lifecycle | Frozen/additive fixtures, vendor checks, one-tab writer lock, journal/counter validation, bounded owner/history behavior, compatibility matrix | Stable-release support policy and field qualification |

## Current installed build

usb-prototype-6 from clean commit 56c8cf0, ESP32-S3/Heltec V3, owner-confirmed US board and attached US/915 MHz antenna. Default radio mode is off; explicit mesh mode permits TX. The first RF attempt in prototype-5 exposed the non-DMA 64-byte SPI limit and failed closed; prototype-6 uses DMA and verifies transfer capacity.

Physical prototype-6 RF test: a 1024-byte broadcast completed seven fragment TX_DONE events. An unreachable unicast made three transmissions then failed, never claiming recipient acknowledgment. TX counter reached 10. Original off policy was restored; three opens reached ready in 648/644/647 ms with revision 20 preserved. The owner subsequently used the browser to select mesh mode and send tests; final native browser observation showed prototype-6, revision 21, probe OK, ready, TX 1 and a locally delivered message. Those user-selected settings were preserved.

Host verification: npm run check passes 194 Node/compiler-backed tests (including eight Python updater/package groups) and the production web build; standalone CMake/CTest passes 53 tests. Endurance seed 0x73550728 acknowledges 103/120 under injected faults, including all 12 clean recovery intervals, without false ACKs or unbounded traffic. See COMPATIBILITY.md for conditions and limits.

## Further work

The added T-Beam V1.2 now passes actual bidirectional 1024-byte direct delivery/destination-ACK/inbox tests with the Heltec on the same computer (see TBEAM.md). A third board is required for relay qualification. Power-cut and field/coexistence tests remain release gates. Source licensing is deferred at the owner's request. Encryption, BLE, other boards, mobile/native clients and EU transmission remain later work. Signed releases and dual-slot rollback must be designed and qualified before presenting an automatic public updater as production-ready.

## T-Beam extension

Owner-requested T-Beam V1.2 support is installed and hardware-qualified for USB/local messaging, AXP2101/SX1276 probe, receive initialization, TX_DONE and direct two-node RF. Both target builds validate; 197 host tests and 56 CTests pass. The initial first-write auxiliary-read interruption recovered on reconnect and remains a soak/interruption observation. Current web UI is one-device-at-a-time; CLI pair tests use two simultaneous ports.

## Discovery slice

Heltec7/T-Beam2 from a44319b are installed. Actual disabled-response silence, bidirectional discovery/name responses and a timed periodic beacon pass; ordinary 1024-byte RF/ACK messaging still passes. No locations transmitted. Automatic beacon/response flags restoredoff. See PHASE2.md for resource measurements, exact boundaries, serial-driver observation and remaining Phase2 work.
