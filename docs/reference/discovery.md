# Discovery and position

How nodes find each other and share where they are. The exact payload and storage layouts are
in [Protocol](protocol.md#discovery-v1-phase-21) and
[Persistence](persistence.md#fixed-position-record4).

## Three separate operations

| Operation | Who sends it | What happens |
| --- | --- | --- |
| **Beacon** | A node, on a timer | Announces the sender's name and node ID |
| **Discovery request** | A node, when a user asks "who is listening?" | Asks nearby nodes that allow it to reply |
| **Presence reply** | Each node that allows replies | Answers the request. A reply never asks for another reply or an acknowledgment |

Three settings control these independently, and **all default off**: automatic beacons,
replying to discovery, and sharing location. A manual discovery request works even with beacons
off. Every node reports its own configured name and stable node ID; an empty name falls back to
the node ID.

## Bounds

| Rule | Value |
| --- | --- |
| Beacon interval | 300 s by default when on; 60–3,600 s, with up to 10% jitter. No catch-up burst after a reboot or stall |
| Manual discovery | One active request, a 10-second collection window, a 30-second cooldown, no automatic retries after reconnect |
| Replies | Once per unique request, delayed 250–5,000 ms at random, expiring after 9 s; at most six per node per minute |
| Hops | One: discovery finds direct listeners only |
| Nodes remembered | 32 on the board (oldest replaced first); the app keeps more |
| Airtime | Beacons and replies share the same airtime budget as messages and relays |

Discovery obeys every radio rule: Listen mode never replies, and region, antenna, channel and
queue limits all apply. Discovery traffic uses Public (channel 0), one fragment and no relaying.

## Freshness

Requests and replies are tied to the requester's boot and sequence, and observations carry the
responder's boot and sequence. Duplicate, delayed, out-of-order and previous-boot observations
cannot overwrite newer data; four retired boot counters per node suppress late prior-boot
reports. Expiry uses the node's own monotonic clock. A remote timestamp alone never proves
freshness. A missing reply is inconclusive: the node may be out of range, busy or opted out.

## Position rules

- Position is sent only when **sharing is on and the source is valid**. Storing coordinates, or
  having GPS hardware, never causes a broadcast on its own.
- `(0, 0)` is a valid coordinate, not a "missing" marker. Missing position is represented
  explicitly.
- Coordinates are fixed-point on the wire, and each report names its source (fixed or GPS) and
  age, so last-known positions are never shown as current.
- Turning sharing off removes coordinates from future beacons and replies, and cancels any
  pending report before the next transmission. It cannot recall a signal already sent or erase
  other nodes' history.
- In Open mode discovery and positions are readable by anyone in range. In a team they travel
  under the team key, and beacons are sent only while an app is attached (D50).

Only **fixed positions** are implemented: a saved coordinate, or the browser's location saved as
one. **GPS is deferred.** When it resumes, it must verify the T-Beam's GPS UART and AXP2101
ALDO3 wiring against official documentation, parse with checksums and fix-age limits, keep
acquiring a fix separate from sharing it, never substitute a fixed position silently when GPS
has no fix, and stay compatible with fixed-position-only apps.

## Required tests

1. Two boards discover each other only when replies are on, and the beacon and reply switches
   act independently.
2. Duplicate requests schedule at most one reply; many responders cannot grow queues, loop or
   exceed airtime.
3. Off and Listen modes, an exhausted budget, full queues and region changes suppress or defer
   discovery safely. A reboot releases no burst.
4. Sharing off, invalid or out-of-range coordinates, and missing or stale fixes send no current
   coordinates. `(0, 0)` and exact freshness boundaries are covered.
5. Privacy changes cancel pending position reports.
6. Node snapshot and event overlap, gaps, old boot data and page retries cannot corrupt the node
   list.
7. Unlocated nodes are never plotted at an invented coordinate and stay messageable.

Hardware checks: `tools/hardware-discovery-smoke.ts` (add `--beacon-only` for the timed beacon
test), `tools/hardware-position-smoke.ts` and `tools/hardware-position-persistence.ts`.
