# Independent Reaper Mesh radio protocol v2

This is a Reaper protocol, not Meshtastic interoperability. A radio transmits only after its antenna, board and regional profile checks pass and a network is chosen; simulation cannot establish legal operation or RF reliability.

Version 2 implements [D50](../contributing/decisions.md#d50-trusted-device-security-model) and replaced version 1 outright (D42). The format has had no independent security review.

## Which keys a radio holds

| Network | Relay key | Team key | What the radio does |
| --- | --- | --- | --- |
| Not chosen | None | None | Sends nothing and accepts nothing. Radio status reason `network-not-chosen`. This is how a radio starts |
| Open | Published | Published | Everything, with no privacy and no protection against injection |
| Team, team key not loaded | In flash | None | Forwards valid frames it cannot read and sends nothing of its own. Reason `team-key-needed` |
| Team, team key loaded | In flash | In memory, from its agent | Everything. A reboot loses the team key |

Sending to or from a radio's own inbox over USB does not depend on any of this. How an agent chooses a network is in [Radio network](protocol.md#radio-network-d50). Keys rotate as described in [Epochs](#epochs).

## Frame

All multibyte integers are unsigned little endian. Unknown versions and kinds are rejected.

| Offset | Bytes | Protected by | Meaning |
| --- | --- | --- | --- |
| 0 | 1 | Relay tag | Version `2` in the low four bits. The high four bits are flags: bit 4 marks a [network frame](#network-frames), and the others must be zero |
| 1 | 2 | Relay tag | Network hint, which changes every epoch |
| 3 | 2 | Relay tag | Epoch |
| 5 | 1 | Relay tag, except hops | Remaining hops in bits 0–2, hop limit in bits 4–6, other bits zero; hops may not exceed the limit |
| 6 | 8 | Relay tag | Random nonce, unique per frame |
| 14 | 1 | Team key | Kind: 1 data, 2 destination ACK, 3 beacon, 4 discovery request, 5 presence reply |
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

The overhead is 58 bytes, so a maximum frame is 218 bytes. N comes from the frame length. Unknown versions, other flag bits, impossible hop values and lengths outside 58–218 bytes are rejected before any cryptography runs. A network frame has its own layout and length.

**Keys.** Each generation starts from two independent random 32-byte seeds, one for the relay chain and one for the team chain, so a relay key reveals nothing about the team key. All derivations use HMAC-SHA-256, keyed with the chain key, over an ASCII label:

| Output | Chain | Label |
| --- | --- | --- |
| Next chain key | Either | `reaper-v2 ratchet` |
| Relay tag key | Relay | `reaper-v2 relay tag` |
| Network hint (first 2 bytes) | Relay | `reaper-v2 hint` |
| Frame key | Team | `reaper-v2 frame` |

Each chain moves forward by its next chain key, and they share one epoch number.

Open mode uses published chains at epoch 0: HMAC-SHA-256 keyed with the ASCII string `reaper-v2 open` over `relay` and over `team`. These provide no secrecy.

**Sealing.** The additional data is the 14 clear bytes with the hops bits set to zero. Encrypt bytes 14 to 46+N with AES-256-CCM using the frame key, an 8-byte tag and a 13-byte nonce made of the frame nonce, the epoch and three zero bytes. The relay tag is the first 4 bytes of HMAC-SHA-256, keyed with the relay tag key, over the additional data, the ciphertext and the team tag.

**Receiving.** A radio checks the layout, then the hint and relay tag. A radio holding only the relay key stops there and may forward the frame, decrementing hops. A radio holding the team key then authenticates and decrypts, and validates every field before publishing any of it. A valid relay tag proves only that the sender holds the relay key, so a stolen relay can get junk forwarded but cannot produce a frame that passes the team tag.

Field rules: a nonzero sender that is not broadcast, a nonzero destination, a nonzero boot counter and sequence, consistent fragment fields, ACKs with no body and a unicast destination, and controls on channel 0 in a single fragment. Parsers reject trailing data and impossible lengths, and no allocation is driven by untrusted values.

## Epochs

Keys rotate automatically (D52), with no change to any frame. Agents decide when, because a board has no clock. The design and the reasons for it are in [Rotation and rekey design](../contributing/rotation-design.md).

**Epoch proofs.** A generation has a chain of 4,096 proofs, 32 bytes each, from a random seed that only agents hold. The last epoch's proof is the seed, and the proof for epoch `e - 1` is HMAC-SHA-256, keyed with the proof for epoch `e`, over `reaper-v2 epoch proof`. So a later proof gives every earlier one and never a later one, and a relay key cannot produce one. A proof is public once released.

**What a radio holds.** In flash: the relay chain at its **floor**, the newest **proven** epoch, and that epoch's proof. A member also holds the team chain in memory at its **sending epoch**, and the previous epoch's frame key.

**Rules.**

- **Forwarding.** A frame at epoch `E` passes when `floor ≤ E ≤ floor + 1024` and its hint and relay tag are valid for `E`. Passing changes nothing stored, so forwarding never depends on hearing a proof.
- **Erasing.** Only a proof moves the floor. A proof for `E` must be for a newer epoch, within 1,024 of the proven one, and hash forward to the proof held. The floor becomes `E - 1`, so the previous epoch still works, and the earlier chain is gone from flash in that write. A radio forwards a proof only when it was new, so each radio sends each proof at most once.
- **Members.** A valid team tag from a newer epoch moves the sending epoch up. So does a proof. A member reads its sending epoch and the one before, and rejects older frames.
- **Cost.** Reaching an epoch that isn't cached means hashing forward. A radio caches four epochs. Up to 4 hashes are free, and more draw on a budget of 1,024 that refills at 64 a second, with the frame dropped when it runs out. This bounds the work that frames with no valid tag can cause. Measured on `v0.10.0`, a full walk takes about 260 ms on the Heltec and 560 ms on the T-Beam, and holds up the main loop for that long.
- **Traffic.** An epoch change is not a key change. Queued messages and the radio carry on across it.
- **Open mode** stays at epoch 0, and rejects network frames.

A radio more than 1,024 epochs behind can no longer verify the team and needs filling again.

## Network frames

A network frame is one a radio with only the relay key can read. Byte 0 is `0x12`, and the first 14 bytes otherwise mean what they do above. The only type so far is an epoch proof, at exactly 51 bytes:

| Offset | Bytes | Protected by | Meaning |
| --- | --- | --- | --- |
| 14 | 1 | Relay tag | Type: 1, epoch proof |
| 15 | 32 | Relay tag | The proof for the frame's epoch |
| 47 | 4 | Itself | Relay tag, computed as for team frames over everything before it, with the hops bits zero |

Any other type or length is rejected. A radio announces a proof when its agent asks. Its hops and hop limit are the radio's normal ones.

The frozen vectors, including the proof chain and proof frames, are in `packages/protocol/fixtures/frame-v2.json`.

## Message payloads

Firmware carries a message of 1–1,024 bytes without understanding it, relays it and acknowledges it (D41, D50). It no longer checks for text or a known envelope, so new message formats need no firmware change. Agents decide what the bytes mean. The content types themselves are for the core v1 review (Q5).

## Identity and boot counter

The identity is (original sender, boot counter, sequence). The boot counter is saved to flash before the radio can transmit, and a board that cannot save it sends nothing and reports `frame-keys-unavailable`. It replaces version 1's 16-byte random boot nonce. A board with no saved counter starts from a random value, so erasing storage does not repeat old message IDs, which a recipient could discard as duplicates. Sender and receiver build a message's ID from this counter and the sequence. USB shows it zero-padded to the same 32 hex digits as before, so agents see no change.

Frame nonces are the first 8 bytes of HMAC-SHA-256 over a counter, keyed with a 32-byte seed read from the true entropy source at each boot.

ACK keeps the original sender/destination/boot/sequence and channel, travels toward the original sender, and has no body. It acknowledges complete destination reassembly/acceptance, not individual fragments, forwarding, USB submission, or a human reading. Broadcast messages never generate destination ACKs.

## Routing and resource acceptance gates

Use bounded managed flooding with deterministic-testable jitter, duplicate suppression, decreasing hop budget, queue/reassembly expiry, and bounded retransmission. Destination receipt retention must survive fragment retries within its advertised dedup horizon. Queue fullness must not produce a false destination ACK. Explicit airtime scheduling must include original fragments, retries, forwarded traffic, and ACKs. Regional profile selection is separate from logical channels and wire versions.

A relay forwards the frame's exact bytes apart from the hop count, so it needs no team key. Duplicate suppression uses the frame nonce, and forwarding jitter comes from the nonce and node ID. A team radio relays any valid frame of its team, including channels it has not joined, and delivers only channels in its table. A team radio does not forward a frame that fails the team tag.

The fixed-buffer codec and serialized Mesh core are implemented and host-tested. Eight outgoing and eight incoming records, sixteen forwarding slots and sixty-four short-lived duplicate marks bound memory. Local boot/sequence high-water suppression protects outgoing receipt reclamation. Reassembly expires at 20 seconds, outgoing work at 60 seconds, and complete incoming records are retained for 120 seconds. Saturation drops traffic without false ACKs. Relays decrement hops and use bounded 10–100 ms jitter. A 750 ms forwarding duplicate horizon permits later end-to-end retries; origins make at most three fragment rounds separated by four seconds, each with a new nonce. Within a round, an origin waits after each fragment so relays can forward it before the next one arrives, since a radio cannot listen while it sends: 2T + 150 ms with a hop limit of 1 and 3T + 250 ms with a hop limit of 2 or more, where T is the fragment's airtime (about 86 ms for a full fragment on US915_LAB1). Hop limit 0 waits nothing. A 1,024-byte message's round takes about 4 seconds. Transport completion and destination ACK are distinct, including ACK-before-completion and exact-deadline races.

Deterministic simulations execute this actual C++ core and byte codec for line/hidden-link and triangle topologies, half-duplex radios with real airtime and collisions, relay-only radios, outsider and relay-key-forgery frames, loss, duplication, reordering, lost ACK return paths, hop exhaustion, bounded queues, conflicts, and ACK/expiry races. These are not RF evidence. Physical multi-node qualification remains pending.

## Control frames

Beacon (3), discovery request (4) and presence reply (5) use channel 0 and one fragment. Their hops and hop limit are both zero, so nothing relays them, and their name and position are under the team key. A radio sends beacons and replies only while an agent is attached: a trusted Bluetooth connection is up, or USB traffic arrived within the last 8 seconds. After an agent attaches, the first beacon waits one configured interval.

The payload is control version 1, name byte length and UTF-8 label bytes (0–64). A presence reply appends the requester's boot counter and sequence, 4 bytes each. Version 2 is used for beacons and presence replies only when fixed-position sharing is enabled, and appends source (1 byte), offset latitude, offset longitude and fixed age (always 0), 4 bytes each, for a maximum payload of 87 bytes. Reject invalid ranges, unsupported sources, nonzero fixed age, malformed lengths and version 2 requests. Manual requests always stay version 1.

In Open mode, location in these frames is readable by anyone and unauthenticated. Privacy/source/coordinate changes cancel queued/selected controls before subsequent TX; prior emitted RF cannot be recalled. Exact fields/bounds are in protocol.md and tests in discovery/mesh-service targets.
