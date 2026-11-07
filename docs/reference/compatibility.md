# Compatibility and recovery coverage

There is no stable release yet, and no compatibility promise until core v1 (D42). This page
records how the versions fit together today, and which recovery cases the tests cover.

## Versions are separate

The USB protocol, configuration schema, storage records, radio format and firmware version each
change independently. An app never requires an update just because the firmware version string
changed: it reads the board's advertised capabilities and turns off what the board does not
support, while keeping the board readable.

## Firmware versions

All versions use USB protocol 1 and configuration schema 1. "Records" are the storage record
versions a build can read (see [Persistence](persistence.md)).

| Firmware | Records | What changed for compatibility |
| --- | --- | --- |
| `v0.1.0` | 1–4 | New image names (D8). Screen pages are board-local; no wire change |
| `v0.2.0` | 1–5 | `screenVersion` 1 (feature bit 9) gates screen settings, stored in record 5 |
| `v0.3.0` | 1–6 | **Breaking.** 32-bit channel IDs on air and the `RME2` envelope (D45). Earlier firmware drops packets on channel IDs above 7 and rejects RME2, so update boards together. Slot *k* converts to ID *k*, so upgraded boards keep sharing their channels |
| `v0.4.0` | 1–7 | `txLevel` replaces `txPower`, and `txBoost` is added (feature bits 11, 12). Stored dBm values load as medium |
| `v0.5.0`, `v0.6.0` | 1–7 | Bluetooth carries the same bytes as USB (D47). `v0.6.0` adds `pairingRequest` and `pairingStatus` (feature bit 13), accepted on USB only |
| `v0.6.1`, `v0.6.2` | 1–7 | No protocol change |
| `v0.7.0` | 1–7 | **Breaking.** `radioVersion` 2 replaces version 1 (D50), so older firmware cannot share traffic |
| `v0.8.0` | 1–7 | Adds `networkQuery`, `networkStatus`, `networkFill`, `teamLoad` and `networkErase` (feature bit 14). New partition table; silent until a network is chosen |
| `v0.9.0` | 1–7 | Adds `agentFeatures` in `hello` and the `inboxChanged` alert. Opaque payloads |
| `v0.10.0` | 1–7 | **Breaking for teams.** `networkFill` needs the epoch proof and `networkStatus` adds rotation fields (D52). The key record changes format, so a board reads as having no network after this install. Team codes become `RMTEAM2` |
| `v0.11.0` | 1–8 | Adds `ledEnabled` (feature bit 17) in record 8. Board-local, so it shares traffic with `v0.10.0` |
| `v0.11.1` | 1–8 | The LED defaults off, and record 8 now means on. A `v0.11.0` board with the LED on and no record 8 reads as off |

## Rules

- **Newer app, older firmware:** missing capabilities turn those features off. Unknown optional
  fields are skipped by length; unsupported required behavior fails closed.
- **Older app, newer firmware:** an app that does not know a group of fields leaves them out of
  a save, which keeps the board's values. Radio, position, screen and LED settings all work this
  way.
- **Grouped saves:** a radio settings change is all-or-nothing, shares the revision check, and
  cancels stale queued work.
- **Storage:** each new record is written only when a setting differs from its default, so
  boards that never use a feature stay readable by older firmware. Downgrading with a newer
  record stored is unsupported and **fails closed without erasing**.
- **Fixtures:** frozen fixtures in `packages/protocol/fixtures/` keep their exact bytes. New
  messages append new fixtures. Generated TypeScript and C++ descriptors are checked on every
  test run.

The test suite runs the real C++ codec, session, configuration authority, queue and mesh code
and the real TypeScript agent over byte transcripts, rather than a parallel model.

## Recovery (RACE) coverage

| Boundary | Automated coverage | Hardware coverage and limits |
| --- | --- | --- |
| Lost or duplicate replies, revision conflicts | Commit before publish, no second revision | Lost reply recovered by query; duplicate returns the same revision; reset keeps settings |
| Snapshot and event overlap, gaps, stale boots | Both orderings, gap resync, stale callbacks rejected | Repeated opens and resets checked; random cable and power cuts not yet |
| Partial upload, lost acceptance, reconnect | Maximum UTF-8, completeness bitmap, conflicts, bounded retries, query-only recovery | 1,024-byte acceptance and inbox; interrupted encrypted uploads on two boards |
| Browser reload, storage, two tabs | Counter checkpoint before dispatch; unfinished becomes unknown; corrupt, full and locked storage | Outgoing and inbox history kept across a reload in native Brave |
| Radio loss, reordering, duplicates, ACK races | Three-node line and triangle, hop and queue limits, exact-deadline and early ACK | Two-board delivery; relay timing needs three boards |
| Long-running recovery | 120 messages with seeded loss, corruption, TX failure and duplicates; all 12 clean intervals must recover | Virtual time only, not a physical soak |
| Bad updates | Checksum, hash, size, offset, partition, target and security rejection; package validation | ROM-verified installs that keep settings; interrupted flash not yet |

The endurance test uses seed `0x73550728` over more than four virtual hours, with 10% per-link
drops, 5% corruption and 2% transmit failures in faulted intervals. It acknowledges 103 of 120
messages, checks every delivered body, and never accepts an acknowledgment without complete
data. These are recovery checks, not a promised delivery rate.

## Before a stable release

Define the support window, test the current and previous stable app and firmware together, sign
releases, and pass the power-cut, two-node, three-node relay and field soak tests. EU operation
will need its own negotiated capability and testing.
