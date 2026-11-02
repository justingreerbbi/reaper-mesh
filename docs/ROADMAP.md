# Reaper Mesh roadmap

Owner-directed phases, November 1, 2026. This is the product roadmap; PLAN.md retains engineering/background detail. Phase 1 is complete. Phase 2 is the active priority. Later phases are not part of the Phase 2 implementation.

| Phase | Outcome | Included features | Status |
| --- | --- | --- | --- |
| 1 — Working communications | Two supported devices communicate reliably through the independent Reaper protocol | Heltec V3 and T-Beam V1.2 firmware; USB console; persistent configuration; public/named channels; 1024-byte messages; fragmentation; bounded mesh/relay core; destination ACKs; RACE recovery; validated firmware installation | Complete: actual bidirectional direct RF/ACK/inbox checks pass. Three-node relay, power-cut and field qualification remain release gates. |
| 2 — Discovery and field portal | Know who has been heard, where they report being, and message them | Configurable beacons and discovery requests/replies; node names and last-heard state; optional GPS/fixed position; map, nodes and messaging workspace; management from the portal | Active: requirements/planning established; implementation follows the ordered slices below. |
| 3 — Encrypted channels | Configure and use protected channels from the portal | Audited authenticated encryption; channel keys and local provisioning; explicit encrypted/plaintext state; nonce/replay handling; key rotation and recovery; compatibility tests | Planned |
| 4 — Device presentation and power visibility | Useful, configurable on-device status | Screen management/layout; sleep timeout/wake behavior; RX/TX indication; battery indication with unsupported/unknown states | Planned |

## Phase 2 delivery order

| Slice | Device/protocol work | Portal work | Completion evidence |
| --- | --- | --- | --- |
| 2.1 Discovery | Versioned control messages; beacon/response settings; manual who-is-listening request; bounded jittered replies; node cache; capability negotiation; separate node-table sync stream | Discovery controls; node list with name/ID, last heard, response outcome and feature availability | Two real boards discover one another; disabled responders stay silent; no response/ACK loops; duplicate/lost/reordered replies and reconnect/reboot tests pass. |
| 2.2 Position | Persist fixed coordinates; optional T-Beam GPS input; independently enable location sharing; include only valid authorized positions; distinguish GPS/fixed/unavailable and fix age | Position settings; last-known markers; location source/age; nodes without coordinates remain usable in the list | Fixed Heltec position and actual valid T-Beam GPS fix checked separately. Disabled sharing emits no coordinates; invalid/stale fixes are never presented as current. |
| 2.3 Field portal | Expose correlated node snapshots/updates and clear unsupported capability states; retain existing message/configuration recovery | Map as main workspace; compact node panel; persistent messaging panel; select node to locate/message; settings drawer; responsive layout; connection selector supporting both development devices | Uses real node data and existing reliable messaging; works with no GPS/no nodes/no map network; reconnect restores authoritative state without replaying sends. |
| 2.4 Qualification | Resource/airtime measurements; mixed Phase 1/2 compatibility; physical loss/reconnect checks | End-to-end connection, discovery, tracking, messaging and settings checks | Shared automated checks pass, both target builds pass, and actual two-board discovery/location/message evidence is recorded. Relay qualification still requires a third node. |

Implement each slice vertically: contract and tests, firmware, shared client core, then UI. Do not mark all of Phase 2 complete when only its UI or simulator works. Start with 2.1; add fixed positions before GPS so mapping can be tested without a satellite fix. The working Phase 1 console remains usable during the transition.

## Phase 2 portal direction

Use the map/nodes/messaging emphasis of [MeshMonitor](https://meshmonitor.org/) and the calm hierarchy and palette of [EvoCare](https://dribbble.com/shots/27545403-AI-Car-Maintenance-Mobile-App-Design-EvoCare): near-black surfaces, soft gray/white text and restrained green accents, rounded panels, clear spacing, legible status. Create original layouts/assets for Reaper Mesh.

Desktop layout: slim navigation/connection rail; central map; collapsible node list; messaging pane; device/channel settings in a drawer. Selecting a marker or list row selects the same node and offers a direct-message action. Channels and broadcast remain accessible. On narrow screens, switch between map, nodes and messages while preserving drafts and selection.

Show node name plus stable ID, last-heard age, reported location source/age, and honest queued/transmitted/destination-ACK/failed/unknown message outcomes. Keep disconnected, stale, unsupported and empty states useful. A missing response is not proof that a node is offline. Map tiles may be configurable; node/message functions must remain usable when tiles cannot load. Do not upload local mesh history to a service as part of the redesign.

## Phase boundaries

Phase 2 adds GPS/position reporting explicitly; it does not add broad telemetry, cloud accounts, MQTT, remote administration or device-screen features. Discovery/location is plaintext and unauthenticated until the relevant protection is implemented; the portal must display that plainly. Phase 3 must define whether/how discovery metadata is protected, rather than implying channel encryption automatically hides beacons.

Phase 3 requires an encryption/key-lifecycle design and tests before implementation: power-loss-safe nonce handling, tamper/replay rejection, wrong keys, rotation, unsupported peers and explicit failure. Phase 4 battery state must come from supported hardware measurements; do not invent percentages on USB-only or unsupported devices.

EU transmit support, BLE/mobile/native clients, additional boards, licensing, signed public releases, rollback and field qualification remain separately tracked work. The product phases do not waive existing compatibility, regional or RACE requirements.
