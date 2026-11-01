# Completion tracker

This tracks the focused initial project, not later BLE/mobile/encryption/EU transmit support. Do not equate host simulation with RF qualification.

| Area | Implemented / evidence | Remaining |
| --- | --- | --- |
| USB/config | Device authority, atomic NVS, version/capability gates, browser saves, startup retries, lost-reply query/duplicate/reset hardware tests | Power-cut qualification, extended soak |
| OLED | Owner confirms visible operation; bounded/fail-closed display updates | Verify new live radio rows during RF qualification |
| Message submission | 1024-byte bounded upload, volatile queue, explicit outcomes, lost-result native wire tests, hardware expiry, browser composition | Durable browser recovery history, field soak |
| Mesh | Independent packet codec, bounded reassembly/forwarding, three-node deterministic loss/reorder/duplicate/ACK/hop tests | Actual two-/three-board delivery and relay qualification |
| Channels/radio settings | Eight public/named slots, relay/power/mode, compatible base-client edits, record migration, policy cancellation hardware tests | Actual browser radio-settings QA with integrated driver |
| SX1262 | Pinned license-reviewed Semtech core, TX gate, timeout/fault tests, shared airtime accounting, board SPI integration built | Hardware probe/RX initialization; antenna confirmation before TX |
| Inbox/diagnostics | Bounded ring/chunk reader, gaps/reconnect recovery, native cross-language transcript, local-delivery and service tests | Deploy and qualify integrated usb-prototype-4 on one board |
| Updates | Pinned build, hashed manifests, ROM CLI recovery, supervised writes verified | Guided manifest-checking updater, recovery UX/package validation |
| Release/lifecycle | Frozen fixtures, generated/vendor checks, strict host checks | Browser reload journal, resource-lifecycle UX, stress/fuzz/compatibility matrix, release packaging |

Project licensing is deferred. Encryption, BLE, other boards, mobile/native clients and EU transmission remain explicitly later work. Antenna confirmation and additional physical nodes are external qualification inputs, not reasons to fabricate success or stop independent development.
