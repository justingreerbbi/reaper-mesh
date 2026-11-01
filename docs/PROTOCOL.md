# Reaper Mesh protocol: synchronization draft

Status: independent Reaper Mesh protocol, confirmed by the owner. This is a draft semantic contract and USB protocol, not a frozen release protocol. No Meshtastic interoperability is intended. Host framing, typed negotiation/synchronization payloads, generated TypeScript declarations, and a byte-driven connection manager are implemented. A Web Serial adapter is implemented and tested with simulated ports, without opening hardware. Configuration commands/results and recovery queries are integrated and tested through simulated serial streams. Generated C++17 descriptors and a fixed-buffer codec now pass host cross-language tests. Physical validation, ESP-IDF application/persistence, and radio packets remain unimplemented.

## USB envelope draft v1

`packages/protocol/framing.ts` encodes and incrementally decodes binary envelopes. Decode the complete COBS frame (excluding its zero delimiter), then validate this raw layout:

| Offset | Length | Meaning |
| --- | --- | --- |
| 0 | 2 | Magic bytes `52 4d` (`RM`) |
| 2 | 1 | Envelope version `01`, independent of application protocol negotiation |
| 3 | 1 | Reserved flags, must currently be zero |
| 4 | 2 | Payload length, unsigned little endian, 1–2,048 bytes |
| 6 | Payload length | Typed draft payload described below |
| 6 + payload length | 4 | CRC-32/ISO-HDLC, little endian, over header and payload |

CRC parameters: reflected polynomial `0xedb88320`, initial value `0xffffffff`, final xor `0xffffffff`; standard ASCII `123456789` check is `0xcbf43926`. CRC detects accidental corruption; it does not authenticate a frame.

COBS-encode the whole raw envelope and append `00`. Maximum raw size is 2,058 bytes; maximum encoded size is 2,067 bytes, excluding the delimiter. The incremental decoder retains one fixed 2,067-byte buffer. Empty delimiters are ignored. Invalid frames are dropped. Oversize input is counted once and discarded until the next delimiter. A lost delimiter can sacrifice two joined frames; parsing resumes after the next boundary. A truncated frame is eventually cleared when the connection's negotiation, synchronization, or health deadline closes the connection.

Reset the decoder on every connection generation change. Prefix a newly opened stream with an empty delimiter to flush incomplete framing at the peer. Keep boot/debug logs off this binary stream. Validated payload callbacks run synchronously, one frame at a time; the caller must bound downstream queues and apply backpressure. Callback exceptions propagate to the caller, which must close/reset the transport rather than replaying the partially consumed chunk. Diagnostic counts are per `feed()` call, without an unbounded internal log.

`packages/protocol/fixtures/envelope-v1.json` is a shared golden envelope for future embedded implementations; its CRC was independently checked with Python's zlib. Host tests cover COBS/checksum vectors, all split boundaries for a sample frame, bytewise maximum-size input, concatenated frames, every single-bit corruption of a sample frame, unsupported headers, inconsistent lengths, overflow, reset, and seeded noise/chunk schedules. These establish framing behavior only. Do not route opaque payloads directly to `Synchronizer` or `Commands`.

## Typed payload draft v1

The first host vertical slice uses a small dependency-free TLV codec rather than introducing Protocol Buffers dependencies before firmware/toolchain evaluation. This is a provisional wire choice and must be reviewed before embedded implementation or a public release. There is no claim that TLV and Protobuf encodings interoperate.

`packages/protocol/schema.json` is the single source for message tags, ordered field tags, and validation kinds. A trailing `?` denotes an optional field. `messages.ts` consumes it at runtime. `npm run generate:protocol` generates TypeScript declarations and the C++ descriptor header; `npm test` checks they have not drifted. The portable C++ codec consumes the generated descriptors under firmware/components/reaper_protocol/. Do not hand-copy a second schema into firmware.

The payload begins with one byte for payload version (`01`) and one for message type. Each field follows as a one-byte nonzero field tag, two-byte little-endian byte length, then field data. A field's tag is its 1-based position in that message's schema field list. Preserve existing message tags, field order, and meanings. Adding a required field or changing its kind is a breaking protocol change. Unknown optional field tags are skipped by length; duplicates (including unknown tags), tag zero, missing required fields, invalid widths, overruns, unknown message types/versions, and oversized payloads are rejected. Fields may arrive in any order. The envelope's 2,048-byte limit also bounds field count and allocations.

| Message tag/type | Fields in tag order | Purpose |
| --- | --- | --- |
| 1 hello | link, minVersion, maxVersion | Client initiates negotiation |
| 2 welcome | link, device, boot, minVersion, maxVersion | Device identifies itself and supported range |
| 3 sync | link, boot, request | Atomically establish ordered config subscription and snapshot boundary |
| 4 snapshot | link, boot, request, sequence, revision, region, label | Reply with authoritative config and counters |
| 5 event | link, boot, sequence, revision, region, label | Ordered complete config change |
| 6 ping | link, request | Client probes health/identity |
| 7 pong | link, boot, request | Device returns current boot and matching probe ID |
| 8 configure | link, boot, id, expectedRevision, region, label | Retry-safe configuration compare-and-set |
| 9 result | link, boot, id, outcome, revision | Command receipt or query result |
| 10 query | link, boot, id | Read-only lookup of a retained command result |

The hello additionally appends optional field 4 `owner` (client incarnation). Welcome appends optional metadata at tags 6–15, preserving all original required fields. Older v1 peers can still exchange snapshots, but cannot configure through the new client without the complete safety metadata.

| Welcome field tag | Field | Meaning |
| --- | --- | --- |
| 6 | configSchema | Supported config schema; client writes require version 1 |
| 7 | features | Bits 0/1/2: revision-checked writes, result queries, monotonic duplicate suppression |
| 8 | maxPayload | Device receive capacity; client currently requires at least 512 bytes for writes |
| 9 | receiptCapacity | Maximum retained command receipts; must be positive |
| 10 | ownerCapacity | Maximum retained owner marks; must be positive |
| 11 | ownerAdmitted | 1 if the hello owner is admitted for this boot, otherwise 0 |
| 12 | regions | Bits 0/1/2 permit UNSET/US/EU config values respectively |
| 13 | maxLabelBytes | Device label bound; supported range 1–64 UTF-8 bytes |
| 14 | firmware | Build identifier using the bounded ID character set |
| 15 | radioVersion | Independent radio protocol version; 0 means no implemented radio protocol |

All metadata fields except firmware are u32. Metadata is immutable and cleared on disconnect. Missing/partial metadata, unknown config schema, missing safety bits, unusable limits, or denied admission yield a readable connection with `writeBlockReason`; they cannot consume command IDs or send mutations. Unknown feature bits are ignored while all known required bits remain required. Result queries need the advertised query bit and remain allowed when new owner admission is denied. Region/UTF-8 label limits are checked before retaining a mutation. Regional bits describe permitted configuration, not RF authorization or verified hardware support.

The device must atomically admit the hello owner before advertising `ownerAdmitted=1`. Repeated admission of that owner is idempotent and does not consume its first command sequence. When the owner table is full, preserve old marks, deny new owners, and expose read-only operation. Never reset automatically or pretend rotating IDs restores capacity. Reuse the client manager across reconnects. Full session retirement/owner-exhaustion UX and persistence rules remain release requirements.

Counter and version fields are unsigned 32-bit little-endian integers with exactly four bytes. Reject overflow/fractional/negative values before encoding. Device, boot, and link IDs are 1–64 ASCII letters, digits, underscores, or hyphens; allocate collision-resistant boot IDs on each reboot and fresh link IDs for every open. IDs are correlation values, not authentication. `label` is strict UTF-8 up to 64 bytes, allows empty text, and rejects ASCII controls. Invalid UTF-8 and unpaired Unicode surrogates are rejected. `region` is currently `UNSET`, `US`, or `EU`; accepting a config value does not enable RF or certify regional support. Firmware must separately enforce verified regional/hardware capabilities.

Configuration command submission, result handling, and read-only recovery queries now run through `Connection` and `SerialAdapter`. Command IDs are a 1–64-character incarnation plus `:` and a canonical decimal sequence from 1 through 4,294,967,295; no leading zeros. Results allow `committed`, `conflict`, `rejected`, or `unknown`. The result's revision is informational and must never overwrite configuration by itself. Devices now advertise command/owner capacities; this does not promise a time-based result-retention window.

Use `SerialAdapter.configure(config)` and `SerialAdapter.recover(id)` while connected; inspect `connection.commands.status(id)` and explicitly release non-pending client history using `connection.forget(id)`. Mutations require readiness. Malformed configuration is rejected before consuming an ID/history slot. A disconnect immediately marks pending commands unknown. Recovery is bound to the original device identity and boot, and never submits the original mutation on a new link. Even a matching boot from a different device cannot recover its receipt.

The first accepted committed/conflict receipt triggers resynchronization. This recovers authoritative config if the change event was lost or a concurrent write won. Wrong-boot, stale-link, and duplicate terminal receipts do not repeatedly trigger snapshots. Repeated `unknown` query responses leave the outcome uncertain. There is no automatic query retry policy yet; callers can explicitly retry read-only recovery if needed.

## Connection manager and adapter boundary

`packages/client-core/connection.ts` accepts bytes and queues outgoing frames. The Web Serial adapter (`serial.ts`, see `docs/SERIAL.md`) opens the port and implements this ownership contract: call `open(freshLink, monotonicMs)`, deliver reads using the returned local session generation, call `tick()` regularly, serialize drained writes with backpressure, and call `close()` on read/write failure, EOF, or device removal. After any failed write, discard remaining writes from that generation; never replay them into a reopened port. The manager does not own a physical port, asynchronous I/O, browser permissions, or timers.

Negotiation and synchronization each have a fixed 5,000 ms deadline. The first valid welcome starts the sync deadline; later stale data and repeated failed snapshots do not extend it. Readiness schedules a ping after 2,000 ms. Once sent, only a pong matching the outstanding probe/link satisfies the 5,000 ms response deadline; config traffic cannot conceal a missing pong. Deadline expiry takes precedence over input received at the exact same timestamp. A matched pong with a different boot closes the connection and requires explicit reopen/resync; there is no automatic replay or reconnect loop.

Snapshot/event messages must match both wire link and boot. Local callbacks must match the connection generation. Snapshot results also match the outstanding sync request, and must never move counters backward within a boot. Gaps trigger a fresh sync request while mutations remain blocked. The `sync` request requires the device to establish a subscription before capturing its atomic snapshot; host tests do not prove this on a real device.

The outgoing queue holds at most eight frames; exhaustion closes the connection and clears pending writes. Malformed input is dropped without extending deadlines. `drain()` transfers ownership of queued frames; the adapter must bound its own in-flight work. The manager remembers at most 1,024 link IDs to reject reuse, then requires a new manager with fresh identities. Further resource budgets and clock/counter rollover policy are required before production.

## Terminology

A node is a radio device. A client/agent is software connected to it. RACE means designing and testing for synchronization and recovery across interrupted connections and concurrent operations; it is not a named framework.

## Connection contract

1. Opening a connection allocates a new local session generation. Every asynchronous callback is tagged with that generation; closing immediately invalidates it.
2. A version handshake chooses a supported protocol version and reports a device identity and boot identity. Protocol version 1 is the initial host-side prototype. Incompatible peers cannot mutate state.
3. Establish an ordered configuration-event subscription before requesting a snapshot. Snapshot acquisition must atomically capture configuration, its revision, and the subscription sequence boundary. Firmware must eventually implement this consistency boundary.
4. Buffer events while the snapshot is outstanding. On receipt, discard buffered events at or below its boundary and apply subsequent contiguous events. An event sequence or revision gap invalidates readiness and requests a fresh snapshot.
5. Bound the buffer (prototype default: 64 configuration events). Overflow invalidates the outstanding snapshot request and starts a new one. The connection manager enforces synchronization and health deadlines.
6. A transport reconnect or detected reboot restarts negotiation and synchronization. A transport adapter must detect boot identity changes and restart the connection lifecycle; the core ignores mismatched-boot frames to avoid stale-frame resets. Periodic health/identity checks are required to discover a quiet reboot.

This prototype has a dedicated configuration stream: each event increments both sequence and configuration revision by one and carries a complete small configuration object. Message, status, and telemetry events must not silently share these counter semantics. A snapshot can represent multiple intervening commits. Each resync request has a unique local token to reject delayed responses.

Configuration is authoritative on the device. The client copies snapshots/events and exposes mutation context only while ready. Commands carry expected boot identity and configuration revision. The host reference device validates both, but real firmware must implement atomic persistence before returning success. Client gating alone does not prevent races on the device.

## Configuration commands and recovery

`packages/client-core/commands.ts` implements the host command lifecycle; `packages/simulator/config-device.ts` is a device reference used only in host tests, not firmware. Inputs are still assumed to be validated objects.

- IDs consist of a caller-supplied client incarnation (1–64 ASCII letters, digits, underscores, or hyphens) plus a monotonically increasing local counter. The caller must allocate a fresh, collision-resistant incarnation whenever creating a command manager, including after a client restart. It is not an authentication credential.
- A command contains its ID, expected boot, expected config revision, and a copied immutable config body. Only one config command may be pending per manager. The device must use compare-and-set revision validation to arbitrate different clients.
- A retained receipt binds an ID to its original command body and outcome. Duplicate bodies return the original outcome even after config revision changes; conflicting reuse is rejected. A result acknowledges device acceptance/persistence semantics only; it is never applied as a configuration snapshot.
- Defaults are 32 retained client entries, a 1,000 ms retry interval, and at most three attempts including the initial submission. A monotonic integer clock is supplied by the caller. `tick()` returns retries for transport dispatch; it must run regularly and immediately after lifecycle changes. No background clock or transport dispatch exists yet.
- Retries reuse the same immutable command, only while its original connection and boot remain ready. A connection change, loss of readiness, or exhausted retry budget sets the outcome to `unknown` and stops retries. Transport write failure must not be interpreted as proof the device received nothing.
- After reconnect and snapshot reconciliation on the same boot, explicit `recover(id)` produces a read-only status query. A query reply is tagged with the new connection generation; old-connection responses remain invalid. Unknown or absent receipts do not authorize replay. On a different boot, recovery cannot establish the original outcome. Keep it unknown even if the current config happens to match.
- A late receipt on the original live connection may resolve an unknown result. Once committed/conflict/rejected is established, duplicates do not change it. If timeout runs just before a receipt, the resulting duplicate is harmless within device receipt retention.
- Client history is bounded and requires explicit `forget(id)` for non-pending entries. Forgetting an unknown command removes the ability to query it; it does not cancel or undo device work. Never automatically recycle request IDs.

### Bounded receipt reclamation draft

The reference device now retains a FIFO of 32 receipts and eight client-owner high-water marks by default. Both limits are constructor-configurable in host tests. Each high-water mark is the greatest observed command sequence for that owner in this boot, and is never evicted within the boot. Receipt capacity therefore limits how long an exact result can be recovered, not whether an old request can run again.

On command arrival, check the target boot, then look for a retained receipt. An exact retained request returns its original result; reuse of its ID with a changed body is rejected. If no receipt exists and its sequence is at or below the owner's high-water mark, return unknown and do not execute. Otherwise, admit the owner if capacity permits, advance its high-water mark, perform revision-checked configuration acceptance, and retain the receipt, evicting the oldest receipt if necessary. Queries never execute commands or advance marks.

This contract deliberately requires monotonically increasing submissions within an owner, with one pending command per manager. If requests arrive out of order, an unseen lower sequence may be suppressed as unknown. It must never be interpreted as safe to replay. Client retries occur only in the original link; reconnect recovery is query-only. Unknown commands can be intentionally abandoned before newer work, but doing so does not prove cancellation or execution.

A full owner table rejects new owners without evicting old marks; existing owners can continue beyond receipt capacity. This is a bounded-resource error, not permission to reset the device automatically. Owner capacity negotiation, client-restart/session lifecycle, and a user recovery flow for owner exhaustion remain required before release. The contract is a host-tested draft, not a complete production resource policy.

On reboot, config/revision survive in the simulation but receipts and high-water marks do not. A fresh boot identity rejects all old-boot commands, so receipt loss does not make their IDs executable in the new boot. Counter exhaustion must never wrap; create a new incarnation only under the defined owner-capacity policy. Real firmware must serialize high-water/receipt/commit bookkeeping and persist configuration atomically before success; flash atomicity, crash ordering, receipt persistence, power-loss behavior, and authenticated identities remain unimplemented.

## Deferred contracts

Next implement device configuration authority/persistence and session retirement/owner-exhaustion recovery UX. Embedded descriptors/codec now pass host tests; see firmware/README.md. The local web UI now exposes write-blocked diagnostics and query-only recovery; see docs/WEB.md. Strict static checks, CI configuration, and handshake capabilities/resource admission are implemented; remote CI and hardware validation remain pending. Review the serialization and retention drafts before firmware integration. Retry-safe message submission, radio ACK/timeout behavior, and stable message IDs across reboot remain separate work; config-command tests do not establish radio delivery. USB acceptance, radio transmission, destination acceptance, and human reading remain separate states. Do not automatically resend uncertain messages during resync.

`Connection` dispatches only successfully decoded and validated typed negotiation/synchronization messages. Direct callers of `Synchronizer` and `Commands` must still supply validated objects. These components are not wire decoders.

## Embedded compatibility evidence

The C++17 codec uses fixed buffers and caller-owned output, with no heap allocation in codec code. Cross-language tests compare canonical bytes and acceptance/rejection across all ten message types, optional/unknown/reordered fields, truncated data, corruption, Unicode/ID boundaries, overflow/recovery, and seeded noise. Frozen messages-v1.json fixtures are not regenerated automatically. Local UBSan passes; Linux CI is configured for UBSan/ASan, while macOS ASan remains unverified because startup stalled. These checks establish the host codec contract, not target RAM/stack, NVS crash safety, or real serial/radio behavior.
