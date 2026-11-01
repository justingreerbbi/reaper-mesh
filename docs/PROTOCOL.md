# Reaper Mesh protocol: synchronization draft

Status: independent Reaper Mesh protocol, confirmed by the owner. This is an initial semantic contract, not a frozen wire format. No Meshtastic interoperability is intended. USB framing, schemas, decoder validation, radio packets, and generated bindings remain to be implemented.

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

Configuration is authoritative on the device. The client copies snapshots/events and exposes mutation context only while ready. The future command path must include expected boot identity and configuration revision, validate both on the device, persist atomically, and return a conflict or a durable result. Client gating alone does not prevent races on the device.

## Deferred contracts

Next specify bounded request IDs and result retention, lost-write-response recovery, retry-safe message submission, ACK/timeout ordering, stable message IDs across reboot, and explicit unknown outcomes. USB acceptance, radio transmission, destination acceptance, and human reading remain separate states. Do not automatically resend uncertain messages during resync.

Before connecting untrusted bytes, implement bounded decoders and validate integers, identities, configuration fields, versions, and frame size. `packages/client-core/sync.ts` currently accepts already validated in-memory objects. It is not yet safe as a direct wire decoder.
