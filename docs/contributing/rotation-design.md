# Rotation and rekey design (D50 step 2)

Status: **Draft, awaiting owner decisions** ([Q13](decisions.md#open-questions)). Nothing here is
built. Until it ships, the [radio protocol](../reference/radio-protocol.md) and the
[USB protocol](../reference/protocol.md#radio-network-d50) describe how radios behave. This design
has had no independent security review. Sizes and airtime are calculated, and nothing has been
measured.

This fills in step 2 of the [security architecture](security-architecture.md#delivery-order): the
relay key ratchet, rekeying and relay status. It builds on the
[key layers](security-architecture.md#the-core-decision) and
[rotation model](security-architecture.md#rotation-two-separate-mechanisms) there, and changes them
only where [listed below](#changes-to-the-security-architecture).

## Summary

| Problem | Proposal |
| --- | --- |
| Under D50's "highest authenticated epoch wins", a stolen relay key can walk relays forward until they can no longer hear the team | Relays forward any valid frame in a window, but erase old keys only when they hear an **epoch proof**, which a relay key cannot produce |
| Relays cannot read a rekey or a status request, because a frame's kind is encrypted under the team key | Add a **network frame**, marked by a flag bit in the existing header, which relays can read |
| A radio's device key exists only in the browser that filled it (D51), so no one agent can reach every radio | Until step 4, an agent rekeys the radios it filled and the portal says plainly which others need the new team code by hand |
| The frame's epoch is shared by the relay and team chains, so the relay ratchet cannot ship alone | The team chain ratchets in the same work, which needs firmware |

Firmware stays small: it gains one hash check, one new frame layout, a small key cache and two USB
commands. It still has no clock and does no public-key cryptography, and agents build every network
frame.

## The stranded relay problem

A relay can check only the relay tag. The relay chain is a forward ratchet, so anyone holding today's
relay key can compute every future one and produce frames that pass that check. This is what the
present rule does with such a thief:

1. The thief sends a frame tagged for an epoch far ahead, inside the look-ahead bound.
2. Relays in range follow it and erase older keys. Repeating this walks them any distance.
3. Team radios refuse to follow, because the frame fails the team tag.
4. Relays now reject every honest frame as too old, and they cannot go back. The mesh has silently
   split, until the team rekeys or visits each relay.

The security architecture counts this thief's cost as injected junk that relays forward. With the
ratchet, it becomes a one-frame way to take the relays away from the team.

The options:

| Option | Result with a stolen relay key | Cost |
| --- | --- | --- |
| Follow the highest valid tag (D50 as written) | Relays stranded until rekey or a visit | None |
| Members chase the relays upward | No split, but with a look-ahead of 1,024 the 16-bit epoch runs out after 64 frames, about 2 seconds of airtime. Every radio stops until a rekey | None |
| Never erase on unattended relays | No split, but anyone with no keys at all can replay old frames through relays indefinitely | None |
| **Epoch proof (proposed)** | Forwarded junk only, which is the limit D50 already accepts | 32 bytes of flash, one 51-byte frame per epoch |

**Keeping a relay chain longer costs little.** A relay key reveals no traffic, so what erasing it
buys is an end to replays and a change of network hint. A relay whose floor lags can therefore be
tolerated, as long as it never stops forwarding honest traffic. That is what makes this design safe
when a proof is missed.

## Epochs

### The epoch proof

When a generation is created, an agent picks a random 32-byte seed and builds a one-way chain, the
same idea as S/KEY one-time passwords. The last value is released first:

```text
P(start + 4095) = seed
P(e - 1)        = HMAC-SHA-256(key = P(e), "reaper-v2 epoch proof")
```

Radios receive `P(start)` at fill. Revealing `P(e)` proves that someone holding the seed has started
epoch `e`. Agents hold the seed and radios never do, so a stolen radio holds no proof it has not
already heard. Replaying an old proof does nothing, because it can only move a radio to an epoch that
has already begun. This reuses the existing HMAC primitive.

Team radios and relays verify a proof by hashing it forward until it reaches the proof they hold.

### What each radio keeps

| Item | Where | Meaning |
| --- | --- | --- |
| Proven epoch and its proof | Flash | The newest epoch this radio has seen proven |
| Floor, and the relay chain at the floor | Flash | One epoch below the proven epoch, or the generation's start, so the previous epoch still works |
| Team chain, its epoch and the previous frame key | Memory, member radios only | What this radio sends and reads with |
| Derived relay keys for up to four epochs | Memory | The floor and proven epoch stay pinned, and two slots hold recently valid epochs |

### Rules

1. **Forwarding.** A frame at epoch `E` passes if `floor ≤ E ≤ floor + 1024` and its hint and relay
   tag are valid for `E`. Passing changes no stored state, so forwarding never depends on hearing a
   proof.
2. **Erasing.** Only a verified proof moves the floor. The new record goes to flash through the
   existing two-sector write, and older chains are gone from then on.
3. **Member radios.** A valid team tag at a newer epoch moves the sending epoch up, as D50 says, and
   the older frame key is wiped. A relay key alone cannot do this. A stolen team key could, but the
   agent can reload the right epoch, and that loss needs a rekey anyway.
4. **Look-ahead cost.** Reaching an uncached epoch means hashing forward from the floor. A token
   bucket allows one such derivation every few seconds, and the frame is dropped when it is empty.
   An honest sender that loses a frame this way recovers through its normal retries. The bound and
   the bucket are set after measuring both chips, and a long walk may have to be split across
   service passes so it does not delay the radio.
5. **Out of reach.** A radio that was off for more than 1,024 epochs can no longer verify the team
   and needs an in-person fill. The portal must show this as locked out.

### Advancing

Agents decide when, and firmware never does.

1. An agent checks its schedule. If at least one interval has passed since the last advance it made
   or heard, it ratchets its copies of both chains.
2. It sends `teamLoad` for the new epoch, then a proof frame through `networkSend`. The radio handles
   its own proof exactly as if it had heard it.
3. The agent keeps the previous chains for one interval, then erases them.
4. Other radios hear the proof, verify it, forward it and report the new epoch. Their agents derive
   forward and erase their older chains.

Every agent computes the same chain, so two agents advancing together cannot fork the team. A wrong
clock can cause at most one early advance per portal session, because an agent moves one step at a
time on its own schedule. Agents warn if the network runs more than two intervals ahead of their
schedule, since that suggests a misbehaving member or a stolen team key.

With no agents online, nothing advances. That is harmless to delivery, but it means the key's age
rises while a team is idle, and the portal should say how old the current key is.

### Size limits

| Interval | 4,096-epoch proof chain lasts | A relay can be off for up to 1,024 epochs |
| --- | --- | --- |
| 24 hours (default) | 11.2 years | 2.8 years |
| 6 hours | 2.8 years | 8.4 months |
| 1 hour | 5.6 months | 6 weeks |

The chain running out needs a rekey. The portal warns well before that.

## Network frames

Today, a relay cannot tell what a frame is, and D50 wants to keep that for team traffic. Rekey and
status have to reach a radio with no team key, so they need their own layout.

Bit 4 of byte 0 marks a **network frame**, so the byte reads `0x12`. That bit is reserved today and
must be zero, and the first 14 bytes keep their meaning. The bytes after them are:

| Offset | Bytes | Meaning |
| --- | --- | --- |
| 14 | 1 | Type: 1 epoch proof, 2 to a radio, 3 from a radio |
| 15 | N | Body |
| 15+N | 4 | Relay tag, computed as for team frames |

| Type | Body | Total | Airtime at `US915_LAB1` |
| --- | --- | --- | --- |
| Epoch proof | The 32-byte proof for the frame's epoch | 51 bytes | About 26 ms |
| Rekey, to a radio | Selector and sealed wrap: generation, start epoch, relay chain and starting proof | 100 bytes | About 44 ms |
| Status request, to a radio | Selector and sealed challenge | About 36 bytes | About 20 ms |
| Status or confirmation, from a radio | Selector and sealed status | About 60 bytes | About 28 ms |

**Addressing.** A selector is the first 4 bytes of HMAC-SHA-256 keyed with the device key, over a
label and the frame's epoch. It changes each epoch, so outsiders cannot follow one radio across
epochs. A radio checks its own selector, and one wrong match just fails decryption. A radio that
matches consumes the frame, and every other radio forwards it under the normal hop rules.

**Sealing.** Bodies use AES-256-CCM with an 8-byte tag and the same nonce layout as team frames. Keys
come from the device key, with separate labels for each direction, so the two directions never share
a key and nonce. The issuer's radio needs no other radio's key, because the agent seals each frame
and even computes the relay tag.

**Replay.** A rekey is safe to replay: a generation at or below the active one is ignored, and an
identical pending one changes nothing and spends no flash. A status request carries a challenge that
the reply repeats, and replies are limited to one every 30 seconds, so replaying one costs little
airtime.

**What an observer learns.** The flag is visible, so anyone can see that network frames exist, and
roughly when epochs advance and a rekey runs. No identities, keys or team traffic are exposed.

## Rekey

This replaces the relay chain and the proof chain, for a lost radio or a chain near its end.

| Stage | What happens | What the portal shows |
| --- | --- | --- |
| Distribute | The agent creates generation G+1 with a new relay chain and proof seed. It sends one wrap per radio, paced about every 5 seconds. The radio stores it as pending and keeps using the old keys | Queued, then sent, per radio |
| Confirm | Each radio replies with its pending generation and fingerprint. A lost reply is settled by asking again or resending the same wrap | Confirmed or unknown. Radios that would be stranded are named before the operator can continue |
| Switch | The operator approves. The agent sends a proof frame under the new generation, which only a holder of the new chain can tag | Switching |
| Retire | A radio holding that pending generation promotes it on hearing any valid frame under it, and erases the old chain in the same flash write | Done, or locked out |

- **One wrap per frame.** The architecture estimated 17 wraps in one maximum-size message. Relays do
  not reassemble messages, and losing one fragment would lose everyone's wrap, so a wrap is one
  frame with no fragments.
- **No retry after the switch.** Promoted radios reject the old generation, so a radio that missed
  the wrap can no longer be reached over the air and needs an in-person fill. That is why Confirm
  comes first and the operator approves the switch.
- **Authentication.** A relay wrap is authenticated by the device key, since firmware verifies no
  signatures. Signatures apply to the team and channel keys that agents handle from step 4.
- **Airtime.** Sixteen radios take about 80 seconds at that pace. Each radio spends about 44 ms
  forwarding each wrap and about 28 ms on each reply, which a 1% budget with its one-second burst can
  carry. These are calculations. Collisions during a flood are unknown until a third board exists.
- **Competing rekeys.** A higher generation replaces a lower pending one. Deputies arrive in step 4
  and use the same rule.

### What a rekey does not do

**It locks out a radio, not a person.** A removed radio can no longer get frames relayed or tagged.
Whoever holds the team key can still read team headers from what they receive directly, and
replacing that key needs the identity keys in step 4. The portal must call this action **Replace
relay key**, and D51 still applies to people: removing someone means creating a new team until
step 4 ships.

### Who can rekey before step 4

A device key is created by the browser that fills a radio, and it is not in the team code, so a
browser can reach only the radios it filled. There is also no way yet to send the new relay chain to
another person's agent.

Until step 4:

- An agent wraps the radios it filled, and lists the team's other radios as **Not reachable from this
  browser** if it has any record of them.
- A new team code carries the new generation to other members. They scan it, then fill their own
  radios over USB or in a button window, and the design treats those radios as locked out until then.
- A team that wants one person to manage everything has that person fill every radio, which already
  matches the D50 authority model.

## Relay status

The issuer sends a status request to one radio, and it replies with its generation, floor, proven
epoch, pending generation and fingerprint, boot counter and uptime. Nothing else is sent, and a relay
never reports on its own. The issuer's radio cannot decrypt replies, so it holds up to eight
unconsumed "from a radio" frames for its agent, for 60 seconds after that agent last used
`networkSend`. No other radio stores them.

## Changes to contracts

These need owner approval under D42. Both boards need a reflash and a new fill.

| Contract | Change |
| --- | --- |
| Radio frames | Bit 4 of byte 0 allows the network frame layout. Team frames are unchanged |
| Radio behavior | Frames outside the radio's own epoch are accepted within the window, which removes the "keys do not rotate yet" rule |
| `networkFill` | Adds the 32-byte starting proof |
| `networkStatus` | Adds the proven epoch, and the pending generation and fingerprint. `epoch` becomes the sending epoch on a member radio and the floor on a relay |
| `teamLoad` | Accepts any epoch at or above the floor. A lower one gets `mismatch`, and the agent derives forward and tries again. It stops comparing generations, because relay and team generations separate here, and agents compare fingerprints instead |
| `networkSend` (new) | Carries one finished network frame from an admitted session. The radio checks its layout and relay tag, handles it as if received, and transmits it under the airtime budget. It needs no physical access, because automatic rotation has to work over Bluetooth, and it is useless without keys the session must already have |
| `networkFrames` (new) | Reads the frames held for this agent, one per call |
| Key storage | Record version 2, about 182 bytes, adding the proven epoch, its proof and the pending generation. It still fits the 4 KiB sectors, at about one erase per sector per epoch |
| Team code | `RMTEAM2` adds the proof seed, generation start and interval. Codes carry the chains at the current epoch, so a joiner cannot read older recordings, and a code scanned later just derives forward |
| Shared code | Chain, proof and frame sealing move to `packages/agent-core` with frozen vectors, so the mobile app stays compatible (D48) |

Fixtures change deliberately, with new frame and fill vectors, never silently. Open mode is unchanged:
it stays at epoch 0 and rejects network frames.

## The portal

The owner tests through the portal, so a feature that only works through a tool does not count as
delivered. This work needs an exception to the pause on portal features, as D49 and D51 had. All of
it goes on the existing Radio network page:

- Key age, the next automatic rotation, and a **Rotate now** button.
- A warning when the network runs ahead of this browser's schedule, or the proof chain is near its end.
- **Check relays**, showing each radio this browser filled, with honest states: confirmed, no reply
  or locked out. A missing reply never means a relay is gone.
- **Replace relay key**, following the table above, naming every radio that would be stranded and
  every radio this browser cannot reach.

## Delivery

Each slice works by itself, and core v1 waits for both.

| Slice | Work | Done when |
| --- | --- | --- |
| 2a Epochs | Flag bit and proof frame, epoch window, key cache, team chain ratchet, `networkSend`, record version 2, `RMTEAM2`, portal rotation and key age | Two boards rotate through the portal. A board that was off catches up alone. Separated boards converge. A board holding only the relay key cannot move another board's floor |
| 2b Rekey and status | Addressed frames, pending keys and promotion, `networkFrames`, portal **Check relays** and **Replace relay key** | A board left out of a rekey is locked out and the portal says so beforehand. A power cut during promotion leaves one usable key. Status works in both directions |

### Tests to add

Host tests use the existing deterministic fault approach.

- **Thief with a relay key.** Far-future frames, repeated walks, and junk proofs never move a floor,
  never strand honest traffic and spend only the bounded derivation budget.
- **Outsider.** Forged, replayed and tampered proofs and network frames do nothing.
- **Epoch boundaries.** Traffic across an advance, with lost, duplicated, delayed and reordered
  proofs, plus two agents advancing at once.
- **Lost proofs.** A relay that misses every proof keeps forwarding up to the bound, then reports
  locked out.
- **Power cuts.** At every step of a floor change and a promotion. Old keys are gone afterward.
- **Rekey.** Lost wraps and replies, repeated wraps, an abandoned generation, a higher generation
  arriving late, and a replay after promotion.
- **Reboots.** A member radio rebooting across an advance, then reloaded by its agent.
- **Vectors.** Frozen proof chain, selector and network frame vectors, shared with the mobile app.

### What hardware can show

| Check | Boards needed |
| --- | --- |
| Rotation, catch-up, convergence, relay-key thief, lockout, power cut during a key write, derivation time on both chips | Two |
| Forwarding across an epoch change, a rekey through a relay, airtime and collisions during a flood | Three |

## Changes to the security architecture

If this is approved, these parts of the [security architecture](security-architecture.md) change:

| Section | Change |
| --- | --- |
| [Ratchet](security-architecture.md#ratchet), rule 2 | Radios with only the relay key forward the highest epochs but erase on a proof. Member radios still follow a valid team tag |
| [Ratchet](security-architecture.md#ratchet), rule 4 | The floor keeps the previous epoch, and a relay may hold an older one until it hears a proof |
| [Rekey](security-architecture.md#rekey), cost table | One 100-byte frame per radio, in place of about 58 bytes each inside one message |
| [Rekey](security-architecture.md#rekey), Retire and signatures | No retry over the air after the switch, and relay wraps rely on the device key alone |
| [What this cannot do](security-architecture.md#what-this-cannot-do) | Adds that the team has no key rotation while no agent is online |

## Decisions needed

| # | Decision | Recommendation |
| --- | --- | --- |
| 1 | Use epoch proofs in place of "highest authenticated epoch wins" for relays | Yes. Without them, one stolen relay can take the relays away from the team |
| 2 | Accept that, before step 4, a rekey reaches only the radios this browser filled, and call the action **Replace relay key** | Yes. The alternative is moving identity keys ahead of this work |
| 3 | When to build | Build 2a before the three-node relay test, so that test covers epoch changes and needn't be repeated. Build 2b after it, as the roadmap has it. This changes the roadmap's order |
| 4 | Allow a portal exception for this work, as with D49 and D51 | Yes, since it can't otherwise be used or tested |
| 5 | Limit the interval to between 6 hours and 7 days | Yes. Shorter intervals shrink how long a relay can stay off, and a 1-hour interval would lock out a relay after 6 weeks |
