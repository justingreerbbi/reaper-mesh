# Reaper Mesh protocol: synchronization draft

Status: independent Reaper Mesh protocol, confirmed by the owner. This is a draft semantic contract and USB envelope, not a frozen release protocol. No Meshtastic interoperability is intended. USB envelope framing is implemented on host; typed payload schemas, semantic validation, radio packets, and generated bindings remain to be implemented.

## USB envelope draft v1

`packages/protocol/framing.ts` encodes and incrementally decodes binary envelopes. Decode the complete COBS frame (excluding its zero delimiter), then validate this raw layout:

| Offset | Length | Meaning |
| --- | --- | --- |
| 0 | 2 | Magic bytes `52 4d` (`RM`) |
| 2 | 1 | Envelope version `01`, independent of application protocol negotiation |
| 3 | 1 | Reserved flags, must currently be zero |
| 4 | 2 | Payload length, unsigned little endian, 1–2,048 bytes |
| 6 | Payload length | Opaque bytes; application encoding/schema still pending |
| 6 + payload length | 4 | CRC-32/ISO-HDLC, little endian, over header and payload |

CRC parameters: reflected polynomial `0xedb88320`, initial value `0xffffffff`, final xor `0xffffffff`; standard ASCII `123456789` check is `0xcbf43926`. CRC detects accidental corruption; it does not authenticate a frame.

COBS-encode the whole raw envelope and append `00`. Maximum raw size is 2,058 bytes; maximum encoded size is 2,067 bytes, excluding the delimiter. The incremental decoder retains one fixed 2,067-byte buffer. Empty delimiters are ignored. Invalid frames are dropped. Oversize input is counted once and discarded until the next delimiter. A lost delimiter can sacrifice two joined frames; parsing resumes after the next boundary. A truncated frame that is never delimited requires a lifecycle timeout/reset, still pending.

Reset the decoder on every connection generation change. Prefix a newly opened stream with an empty delimiter to flush incomplete framing at the peer. Keep boot/debug logs off this binary stream. Validated payload callbacks run synchronously, one frame at a time; the caller must bound downstream queues and apply backpressure. Callback exceptions propagate to the caller, which must close/reset the transport rather than replaying the partially consumed chunk. Diagnostic counts are per `feed()` call, without an unbounded internal log.

`packages/protocol/fixtures/envelope-v1.json` is a shared golden envelope for future embedded implementations; its CRC was independently checked with Python's zlib. Host tests cover COBS/checksum vectors, all split boundaries for a sample frame, bytewise maximum-size input, concatenated frames, every single-bit corruption of a sample frame, unsupported headers, inconsistent lengths, overflow, reset, and seeded noise/chunk schedules. These establish framing behavior only. Do not route opaque payloads directly to `Synchronizer` or `Commands`.

## Terminology

A node is a radio device. A client/agent is software connected to it. RACE means designing and testing for synchronization and recovery across interrupted connections and concurrent operations; it is not a named framework.

## Connection contract

1. Opening a connection allocates a new local session generation. Every asynchronous callback is tagged with that generation; closing immediately invalidates it.
2. A version handshake chooses a supported protocol version and reports a device identity and boot identity. Protocol version 1 is the initial host-side prototype. Incompatible peers cannot mutate state.
3. Establish an ordered configuration-event subscription before requesting a snapshot. Snapshot acquisition must atomically capture configuration, its revision, and the subscription sequence boundary. Firmware must eventually implement this consistency boundary.
4. Buffer events while the snapshot is outstanding. On receipt, discard buffered events at or below its boundary and apply subsequent contiguous events. An event sequence or revision gap invalidates readiness and requests a fresh snapshot.
5. Bound the buffer (prototype default: 64 configuration events). Overflow invalidates the outstanding snapshot request and starts a new one. A stalled peer must eventually cause a transport timeout/disconnect; timeout policy is not implemented yet.
6. A transport reconnect or detected reboot restarts negotiation and synchronization. A transport adapter must detect boot identity changes and restart the connection lifecycle; the core ignores mismatched-boot frames to avoid stale-frame resets. Periodic health/identity checks are required to discover a quiet reboot.

This prototype has a dedicated configuration stream: each event increments both sequence and configuration revision by one and carries a complete small configuration object. Message, status, and telemetry events must not silently share these counter semantics. A snapshot can represent multiple intervening commits. Each resync request has a unique local token to reject delayed responses.

Configuration is authoritative on the device. The client copies snapshots/events and exposes mutation context only while ready. Commands carry expected boot identity and configuration revision. The host reference device validates both, but real firmware must implement atomic persistence before returning success. Client gating alone does not prevent races on the device.

## Configuration commands and recovery

`packages/client-core/commands.ts` implements the host command lifecycle; `tests/simulator/config-device.ts` is a device reference used only in host tests, not firmware. Inputs are still assumed to be validated objects.

- IDs consist of a caller-supplied client incarnation (1–64 ASCII letters, digits, underscores, or hyphens) plus a monotonically increasing local counter. The caller must allocate a fresh, collision-resistant incarnation whenever creating a command manager, including after a client restart. It is not an authentication credential.
- A command contains its ID, expected boot, expected config revision, and a copied immutable config body. Only one config command may be pending per manager. The device must use compare-and-set revision validation to arbitrate different clients.
- A retained receipt binds an ID to its original command body and outcome. Duplicate bodies return the original outcome even after config revision changes; conflicting reuse is rejected. A result acknowledges device acceptance/persistence semantics only; it is never applied as a configuration snapshot.
- Defaults are 32 retained client entries, a 1,000 ms retry interval, and at most three attempts including the initial submission. A monotonic integer clock is supplied by the caller. `tick()` returns retries for transport dispatch; it must run regularly and immediately after lifecycle changes. No background clock or transport dispatch exists yet.
- Retries reuse the same immutable command, only while its original connection and boot remain ready. A connection change, loss of readiness, or exhausted retry budget sets the outcome to `unknown` and stops retries. Transport write failure must not be interpreted as proof the device received nothing.
- After reconnect and snapshot reconciliation on the same boot, explicit `recover(id)` produces a read-only status query. A query reply is tagged with the new connection generation; old-connection responses remain invalid. Unknown or absent receipts do not authorize replay. On a different boot, recovery cannot establish the original outcome. Keep it unknown even if the current config happens to match.
- A late receipt on the original live connection may resolve an unknown result. Once committed/conflict/rejected is established, duplicates do not change it. If timeout runs just before a receipt, the resulting duplicate is harmless within device receipt retention.
- Client history is bounded and requires explicit `forget(id)` for non-pending entries. Forgetting an unknown command removes the ability to query it; it does not cancel or undo device work. Never automatically recycle request IDs.

The reference device has a deliberately conservative bounded store: it retains all receipts for its boot and rejects new IDs when full, without eviction. Querying a missing ID returns unknown. On reboot, config/revision survive in the simulation but receipts do not; commands targeting the previous boot are rejected. This proves bounded deduplication behavior, not a production retention policy. Before firmware/client integration, define a negotiated retention window and safe reclamation/session rollover so normal use never requires rebooting to clear a receipt store. Real flash atomicity, receipt persistence, power-loss behavior, and authenticated identities remain unimplemented.

## Deferred contracts

Next implement typed USB payload schemas and validation, lifecycle/health deadlines, and a production receipt-retention/reclamation contract. Retry-safe message submission, radio ACK/timeout behavior, and stable message IDs across reboot remain separate work; config-command tests do not establish radio delivery. USB acceptance, radio transmission, destination acceptance, and human reading remain separate states. Do not automatically resend uncertain messages during resync.

Before dispatching untrusted payloads, implement bounded typed decoding and validate integers, identities, configuration fields, and protocol versions. Envelope size/version/CRC checks are implemented, but `packages/client-core/sync.ts` still accepts already validated in-memory objects. It is not safe as a direct wire decoder.
