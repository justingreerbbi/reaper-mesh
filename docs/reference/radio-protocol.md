# Independent Reaper Mesh radio draft v1

This is a Reaper protocol, not Meshtastic interoperability. Hardware RF remains disabled until antenna/board/profile checks; simulation cannot establish legal operation or RF reliability. Plaintext and CRC provide no privacy, peer authentication, or protection against malicious injection.

## Datagram

SX1262 payload cap is below its 255-byte maximum: 54-byte framing plus at most 160 bytes of body, 214 bytes total. All multibyte integers are unsigned little endian. Unknown versions/types are rejected; changing this layout requires a new radio version.

| Offset | Bytes | Meaning |
| --- | --- | --- |
| 0 | 2 | Magic 52 4d |
| 2 | 1 | Radio protocol 1 |
| 3 | 1 | Kind 1 data / 2 destination ACK |
| 4 | 4 | Logical channel ID (0–7 for this draft) |
| 8 | 8 | Original sender node ID; nonzero, not broadcast |
| 16 | 8 | Original destination ID, or all-ones broadcast |
| 24 | 16 | Original sender boot nonce |
| 40 | 4 | Original sender message sequence; nonzero |
| 44 | 1 | Fragment count (data: 1–7; ACK: 0) |
| 45 | 1 | Fragment index, zero-based (ACK: 0) |
| 46 | 1 | Remaining hop budget, 0–7; relays decrement |
| 47 | 2 | Whole message length, 1–1024 (ACK: 0) |
| 49 | 1 | Fragment length (ACK: 0) |
| 50 | N | Fragment body; nonfinal fragments exactly 160 bytes |
| 50+N | 4 | CRC-32/ISO-HDLC over preceding bytes |

The identity is (original sender, 128-bit boot nonce, sequence). ACK keeps the original sender/destination/nonce/sequence and channel, travels toward the original sender, and has no body. It acknowledges complete destination reassembly/acceptance, not individual fragments, forwarding, USB submission, or a human reading. Broadcast messages never generate destination ACKs.

Validate total length/count/index consistency and exact fragment size before storing data. Payload decoding commits output only after all checks. A maximum message uses seven fragments; parsers reject trailing data, impossible lengths, all-zero boot nonce, invalid node IDs, and unsupported fields. No allocation is driven by untrusted count/length.

## Routing and resource acceptance gates

Use bounded managed flooding with deterministic-testable jitter, duplicate keys including kind/fragment, decreasing hop budget, queue/reassembly expiry, and bounded retransmission. Destination receipt retention must survive fragment retries within its advertised dedup horizon. Queue fullness must not produce a false destination ACK. Explicit airtime scheduling must include original fragments, retries, forwarded traffic, and ACKs. Regional profile selection is separate from logical channels and wire versions.

The fixed-buffer codec and serialized Mesh core are implemented and host-tested. Eight outgoing and eight incoming records, sixteen forwarding slots and sixty-four short-lived duplicate marks bound memory. Local boot/sequence high-water suppression protects outgoing receipt reclamation. Reassembly expires at 20 seconds, outgoing work at 60 seconds, and complete incoming records are retained for 120 seconds. Saturation drops traffic without false ACKs. Relays decrement hops and use bounded 10–100 ms jitter. A 750 ms forwarding duplicate horizon permits later end-to-end retries; origins make at most three fragment rounds separated by four seconds. Broadcast never requests destination ACKs. Transport completion and destination ACK are distinct, including ACK-before-completion and exact-deadline races.

Deterministic simulations execute this actual C++ core and byte codec for line/hidden-link and triangle topologies, loss, duplication, reordering, lost ACK return paths, hop exhaustion, bounded queues, conflicts, and ACK/expiry races. These are not RF evidence. Regional airtime scheduling and board integration are implemented; single-board TX_DONE is checked. Physical multi-node qualification remains pending.

## Fixed-position control payloadv2

Packet header/version1 and Data1/ACK2 bytes remain unchanged. Beacon3 and Presence5 may carry payloadversion2 only when fixed-position sharing is enabled. Keep the v1 name and optional presence parentboot16/sequenceLE32 in their original positions, then append source1 byte, offset latitudeLE32, offset longitudeLE32, fixed ageMsLE32=0. Maximum payload99 bytes fits one datagram. Reject invalid ranges, unsupported sources, nonzero fixed age, malformed lengths and v2 Discover4. Manual requests always stay name-only payloadv1 so older responders can answer. Name-only controls remain v1; v1-only discovery peers reject v2 reports but still handle text/ACK. This is plaintext unauthenticated location, not channel encryption. Privacy/source/coordinate changes cancel queued/selected controls before subsequent TX; prior emitted RF cannot be recalled. Exact fields/bounds are in protocol.md and tests in discovery/mesh-service targets.
