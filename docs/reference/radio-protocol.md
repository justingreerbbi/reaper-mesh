# Independent Reaper Mesh radio draft v1

This is a Reaper protocol, not Meshtastic interoperability. Hardware RF remains disabled until antenna/board/profile checks; simulation cannot establish legal operation or RF reliability. Plaintext and CRC provide no privacy, peer authentication, or protection against malicious injection.

## Datagram

SX1262 payload cap is below its 255-byte maximum: 54-byte framing plus at most 160 bytes of body, 214 bytes total. All multibyte integers are unsigned little endian. Unknown versions/types are rejected; changing this layout requires a new radio version.

| Offset | Bytes | Meaning |
| --- | --- | --- |
| 0 | 2 | Magic 52 4d |
| 2 | 1 | Radio protocol 1 |
| 3 | 1 | Kind 1 data / 2 destination ACK |
| 4 | 4 | Channel ID; any value except `ffffffff`. Public and discovery traffic use 0 ([channel IDs](radio-configuration.md#channel-ids)) |
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

## Radio version 2 (draft)

Status: draft contract for [D50](../contributing/decisions.md#d50-trusted-device-security-model). The codec and its tests exist, but no radio sends or accepts this format yet, and it has had no independent review. It replaces version 1 outright when it ships (D42). All multibyte integers are unsigned little endian.

| Offset | Bytes | Protected by | Meaning |
| --- | --- | --- | --- |
| 0 | 1 | Relay tag | Version `2` in the low four bits; the high four bits are flags and must be zero |
| 1 | 2 | Relay tag | Network hint, which changes every epoch |
| 3 | 2 | Relay tag | Epoch |
| 5 | 1 | Relay tag, except hops | Remaining hops in bits 0–2, hop limit in bits 4–6, other bits zero; hops may not exceed the limit |
| 6 | 8 | Relay tag | Random nonce, unique per frame |
| 14 | 1 | Team key | Kind, as in version 1 |
| 15 | 4 | Team key | Channel ID; any value except `ffffffff` |
| 19 | 8 | Team key | Original sender node ID |
| 27 | 8 | Team key | Original destination ID, or all-ones broadcast |
| 35 | 4 | Team key | Sender boot counter; nonzero |
| 39 | 4 | Team key | Sender sequence; nonzero |
| 43 | 1 | Team key | Fragment count in the high four bits, zero-based index in the low four bits |
| 44 | 2 | Team key | Whole message length |
| 46 | N | Team key | Fragment body, 0–160 bytes |
| 46+N | 8 | Relay tag | Team tag |
| 54+N | 4 | Itself | Relay tag |

The overhead is 58 bytes, so a maximum frame is 218 bytes. N comes from the frame length. Unknown versions, set flag bits, impossible hop values and lengths outside 58–218 bytes are rejected before any cryptography runs.

**Keys.** Each generation starts from two independent random 32-byte seeds, one for the relay chain and one for the team chain, so a relay key reveals nothing about the team key. All derivations use HMAC-SHA-256, keyed with the chain key, over an ASCII label:

| Output | Chain | Label |
| --- | --- | --- |
| Next chain key | Either | `reaper-v2 ratchet` |
| Relay tag key | Relay | `reaper-v2 relay tag` |
| Network hint (first 2 bytes) | Relay | `reaper-v2 hint` |
| Frame key | Team | `reaper-v2 frame` |

Open mode uses published chains at epoch 0: HMAC-SHA-256 keyed with the ASCII string `reaper-v2 open` over `relay` and over `team`. These provide no secrecy.

**Sealing.** The additional data is the 14 clear bytes with the hops bits set to zero. Encrypt bytes 14 to 46+N with AES-256-CCM using the frame key, an 8-byte tag and a 13-byte nonce made of the frame nonce, the epoch and three zero bytes. The relay tag is the first 4 bytes of HMAC-SHA-256, keyed with the relay tag key, over the additional data, the ciphertext and the team tag.

**Receiving.** A radio checks the layout, then the hint and relay tag. A radio holding only the relay key stops there and may forward the frame, decrementing hops. A radio holding the team key then authenticates and decrypts, and validates every field before publishing any of it. A valid relay tag proves only that the sender holds the relay key, so a stolen relay can get junk forwarded but cannot produce a frame that passes the team tag.

Field rules match version 1: nonzero sender that is not broadcast, nonzero destination, consistent fragment fields, ACKs with no body and a unicast destination, and controls on channel 0 in a single fragment. The boot counter replaces the 16-byte boot nonce, so firmware must persist it before transmitting. The frozen vectors are in `packages/protocol/fixtures/frame-v2.json`.
