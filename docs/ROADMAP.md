# Reaper Mesh roadmap

Owner-directed phases, November 1, 2026. This is the product roadmap; PLAN.md retains engineering/background detail. Phase 1 is complete. Phase 2 is the active priority. Later phases are not part of the Phase 2 implementation.

| Phase | Outcome | Included features | Status |
| --- | --- | --- | --- |
| 1 — Working communications | Two supported devices communicate reliably through the independent Reaper protocol | Heltec V3 and T-Beam V1.2 firmware; USB console; persistent configuration; public/named channels; 1024-byte messages; fragmentation; bounded mesh/relay core; destination ACKs; RACE recovery; validated firmware installation | Complete: actual bidirectional direct RF/ACK/inbox checks pass. Three-node relay, power-cut and field qualification remain release gates. |
| 2 — Discovery and field portal | Know who has been heard, where they report being, and message them | Configurable beacons and discovery requests/replies; node names and last-heard state; optional GPS/fixed position; map, nodes and messaging workspace; management from the portal | Active: slice 2.1 and fixed-position 2.2a are checked; GPS is deferred; messaging/asset portal work is active. |
| 3 — Encrypted channels | Encrypt at client agents while devices route ciphertext without keys | Reviewed client-side envelope and crypto library; agent key vault/provisioning; explicit encrypted/plaintext state; channel epochs/rotation; RACE-safe retries; compatibility and compromise tests | First implementation is in place; automated and both-board qualification still pending. See [ENCRYPTION.md](ENCRYPTION.md). |
| 4 — Device presentation and power visibility | Useful, configurable on-device status | Screen management/layout; sleep timeout/wake behavior; RX/TX indication; battery indication with unsupported/unknown states | Planned |

## Phase 2 delivery order

| Slice | Device/protocol work | Portal work | Completion evidence |
| --- | --- | --- | --- |
| 2.1 Discovery | Versioned control messages; beacon/response settings; manual who-is-listening request; bounded jittered replies; node cache; capability negotiation; separate node-table sync stream | Discovery controls; node list with name/ID, last heard, response outcome and feature availability | Two real boards discover one another; disabled responders stay silent; no response/ACK loops; duplicate/lost/reordered replies and reconnect/reboot tests pass. |
| 2.2 Position | Persist fixed coordinates; optional T-Beam GPS input; independently enable location sharing; include only valid authorized positions; distinguish GPS/fixed/unavailable and fix age | Position settings; last-known markers; location source/age; nodes without coordinates remain usable in the list | Fixed Heltec position and actual valid T-Beam GPS fix checked separately. Disabled sharing emits no coordinates; invalid/stale fixes are never presented as current. |
| 2.3 Field portal | Expose correlated node snapshots/updates and clear unsupported capability states; retain existing message/configuration recovery | Map as main workspace; compact node panel; persistent messaging panel; select node to locate/message; settings drawer; responsive layout; connection selector supporting both development devices | Uses real node data and existing reliable messaging; works with no GPS/no nodes/no map network; reconnect restores authoritative state without replaying sends. |
| 2.3b Portal plugins (planned, deferred) | Add a simple portal-side extension architecture for optional features | Future examples: Weather Radar, Reaper ADS-B and Reaper APRS bridge | Revisit extension points and boundaries before implementation. No plugin framework or example integrations are in current work. |
| 2.4 Qualification | Resource/airtime measurements; mixed Phase 1/2 compatibility; physical loss/reconnect checks | End-to-end connection, discovery, tracking, messaging and settings checks | Shared automated checks pass, both target builds pass, and actual two-board discovery/location/message evidence is recorded. Relay qualification still requires a third node. |

Slice 2.1 evidence: opt-out silence, one discovery response in each direction with names verified, and an actual periodic T-Beam beacon received without any reply TX. Heltec7/T-Beam2 retain bidirectional 1024-byte text/ACK behavior. Automatic beacons and responses were restored off after tests.

Implement each slice vertically: contract and tests, firmware, shared client core, then UI. Do not mark all of Phase 2 complete when only its UI or simulator works. Discovery2.1 and fixed-position2.2a are checked; add GPS next so mapping can be tested without a satellite fix. The working Phase 1 console remains usable during the transition.

## Phase 2 portal direction

Use the map/nodes/messaging emphasis of [MeshMonitor](https://meshmonitor.org/) and the calm hierarchy and palette of [EvoCare](https://dribbble.com/shots/27545403-AI-Car-Maintenance-Mobile-App-Design-EvoCare): near-black surfaces, soft gray/white text and restrained green accents, rounded panels, clear spacing, legible status. Create original layouts/assets for Reaper Mesh.

Desktop layout: slim navigation/connection rail; central map; collapsible node list; messaging pane; device/channel settings in a drawer. Selecting a marker or list row selects the same node and offers a direct-message action. Channels and broadcast remain accessible. On narrow screens, switch between map, nodes and messages while preserving drafts and selection.

Show node name plus stable ID, last-heard age, reported location source/age, and honest queued/transmitted/destination-ACK/failed/unknown message outcomes. Keep disconnected, stale, unsupported and empty states useful. A missing response is not proof that a node is offline. Map tiles may be configurable; node/message functions must remain usable when tiles cannot load. Do not upload local mesh history to a service as part of the redesign.

### Deferred portal plugins

Plan a simple extension architecture for optional portal functionality, to revisit soon after the core messaging/asset workflows are settled. Candidate plugins include Weather Radar, Reaper ADS-B and a Reaper APRS bridge. Keep the design focused on adding a view or capability to the web app; define extension boundaries before choosing integration details. The framework and integrations are not part of current implementation work.

## Phase boundaries

Phase 2 adds GPS/position reporting explicitly; it does not add broad telemetry, cloud accounts, MQTT, remote administration or device-screen features. Discovery/location is plaintext and unauthenticated until the relevant protection is implemented; the portal must display that plainly. Phase 3 must define whether/how discovery metadata is protected, rather than implying channel encryption automatically hides beacons.

Phase 3 uses the implemented client-side group-key profile described in [ENCRYPTION.md](ENCRYPTION.md). Acceptance includes tamper/replay rejection, wrong keys, rotation, unsupported peers, explicit no-downgrade behavior, RACE recovery, both target builds and two-board checks. Phase 4 battery state must come from supported hardware measurements; do not invent percentages on USB-only or unsupported devices.

EU transmit support, BLE/mobile/native clients, additional boards, licensing, signed public releases, rollback and field qualification remain separately tracked work. The product phases do not waive existing compatibility, regional or RACE requirements.

## Phase 3 delivery order

1. Verify protocol, browser and firmware automated checks; retain the frozen RME1 binary envelope and ciphertext-only recovery behavior.
2. Build both targets, connect both boards, confirm keys never cross USB/radio, verify same-key decryption and wrong-key/rotation outcomes, and confirm device ACK still reports transport delivery only.
3. Test disconnect/reconnect and reboot at partial upload and inbox recovery boundaries. Require exact ciphertext retry semantics and no plaintext downgrade.
4. Review browser dependency provenance, security limitations, current direct-message group-key semantics and the in-process plugin boundary before general release.

November2 owner update: GPS2.2b is deferred. Prioritize2.3 messaging and asset UX now, using already qualified fixed positions. Messaging-first dark technical styling supersedes the earlier consumer/light/map-first treatment. See WEB.md for implementation, browser checks and remaining data limitations.
