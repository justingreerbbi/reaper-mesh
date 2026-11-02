# Completion tracker

The focused single-board USB prototype is implemented and verified to the limits below. This is not a production release or a claim of real multi-node mesh qualification. Later BLE/mobile/encryption/EU support remains outside this slice.

| Area | Implemented / evidence | Remaining qualification |
| --- | --- | --- |
| USB/config | Atomic NVS authority, version/capability gates, CAS, startup retries, native browser saves/reconnect, physical lost-reply/query/duplicate/reset | Real power-cut, arbitrary cable interruption, field soak |
| OLED | Owner confirms visible operation; bounded fail-closed updates, live radio status rows | Visual confirmation of every new row and induced I2C faults |
| Messages | 1024-byte UTF-8 upload, bounded queue, explicit outcomes, local delivery/inbox, durable browser history, query-only recovery | Real remote recipient ACK and field soak |
| Mesh | Independent packet/relay core; line/triangle loss/reorder/duplicate/hop/ACK races; 120-cycle seeded endurance | Two-board destination delivery and three-board relay qualification |
| Channels/settings | Eight public/named slots, power/mode/relay, compatible base-client edits, record migration, policy cancellation; native browser RX/off commits passed | Physical channel-isolation/interference measurements |
| SX1262 | Pinned Semtech core, shared airtime accounting, DMA SPI, actual probe/RX and seven-fragment TX_DONE; unreachable unicast retries -> failure | RF receive, range, coexistence and measured spectrum/power/airtime |
| Inbox/diagnostics | Bounded ring/chunk reads, gaps/reconnect, local 1024-byte delivery checked, live probe/memory/stack/counters | Actual remote input and extended hardware soak |
| Updates | Hashed manifest, embedded image/layout/security checks, staged immutable images, ROM verification, preserved NVS, validated extracted package with source/notices | Interrupted flash/power loss, automatic rollback and authenticated public releases |
| Compatibility/lifecycle | Frozen/additive fixtures, vendor checks, one-tab writer lock, journal/counter validation, bounded owner/history behavior, compatibility matrix | Stable-release support policy and field qualification |

## Current installed build

usb-prototype-6 from clean commit 56c8cf0, ESP32-S3/Heltec V3, owner-confirmed US board and attached US/915 MHz antenna. Default radio mode is off; explicit mesh mode permits TX. The first RF attempt in prototype-5 exposed the non-DMA 64-byte SPI limit and failed closed; prototype-6 uses DMA and verifies transfer capacity.

Physical prototype-6 RF test: a 1024-byte broadcast completed seven fragment TX_DONE events. An unreachable unicast made three transmissions then failed, never claiming recipient acknowledgment. TX counter reached 10. Original off policy was restored; three opens reached ready in 648/644/647 ms with revision 20 preserved. The owner subsequently used the browser to select mesh mode and send tests; final native browser observation showed prototype-6, revision 21, probe OK, ready, TX 1 and a locally delivered message. Those user-selected settings were preserved.

Host verification: npm run check passes 194 Node/compiler-backed tests (including eight Python updater/package groups) and the production web build; standalone CMake/CTest passes 53 tests. Endurance seed 0x73550728 acknowledges 103/120 under injected faults, including all 12 clean recovery intervals, without false ACKs or unbounded traffic. See COMPATIBILITY.md for conditions and limits.

## Further work

A second compatible US node is required for real receive/destination-ACK tests; a third is required for relay qualification. Power-cut and field/coexistence tests remain release gates. Source licensing is deferred at the owner's request. Encryption, BLE, other boards, mobile/native clients and EU transmission remain later work. Signed releases and dual-slot rollback must be designed and qualified before presenting an automatic public updater as production-ready.
