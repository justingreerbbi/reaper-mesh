# Phase 2: discovery, position and field portal

Status: slice 2.1 discovery is implemented and physically checked on Heltec7/T-Beam2. Fixed-position slice2.2a is implemented and physically checked; GPS and field-portal sections remain the contract for subsequent slices. See PROTOCOL.md for the implemented discovery wire layout.

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

## Slice 2.1 evidence

Discovery core, persistent settings, capability-gated USB, fixed node snapshots, query-only recovery and minimal console controls are implemented. Host checks pass 210 tests; CMake/CTest passes64. Actual two-board tests confirm disabled responses produce zero replies; enabling responses yields one per request in both directions; both configured names appear in node snapshots. A real 60-second periodic T-Beam beacon reached the Heltec without a manual request and with zero reply TX. Existing 1024-byte messages/ACK/inbox still pass both directions. No GPS/position fields were transmitted. Per-device browser journaling, 256-node host history and the map-first redesign remain later Phase2 work; this console uses the device's bounded32-node snapshot.

Installed images: Heltec usb-prototype-7 and T-Beam tbeam-usb-prototype-2 from clean commit a44319b, with all ROM artifact hashes verified and NVS preserved. Application sizes274256/244416 bytes. Observed free heap260592/187924 bytes and minimum free main stack16892/17116 bytes respectively. The coherent node snapshot trades a bounded RAM increase for paging that cannot starve under incoming reports. Final persisted state: Heltec revision28 mesh, T-Beam revision17 off; beacon/response flags false and interval300 on both. The T-Beam serial driver needed a USB reconnect before installation; failed preflight attempts wrote nothing.

Reproduce with tools/hardware-discovery-smoke.ts PYTHON HELTEC_PORT TBEAM_PORT; append --beacon-only for the timed periodic test. Both restore original settings. Local ignored reports: build/tbeam-v12/discovery-smoke.json, beacon-smoke.json and discovery-final-state.json. Native browser interaction with the new controls has not been manually checked; shared client/core and actual USB protocol behavior are tested.

## Slice 2.2a: fixed position

Implemented saved fixed coordinates on both boards, independent opt-in sharing, additive USB/location capability, record4 persistence/migration, radio control payloadv2 and node-snapshot position fields. Manual discovery stays v1; Phase1 text/ACK is unchanged. The minimal console offers none/fixed source, coordinate inputs, sharing switch and received fixed-position details. No map or GPS acquisition is implemented in this slice. See PROTOCOL.md for exact coordinate representation, compatibility and privacy boundaries.

Host tests cover (0,0), coordinate boundaries, invalid/partial fields, failed/ambiguous persistence, reboot, legacy writes, lost-reply recovery, stale/duplicate observations, frozen node snapshots and cancellation of selected location-bearing control flights. Both target builds pass; see the qualification evidence below. Reproduce synthetic-coordinate RF checks with tools/hardware-position-smoke.ts PYTHON HELTEC_PORT TBEAM_PORT; original policies are restored afterward.

### Fixed-position qualification (November 1, 2026)

Installed Heltec usb-prototype-8 and T-Beam tbeam-usb-prototype-3 from clean source420967909bb4693746620b76ca2d88ef7d0e4eb3, application sizes275712/245856 bytes. ROM verified all three images on each device; NVS was preserved. Heltec's first application write stopped responding at70%; re-running the exact validated ROM updater completed successfully. This is one observed recovery, not arbitrary power-cut qualification.

Real two-board tests received exact synthetic fixed coordinates in each direction (geographic0,0 and−90,180), one response per request. Disabling sharing then produced one identity-only response in each direction and cleared the latest node position. No owner location or GPS fix was used. USB reopen retained settings; separate tools/hardware-position-persistence.ts reset each board through read-only ROM identity inspection, verified a different boot and the saved record4 position, then restored original policies. That test kept RF sharing false throughout.

Before upgrading the T-Beam, the new Heltec8 and older T-Beam2 exchanged exact1024-byte messages and destination ACKs in both directions. After both upgrades, the same regression passed again. Recorded resource headroom: Heltec free heap259064/minimum free main stack16692 bytes; T-Beam186396/16916 bytes. Final revisions38/32; position source/sharing were restored to none/off. Existing owner policies were preserved: both mesh/2dBm; Heltec beacon/respond false; T-Beam beacon/respond true; intervals300. These differ from the older2.1 checkpoint because the owner changed T-Beam policy between tasks.

An extended test attempt hit a T-Beam node-snapshot read timeout before its reboot step. Fresh sessions recovered; original policies/sharing-off were explicitly verified. The harness previously aborted restoration on an unrelated node-read error; restoration now waits on configuration independently. A repeated two-board coordinate/privacy run subsequently passed. The read is bounded and query-only; no discovery/message mutation was replayed. A deterministic reconnect-after-node-read-exhaustion regression is included. Retain the transient hardware observation for serial/soak work; no zero-fault endurance claim.

## Deferred portal plugin planning

November 2 owner direction: revisit a simple plugin architecture for optional portal functionality soon. Candidate examples are Weather Radar, Reaper ADS-B and a Reaper APRS bridge. This is a planning item under the Phase 2 portal; do not implement the extension framework or integrations yet.

Host checks pass220 tests and the web build; standalone CTest passes67. Existing fixture bytes are unchanged; three position fixtures are appended. New browser controls are compiled/shared-core tested but have not been manually desktop-tested. Local evidence: build/tbeam-v12/position-smoke.json, position-persistence.json, position-mixed-pair-smoke.json and pair-smoke.json; logs/private/tmp/reaper-position-*. GPS and map integration remain unimplemented and Phase2.2 as a whole is still active.
