# Reaper Mesh protocol: synchronization draft

Status: independent Reaper Mesh protocol, confirmed by the owner. USB framing, capability negotiation, authoritative configuration, bounded message submission, live diagnostics and inbox retrieval are implemented in TypeScript/C++ and exercised on the Heltec. Native browser connect/save/reconnect and local-history reload are checked. The independent radio protocol and three-node fault simulator are implemented; single-board TX completion does not qualify recipient delivery or relays. This remains a development protocol, with frozen compatibility fixtures and separate protocol/config/radio versions.

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
| 1 hello | link, minVersion, maxVersion | Agent initiates negotiation |
| 2 welcome | link, device, boot, minVersion, maxVersion | Device identifies itself and supported range |
| 3 sync | link, boot, request | Atomically establish ordered config subscription and snapshot boundary |
| 4 snapshot | link, boot, request, sequence, revision, region, label | Reply with authoritative config and counters |
| 5 event | link, boot, sequence, revision, region, label | Ordered complete config change |
| 6 ping | link, request | Agent probes health/identity |
| 7 pong | link, boot, request | Device returns current boot and matching probe ID |
| 8 configure | link, boot, id, expectedRevision, region, label | Retry-safe configuration compare-and-set |
| 9 result | link, boot, id, outcome, revision | Command receipt or query result |
| 10 query | link, boot, id | Read-only lookup of a retained command result |
| 11 error | link, boot, code | Explicit logical-session failure |
| 12 submit | link, boot, id, channel, destination, part, count, data | Bounded message chunk upload |
| 13 messageStatus | link, boot, id, state, received, messageId?, reason? | Queue/delivery state and received bitmap |
| 14 messageQuery | link, boot, id | Read-only message recovery |

The hello additionally appends optional field 4 `owner` (agent incarnation). Welcome appends optional metadata at tags 6–18, preserving all original required fields. Older v1 peers can still exchange snapshots, but cannot configure through the new agent without the complete safety metadata.

| Welcome field tag | Field | Meaning |
| --- | --- | --- |
| 6 | configSchema | Supported config schema; agent writes require version 1 |
| 7 | features | Bits 0/1/2: revision-checked writes, result queries, monotonic duplicate suppression |
| 8 | maxPayload | Device receive capacity; agent currently requires at least 512 bytes for writes |
| 9 | receiptCapacity | Maximum retained command receipts; must be positive |
| 10 | ownerCapacity | Maximum retained owner marks; must be positive |
| 11 | ownerAdmitted | 1 if the hello owner is admitted for this boot, otherwise 0 |
| 12 | regions | Bits 0/1/2 permit UNSET/US/EU config values respectively |
| 13 | maxLabelBytes | Device label bound; supported range 1–64 UTF-8 bytes |
| 14 | firmware | Build identifier using the bounded ID character set |
| 15 | radioVersion | Independent radio protocol version; 0 means no implemented radio protocol |
| 16 | messageVersion | Message semantics version; 1 required for uploads |
| 17 | maxMessageBytes | Hard whole-message bound; currently 1024 |
| 18 | messageCapacity | Volatile device message records; currently 8 |

All metadata fields except firmware are u32. Metadata is immutable and cleared on disconnect. Missing/partial metadata, unknown config schema, missing safety bits, unusable limits, or denied admission yield a readable connection with `writeBlockReason`; they cannot consume command IDs or send mutations. Unknown feature bits are ignored while all known required bits remain required. Result queries need the advertised query bit and remain allowed when new owner admission is denied. Region/UTF-8 label limits are checked before retaining a mutation. Regional bits describe permitted configuration, not RF authorization or verified hardware support.

The device must atomically admit the hello owner before advertising `ownerAdmitted=1`. Repeated admission of that owner is idempotent and does not consume its first command sequence. When the owner table is full, preserve old marks, deny new owners, and expose read-only operation. Never reset automatically or pretend rotating IDs restores capacity. Reuse the agent manager across reconnects. Full session retirement/owner-exhaustion UX and persistence rules remain release requirements.

Counter and version fields are unsigned 32-bit little-endian integers with exactly four bytes. Reject overflow/fractional/negative values before encoding. Device, boot, and link IDs are 1–64 ASCII letters, digits, underscores, or hyphens; allocate collision-resistant boot IDs on each reboot and fresh link IDs for every open. IDs are correlation values, not authentication. `label` is strict UTF-8 up to 64 bytes, allows empty text, and rejects ASCII controls. Invalid UTF-8 and unpaired Unicode surrogates are rejected. `region` is currently `UNSET`, `US`, or `EU`; accepting a config value does not enable RF or certify regional support. Firmware must separately enforce verified regional/hardware capabilities.

Configuration command submission, result handling, and read-only recovery queries now run through `Connection` and `SerialAdapter`. Command IDs are a 1–64-character incarnation plus `:` and a canonical decimal sequence from 1 through 4,294,967,295; no leading zeros. Results allow `committed`, `conflict`, `rejected`, or `unknown`. The result's revision is informational and must never overwrite configuration by itself. Devices now advertise command/owner capacities; this does not promise a time-based result-retention window.

Use `SerialAdapter.configure(config)` and `SerialAdapter.recover(id)` while connected; inspect `connection.commands.status(id)` and explicitly release non-pending agent history using `connection.forget(id)`. Mutations require readiness. Malformed configuration is rejected before consuming an ID/history slot. A disconnect immediately marks pending commands unknown. Recovery is bound to the original device identity and boot, and never submits the original mutation on a new link. Even a matching boot from a different device cannot recover its receipt.

The first accepted committed/conflict receipt triggers resynchronization. This recovers authoritative config if the change event was lost or a concurrent write won. Wrong-boot, stale-link, and duplicate terminal receipts do not repeatedly trigger snapshots. Repeated `unknown` query responses leave the outcome uncertain. There is no automatic query retry policy yet; callers can explicitly retry read-only recovery if needed.

## Connection manager and adapter boundary

`packages/agent-core/connection.ts` accepts bytes and queues outgoing frames. The Web Serial adapter (`serial.ts`, see `serial-adapter.md`) opens the port and implements this ownership contract: call `open(freshLink, monotonicMs)`, deliver reads using the returned local session generation, call `tick()` regularly, serialize drained writes with backpressure, and call `close()` on read/write failure, EOF, or device removal. After any failed write, discard remaining writes from that generation; never replay them into a reopened port. The manager does not own a physical port, asynchronous I/O, browser permissions, or timers.

Negotiation and synchronization each have a fixed 5,000 ms deadline. The first valid welcome starts the sync deadline; later stale data and repeated failed snapshots do not extend it. Readiness schedules a ping after 2,000 ms. Once sent, only a pong matching the outstanding probe/link satisfies the 5,000 ms response deadline; config traffic cannot conceal a missing pong. Deadline expiry takes precedence over input received at the exact same timestamp. A matched pong with a different boot closes the connection and requires explicit reopen/resync; there is no automatic replay or reconnect loop.

Snapshot/event messages must match both wire link and boot. Local callbacks must match the connection generation. Snapshot results also match the outstanding sync request, and must never move counters backward within a boot. Gaps trigger a fresh sync request while mutations remain blocked. The `sync` request requires the device to establish a subscription before capturing its atomic snapshot; host tests do not prove this on a real device.

The outgoing queue holds at most eight frames; exhaustion closes the connection and clears pending writes. Malformed input is dropped without extending deadlines. `drain()` transfers ownership of queued frames; the adapter must bound its own in-flight work. The manager remembers at most 1,024 link IDs to reject reuse, then requires a new manager with fresh identities. Further resource budgets and clock/counter rollover policy are required before production.

## Terminology

A node is a radio device. A agent/agent is software connected to it. RACE means designing and testing for synchronization and recovery across interrupted connections and concurrent operations; it is not a named framework.

## Connection contract

1. Opening a connection allocates a new local session generation. Every asynchronous callback is tagged with that generation; closing immediately invalidates it.
2. A version handshake chooses a supported protocol version and reports a device identity and boot identity. Protocol version 1 is the initial host-side prototype. Incompatible peers cannot mutate state.
3. Establish an ordered configuration-event subscription before requesting a snapshot. Snapshot acquisition must atomically capture configuration, its revision, and the subscription sequence boundary. Firmware must eventually implement this consistency boundary.
4. Buffer events while the snapshot is outstanding. On receipt, discard buffered events at or below its boundary and apply subsequent contiguous events. An event sequence or revision gap invalidates readiness and requests a fresh snapshot.
5. Bound the buffer (prototype default: 64 configuration events). Overflow invalidates the outstanding snapshot request and starts a new one. The connection manager enforces synchronization and health deadlines.
6. A transport reconnect or detected reboot restarts negotiation and synchronization. A transport adapter must detect boot identity changes and restart the connection lifecycle; the core ignores mismatched-boot frames to avoid stale-frame resets. Periodic health/identity checks are required to discover a quiet reboot.

This prototype has a dedicated configuration stream: each event increments both sequence and configuration revision by one and carries a complete small configuration object. Message, status, and telemetry events must not silently share these counter semantics. A snapshot can represent multiple intervening commits. Each resync request has a unique local token to reject delayed responses.

Configuration is authoritative on the device. The agent copies snapshots/events and exposes mutation context only while ready. Commands carry expected boot identity and configuration revision. The host reference device validates both, but real firmware must implement atomic persistence before returning success. Agent gating alone does not prevent races on the device.

## Configuration commands and recovery

`packages/agent-core/commands.ts` implements the host command lifecycle; `packages/simulator/config-device.ts` is a device reference used only in host tests, not firmware. Inputs are still assumed to be validated objects.

- IDs consist of a caller-supplied agent incarnation (1–64 ASCII letters, digits, underscores, or hyphens) plus a monotonically increasing local counter. The caller must allocate a fresh, collision-resistant incarnation whenever creating a command manager, including after a agent restart. It is not an authentication credential.
- A command contains its ID, expected boot, expected config revision, and a copied immutable config body. Only one config command may be pending per manager. The device must use compare-and-set revision validation to arbitrate different agents.
- A retained receipt binds an ID to its original command body and outcome. Duplicate bodies return the original outcome even after config revision changes; conflicting reuse is rejected. A result acknowledges device acceptance/persistence semantics only; it is never applied as a configuration snapshot.
- Defaults are 32 retained agent entries, a 1,000 ms retry interval, and at most three attempts including the initial submission. A monotonic integer clock is supplied by the caller. `tick()` returns retries for transport dispatch; it must run regularly and immediately after lifecycle changes. No background clock or transport dispatch exists yet.
- Retries reuse the same immutable command, only while its original connection and boot remain ready. A connection change, loss of readiness, or exhausted retry budget sets the outcome to `unknown` and stops retries. Transport write failure must not be interpreted as proof the device received nothing.
- After reconnect and snapshot reconciliation on the same boot, explicit `recover(id)` produces a read-only status query. A query reply is tagged with the new connection generation; old-connection responses remain invalid. Unknown or absent receipts do not authorize replay. On a different boot, recovery cannot establish the original outcome. Keep it unknown even if the current config happens to match.
- A late receipt on the original live connection may resolve an unknown result. Once committed/conflict/rejected is established, duplicates do not change it. If timeout runs just before a receipt, the resulting duplicate is harmless within device receipt retention.
- Agent history is bounded and requires explicit `forget(id)` for non-pending entries. Forgetting an unknown command removes the ability to query it; it does not cancel or undo device work. Never automatically recycle request IDs.

### Bounded receipt reclamation draft

The reference device now retains a FIFO of 32 receipts and eight agent-owner high-water marks by default. Both limits are constructor-configurable in host tests. Each high-water mark is the greatest observed command sequence for that owner in this boot, and is never evicted within the boot. Receipt capacity therefore limits how long an exact result can be recovered, not whether an old request can run again.

On command arrival, check the target boot, then look for a retained receipt. An exact retained request returns its original result; reuse of its ID with a changed body is rejected. If no receipt exists and its sequence is at or below the owner's high-water mark, return unknown and do not execute. Otherwise, admit the owner if capacity permits, advance its high-water mark, perform revision-checked configuration acceptance, and retain the receipt, evicting the oldest receipt if necessary. Queries never execute commands or advance marks.

This contract deliberately requires monotonically increasing submissions within an owner, with one pending command per manager. If requests arrive out of order, an unseen lower sequence may be suppressed as unknown. It must never be interpreted as safe to replay. Agent retries occur only in the original link; reconnect recovery is query-only. Unknown commands can be intentionally abandoned before newer work, but doing so does not prove cancellation or execution.

A full owner table rejects new owners without evicting old marks; existing owners can continue beyond receipt capacity. This is a bounded-resource error, not permission to reset the device automatically. Owner capacity negotiation, agent-restart/session lifecycle, and a user recovery flow for owner exhaustion remain required before release. The contract is a host-tested draft, not a complete production resource policy.

On reboot, config/revision survive in the simulation but receipts and high-water marks do not. A fresh boot identity rejects all old-boot commands, so receipt loss does not make their IDs executable in the new boot. Counter exhaustion must never wrap; create a new incarnation only under the defined owner-capacity policy. Real firmware must serialize high-water/receipt/commit bookkeeping and persist configuration atomically before success; flash atomicity, crash ordering, receipt persistence, power-loss behavior, and authenticated identities remain unimplemented.

## Deferred contracts

Next qualify the built ESP-IDF UART/NVS application on hardware and implement session retirement/owner-exhaustion recovery UX. The portable configuration authority and storage boundary now pass fault-injection tests; see persistence.md. Embedded descriptors/codec now pass host tests; see firmware/README.md. The local web UI now exposes write-blocked diagnostics and query-only recovery; see ../guides/web-portal.md. Strict static checks, CI configuration, and handshake capabilities/resource admission are implemented; remote CI and hardware validation remain pending. Review the serialization and retention drafts before firmware integration. Retry-safe message submission, radio ACK/timeout behavior, and stable message IDs across reboot remain separate work; config-command tests do not establish radio delivery. USB acceptance, radio transmission, destination acceptance, and human reading remain separate states. Do not automatically resend uncertain messages during resync.

`Connection` dispatches only successfully decoded and validated typed negotiation/synchronization messages. Direct callers of `Synchronizer` and `Commands` must still supply validated objects. These components are not wire decoders.

## Embedded compatibility evidence

The C++17 codec uses fixed buffers and caller-owned output, with no heap allocation in codec code. Cross-language tests compare canonical bytes and acceptance/rejection across all eleven message types, optional/unknown/reordered fields, truncated data, corruption, Unicode/ID boundaries, overflow/recovery, and seeded noise. Frozen messages-v1.json fixtures are not regenerated automatically. Local UBSan passes; Linux CI is configured for UBSan/ASan, while macOS ASan remains unverified because startup stalled. These checks establish the host codec contract, not target RAM/stack, NVS crash safety, or real serial/radio behavior.

## Device storage failures

The portable authority publishes committed config only after the backend returns a durable success. Definite no-change errors retain a rejected result. Ambiguous errors retain unknown, block subsequent mutations/snapshots, and require the application to end the logical connection rather than present stale synchronized state. Corrupt/unreadable/unsupported stored records never trigger implicit defaults or formatting. The atomic record, storage status contract, reboot boundary, and remaining NVS qualification are documented in persistence.md.

## Target USB session and storage failure

The UART app serializes authority access. Hello negotiates version/capabilities before admitting an owner; configuration requires a synchronized current link/boot and matching owner prefix. Transport reset preserves the authority and request marks. The additive error message uses bounded ID fields; `storage-unavailable` closes the agent connection with a recovery reason. An uncertain write returns unknown when possible, then this error; snapshots/mutations remain blocked. Existing frozen fixtures are preserved, with an error fixture appended. ROM boot text may precede the app delimiter; bootloader/application logs and secondary console are disabled. UART errors/overflow and a one-second partial-frame timeout reset the logical session and decoder.

## USB reset during port open

USB startup recovery is implemented: repeat the same hello at most once per 500 ms while negotiating, without extending the five-second deadline. Retries do not accumulate behind queued writes; welcome retires any unsent hello. No configuration mutation is replayed. All 131 host tests and the web build pass. The actual TypeScript Connection reached ready on three consecutive physical serial opens in 647/646/650 ms using a Python byte bridge, with persisted revision 2 unchanged. This qualifies the agent protocol startup path; browser permission/stream behavior remains unverified on hardware.

## Message USB extension

Feature bit 3 advertises bounded message submission/query. All previous config safety bits/metadata remain required for mutation admission. Missing extension fields leave old firmware readable/configurable but block uploads. `hex` is 1–32 bytes represented by even-length lowercase hex; `messageState` is receiving/queued/transmitted/acknowledged/failed/rejected/unknown. Configuration and message request IDs occupy separate namespaces. Received is a 32-bit chunk bitmap. Full state, queue lifetimes, deduplication, and reboot semantics are specified in messaging.md. Agent polling is read-only, at most one query per 500 ms, with per-entry two-second spacing and a 70-second overall observation bound. No chunks are replayed on a new link.

## Radio/channel settings extension

Welcome feature bit 4 and optional tags 19 radioSchema / 20 maxChannels gate the radio extension. Configure appends optional fields 8–12; snapshot appends 8–12, and event appends 7–11: radioMode, txPower, relay, channels, preset. All are supplied together for a radio mutation; omission preserves device radio settings. Base config schema remains 1. The independent radio-config schema and record version must not be conflated with the radio packet version. See radio-configuration.md for channels, atomic persistence/migration, and policy-change queue invalidation.

## Inbox and live hardware status extension

Tags 15 radioQuery and 16 radioStatus carry correlated hardware diagnostics; status includes settings revision and bounded resource/counter fields. Tags 17 inboxQuery / 18 inboxHead and 19 inboxRead / 20 inboxItem / 21 inboxMissing form the read-only inbox stream. Welcome appends inboxVersion/inboxCapacity at tags 21/22. Features 5/6 gate diagnostics/inbox respectively. Radio packet version 1 advertises the implemented independent packet/mesh core, not measured RF reliability. See inbox.md for complete correlation, retention, local delivery and no-replay semantics. Existing frozen fixtures are unchanged; the new message kinds have appended fixtures.

## Browser journal (local format 1)

The USB console persists its incarnation, config/message request high-water counters and up to 32 command, outgoing and received entries per history. A synchronous checkpoint precedes mutation dispatch. Restored unfinished outcomes become unknown; sessions, retries and partial uploads are not resumed. Explicit result/status queries still require the same device and boot; a reboot retains ambiguity. Corrupt records/counter regressions fail closed. This local JSON format does not change USB wire v1. Web Locks gives one writer per origin/storage bucket, not cross-browser or device-wide ownership. Local storage is plaintext and clearing it removes recovery history.

## Discovery v1 (Phase 2.1)

Welcome appends discoveryVersion/nodeCapacity and feature bit7. Configure/snapshot/event append beacon/respond/beaconInterval (all-or-none for configure); omitted settings preserve newer device state. The interval is 60–3600 seconds, default300; beaconing and responses defaultoff. Record3 appends one flags byte and a little-endian interval to the record2 layout before CRC; maximum156 bytes. Records1/2 remain readable and default discoveryoff; default discovery policy still writes record1/2. Unsupported older readers must fail closed without erasing.

USB22 discover carries link/boot/owner-prefixed command ID/action (1=start,0=query). USB23 discoveryStatus returns state/replies/control sequence. It has a separate request namespace, eight retained receipts and eight non-evicting owner high-water marks. Duplicate retained starts return the same result; retired IDs return unknown without RF reexecution. No mutation is replayed after reconnect/reload. Collection lasts ten seconds from successful TX completion; queued requests expire after five seconds. No response is proof of neither presence nor absence. Manual requests have a 30-second device cooldown.

USB24 nodeQuery carries link/boot/request/generation/cursor; generation0,cursor0 captures a fixed 32-entry snapshot. USB25 nodeReply returns the snapshot generation/cursor/total/state and optional row node/peerBoot/peerSequence/name/ageMs. Rows use that frozen snapshot even while new RF observations arrive. A replaced snapshot returns changed; agent resnapshots without publishing partial rows. Empty tables have generation0/total0. Node counters are independent of config and inbox. Node IDs are canonical node-016hex; names are labels, not identities. No location fields exist in this slice.

Radio v1 adds kinds3 beacon,4 discovery request,5 presence reply. Phase1 peers reject these kinds while data1/ACK2 bytes and semantics remain unchanged. Control uses Public channel0, one fragment, hop field1 and no relaying. Its payload is control version1, name byte length, UTF-8 label bytes (0–64). Presence appends the requesting boot nonce16 and sequence4; its destination is the requester. Beacon/query destination is broadcast. Origin/boot/sequence in the existing header identify the announcing/responding device. Controls are never chat messages and never generate ordinary destination ACKs. Presence is correlated to the active local collection window and deduplicated per node. Queued replies jitter250–5000ms and expire after nine seconds; each node schedules at most six per rolling minute. All use the existing radio driver/shared airtime budget.

Reply counts saturate at32 (the retained node capacity). The device retains32 observed nodes, replacing the oldest observation when full. Same-boot lower/duplicate control sequences do not update freshness. Four retired boot nonces per retained node suppress delayed prior-boot observations; eviction/longer reboot histories end this bounded suppression, not confer authenticity. Discovery is plaintext/unauthenticated. Settings changes cancel pending control work before further TX; an already transmitted/in-flight packet cannot be recalled. Automatic beacons wait one configured interval plus up to10% jitter and never catch up in bursts after a stall.

## Fixed position v1 (Phase 2.2a)

Welcome appends tag25 locationVersion1 and feature bit8 (256), alongside discoveryVersion1/nodeCapacity32/feature128. This version supports none/fixed only; it does not claim GPS acquisition. Configure/snapshot/event append shareLocation, positionSource, latitude, longitude; all four are required together for a position mutation. Omission preserves the entire device position policy, including on legacy-agent edits. Source0 means none, source1 explicitly saved fixed coordinates. Sharing defaults false and source defaults0. Coordinates are unsigned fixed-point degrees*10^7 offset by +90 degrees latitude and +180 degrees longitude: valid ranges0–1800000000 and0–3600000000. Geographic (0,0) is therefore900000000/1800000000 and is valid. No browser geolocation is requested. Integer storage avoids floating-point wire ambiguity.

Record4 extends record3 before its CRC with share byte0/1, source byte0/1, latitudeLE32, longitudeLE32; maximum166 bytes. Readers accept1–4, never implicitly erase unsupported records. Default position policy writes the earlier applicable format. Saved coordinates can remain even when sharing/source are disabled; a source of none emits no coordinates. Position changes use the same revision-checked durable commit, receipt deduplication and query-only recovery as other configuration. Local journal format1 adds optional copied/validated position data; old journals remain readable.

Name-only controls remain payload v1. Only when sharing=true/source=fixed, beacon/presence payload v2 appends source1 byte, latitudeLE32, longitudeLE32, ageMsLE32 (always0 for fixed position) after the v1 name and optional presence correlation. All other control framing/bounds/dedup rules remain unchanged; max payload99 bytes for a64-byte name/presence. Discovery requests always use v1 and never include coordinates, allowing name-only listeners to reply. Old discovery receivers reject v2 announcements/replies; ordinary text/ACK and v1 name-only controls remain compatible. No dual-announcement burst is emitted. Fixed-location version1 rejects source2/GPS, invalid coordinates, nonzero fixed age and truncated reports.

NodeReply appends positionSource/latitude/longitude/positionAgeMs together for a located row. Rows freeze position with name/boot/sequence at snapshot capture. ageMs remains time since RF observation; positionAgeMs0 describes fixed-position provenance, not proof that a node still occupies that position. A newer accepted name-only report clears that row's previous coordinates; stale/duplicate RF or USB rows cannot overwrite newer data. Disconnect may leave the last observed snapshot visible. Other devices/agents can retain older reports; disabling sharing cannot erase their history.

Committed position/privacy changes cancel pending controls, including controls already selected by the board service, before further TX under the new policy. An already transmitted/in-flight radio signal cannot be recalled; stopping a driver does not erase prior disclosure. No position is emitted merely because coordinates are stored. The separate beacon/respond policies and radio/antenna/airtime gates still apply.

## Agent naming and compatibility

An agent is the software connected to a node. This naming convention changes no wire fields, owner identity rules, persisted request IDs, or synchronization/recovery behavior. Frozen v1 fixtures retain their historical `client-A` owner/ID values and exact bytes: these are opaque valid identities, not required terminology or a migration target.
