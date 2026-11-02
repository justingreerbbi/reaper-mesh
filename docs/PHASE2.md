# Phase 2: discovery, position and field portal

Status: implementation contract draft, not implemented firmware behavior. Start with slice 2.1 in ROADMAP.md. Wire values/schema changes must be reviewed alongside tests before being frozen.

## Discovery behavior

Separate three operations: periodic presence beacon, explicit who-is-listening request, and presence reply. Periodic beacons announce the sender; manual discovery requests ask permitted listeners to respond. A presence reply is the acknowledgment of discovery and never requests another acknowledgment. Preserve the existing destination-ACK meaning for text messages.

Settings are independent: automatic beaconing, responding to discovery, and sharing location. Default all three off. A manual discovery action may run while automatic beacons are off, subject to radio readiness and the same bounds. The sender reports its configured name and stable node ID; responders report their own, not the requester's. Empty names fall back to node IDs.

Initial proposed bounds for implementation/testing:

- Periodic interval: default 300 seconds when enabled, configurable 60–3600 seconds with jitter. No immediate catch-up burst after reboot or a delayed scheduler.
- Manual discovery cooldown: 30 seconds. One active local request, a 10-second collection window, no automatic request retries after reconnect.
- Respond once per unique request; jitter replies within 250–5000 ms; limit each node to six discovery replies per minute. Cache bounded duplicate/requester state. A reply cannot trigger replies from other nodes.
- Reuse the shared regional airtime budget for beacons, replies, relays and messages. Discovery cannot bypass radio mode, antenna, region, channel or queue restrictions. Receive-only mode never responds by radio.
- Default discovery hop budget: one, identifying direct listeners. Allow an explicit bounded mesh discovery mode later within Phase 2 if required; show discovery scope, and do not label relayed observations as direct neighbors.
- Target device node cache: 32 entries, bounded replacement/stale policy; host view: 256 entries. Measure actual RAM/airtime before freezing limits. Retain old observation data as last-known, not guaranteed connectivity.

Requests/replies bind to request origin, boot identity and sequence; observations also carry the responding node's boot/sequence. Test duplicate, delayed, out-of-order and retired-boot observations so they cannot silently overwrite newer known state. Expiry uses monotonic local time. A remote timestamp alone does not establish freshness or trust.

## Location rules

Represent missing location explicitly; (0,0) is a valid coordinate, not a missing-value sentinel. Validate latitude/longitude, use fixed-point representation on the wire, and identify source as GPS or fixed position. Include fix/observation age sufficient to distinguish current from last-known location; never manufacture a GPS fix.

GPS acquisition and RF location sharing are separate settings. Location fields are omitted unless sharing is explicitly enabled and the selected source is valid. Fixed position is a deliberate saved setting; do not silently substitute it when GPS has no fix. With GPS selected but unavailable/stale, announce identity without coordinates and report the local reason. Disabling sharing removes any coordinates from future beacons/replies; previously received last-known positions may remain in peer history and cannot be remotely erased by that switch.

Start with fixed coordinates on both boards. Then add a bounded checksum-validating GPS parser for the T-Beam, after verifying its UART wiring, power rail and actual module output. A non-GPS Heltec can still report an explicitly saved fixed position. No computer/browser geolocation is inferred or requested automatically. Define the fresh-fix threshold with the GPS implementation and test its exact boundary.

## Protocol and persistence

Use dedicated, versioned control payloads, never magic text hidden in user messages. Choose additive radio control kinds so existing Phase 1 peers can reject unsupported control traffic while ordinary text/ACK behavior remains unchanged. Keep payloads small enough for one control datagram where practical; bound optional names and location fields before encoding.

Add explicit USB capabilities for discovery/location and unsupported operations. Generate TS/C++ bindings from the schema; append fields/types without rewriting old tags or fixtures. Keep firmware build strings independent of behavior negotiation.

Beacon/privacy/location settings are device-authoritative, revision-checked and atomically persisted. Plan a new backward-readable record extension; older unsupported storage must fail closed without erase. Setting changes must cancel pending location-bearing control packets before any further TX, avoiding disclosure under stale privacy settings. Already in-flight RF cannot be recalled; report the setting's effective boundary honestly.

Expose a separate node-table sequence/snapshot stream with bounded pages/cursors and retention-gap reporting. Do not reuse configuration revision or message/inbox sequence counters. Reconnect resnapshots the node table; it does not replay discovery requests or text sends. Browser persistence and writer ownership must be scoped per device before enabling simultaneous USB connections in the redesigned portal. Test that aliases/second tabs cannot share a writer identity or cross-contaminate device histories.

## Required tests and acceptance

1. Two boards discover identity/name only when responding is enabled; beaconing and response switches act independently. A Phase 1-only peer still sends/receives text.
2. Duplicate requests schedule at most one reply; late replies retain their request context; timeout/reply races converge. Many simulated responders cannot cause unbounded queue growth, reply loops or airtime bypass.
3. Off/receive-only, exhausted budget, saturated queues and region changes suppress or defer control traffic safely. Reboot does not release a catch-up burst.
4. GPS disabled, sharing disabled, malformed/out-of-range coordinates, missing fix and stale fix emit no current coordinates. Exact freshness boundaries and valid (0,0) are covered.
5. Privacy changes cancel pending position reports; concurrent config changes, failed commits and reconnects preserve the device's authoritative setting.
6. Node snapshot/event overlap, gaps, old boot/sequence data and page retries cannot corrupt the registry. Device caches and host history remain bounded.
7. Map/list selection agrees; nodes with no position remain messageable; tile failure and USB disconnect preserve drafts and honest outcomes. Unlocated nodes are never plotted at a fabricated coordinate.
8. Both firmware targets build, host checks pass, and real two-board discovery/fixed-position/message tests run. Actual GPS acquisition is separately observed; simulated positions are labeled. Do not claim relay/range/security qualification from these checks.
