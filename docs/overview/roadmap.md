# Reaper Mesh roadmap

Owner-directed phases, set November 1, 2026 and last updated November 3. This is the canonical list of product priorities. Current implementation and verification state is in [Status](status.md); architecture is in the [development plan](../contributing/plan.md).

**While waiting for a third board (owner direction, November 3):** device firmware work, starting with Phase 4 on-device screen and buttons. See [Phase 4 delivery order](#phase-4-delivery-order).

**Current focus (owner direction, November 3):** field qualification. New portal features are paused until three-node relay and an outdoor range test pass on real hardware; portal work is limited to bug fixes and native QA of existing features. Results from these tests could change the radio protocol, which is cheaper before more features depend on it. See the [field qualification plan](../contributing/field-qualification.md). GPS (2.2b) remains deferred.

**Bluetooth (owner direction, November 4):** firmware support for a mobile agent is being built ahead of qualification (D47). It adds a link, not a radio change, so it does not affect the tests below. Mobile apps are built outside this repository (D48).

Order of work:

1. Get a third board (a second US/915 Heltec V3 is simplest) and build the three-board relay test tool.
2. Three-node relay test.
3. Outdoor range test.
4. Power-loss, interrupted-flash and soak tests.
5. **Core v1 protocol review.** Using the test results, define the core to freeze: the application payload type for data the firmware carries without understanding (Q5), fragment and message size (Q3), and removal of compatibility layers kept for earlier prototype builds. With owner approval, reflash both boards, reset the fixtures to the new baseline and declare core v1 (D41, D42).
6. Resume Phase 2.3 portal work, building new features in agents and plugins on top of core v1. First planned item: per-channel auto-add for shared map items and an explicit channel choice when sharing (D43). Then the items in [Planned after qualification](#planned-after-qualification).

Channel identity was settled early, ahead of the core v1 review, by owner decision (D45).

| Phase | Outcome | Included features | Status |
| --- | --- | --- | --- |
| 1 — Working communications | Two supported devices communicate reliably through the independent Reaper protocol | Heltec V3 and T-Beam V1.2 firmware; USB console; persistent configuration; public/named channels; 1024-byte messages; fragmentation; bounded mesh/relay core; destination ACKs; RACE recovery; validated firmware installation | Complete: actual bidirectional direct RF/ACK/inbox checks pass. Three-node relay, power-cut and field qualification remain release gates. |
| 2 — Discovery and field portal | Know who has been heard, where they report being, and message them | Configurable beacons and discovery requests/replies; node names and last-heard state; optional GPS/fixed position; map, nodes and messaging workspace; management from the portal | Active: 2.1 discovery and 2.2a fixed position are verified on two boards; GPS is deferred; the messaging and map portal is the current focus. |
| 3 — Encrypted channels | Encrypt at agents while devices route ciphertext without keys | Reviewed agent-side envelope and crypto library; agent key vault/provisioning; explicit encrypted/plaintext state; channel epochs/rotation; RACE-safe retries; compatibility and compromise tests | First implementation is in place and encrypted direct messages are verified on two boards. Rotation, interrupted-upload recovery and a security review are pending. See [Channel encryption](../guides/encryption.md). |
| 4 — Device presentation and power visibility | Useful, configurable on-device status | Screen management/layout; sleep timeout/wake behavior; RX/TX indication; battery indication with unsupported/unknown states | In progress: step 1 (screen pages, buttons, 30 s timeout) verified on the T-Beam; screen settings and the T-Beam battery indicator built in `v0.2.0`. Optional board-local features; they must not change the radio protocol (D41). |

## Planned after qualification

Owner-reported problems, recorded November 3. Portal feature work stays paused until field qualification passes (D37), so these are queued, not current.

**Channels**

- **Join a channel out of order: built (November 3, firmware `v0.3.0`).** Channels have on-air IDs and the portal shares them with invites (D45). Verified between the two boards; the portal's Join and Invite buttons still need a native browser check.
- **Remove a channel: built (November 3).** Settings → Channels has Remove channel, and Reset Public for the permanent Public channel. Portal only; no firmware change.

**Map workspace.** The map tools feel unfinished from end to end and need one coherent pass rather than separate fixes:

- **Fixed November 4:** ordinary clicks no longer start creation; use Add point / Draw area or the right-click location menu.
- **Implemented November 4:** placement crosshair, consistent SVG item symbols and device markers, rectangle drag drawing with a live preview, and full-screen map mode with an Exit action and Escape support.
- Browser QA verified full-screen mode and drag → populated rectangle editor → local save. Touch drawing and physical-device workflows remain unqualified.

## Phase 2 delivery order

| Slice | Device/protocol work | Portal work | State and completion evidence |
| --- | --- | --- | --- |
| 2.1 Discovery | Versioned control messages; beacon/response settings; manual who-is-listening request; bounded jittered replies; node cache; capability negotiation; separate node-table sync stream | Discovery controls; node list with name/ID, last heard, response outcome and feature availability | **Done.** Two real boards discover one another; disabled responders stay silent; no response/ACK loops; duplicate/lost/reordered reply and reconnect/reboot tests pass. |
| 2.2a Fixed position | Persist fixed coordinates; independently enable location sharing; include only valid authorized positions | Position settings; last-known markers; nodes without coordinates remain usable | **Done.** Fixed coordinates exchanged on two boards; disabled sharing emits no coordinates; reboot persistence verified. |
| 2.2b GPS | Optional T-Beam GPS input; distinguish GPS/fixed/unavailable and fix age | Location source and age | **Deferred by the owner (November 2).** Needs an actual valid T-Beam fix; invalid or stale fixes are never shown as current. |
| 2.3 Field portal | Expose correlated node snapshots/updates and clear unsupported-capability states; keep existing message/configuration recovery | Messaging-first workspace (conversation inbox and threads), map with local and shared items, settings apart from daily use, responsive layout | **Paused for new features** until field qualification passes. Implemented and checked in host and isolated-browser tests. Remaining: native desktop QA over USB, and a connection selector that supports both devices (needs per-device journaling). Must work with no GPS, no nodes and no map tiles, and reconnect without replaying sends. |
| 2.3b Portal plugins | None | Declarative JSON plugin manifests that add map item types and settings | **v1 done** (no plugin code runs). Executable plugins and integrations such as Weather Radar, Reaper ADS-B and a Reaper APRS bridge will run in sandboxed iframes ([D40](../contributing/decisions.md#d40-code-plugins-run-in-sandboxed-iframes)); they wait on an approved design document for the plugin message API and permissions. |
| 2.4 Qualification | Resource/airtime measurements; mixed Phase 1/2 compatibility; physical loss/reconnect checks | End-to-end connection, discovery, map, messaging and settings checks | Not started as a whole. Shared automated checks and both target builds must pass, with two-board discovery/location/message evidence recorded. Relay qualification still requires a third node. |

Implement each slice vertically: contract and tests, firmware, shared agent core, then UI. Do not mark Phase 2 complete when only its UI or simulator works.

## Phase 2 portal direction

The portal is a dark, technical, messaging-first workspace (owner direction, November 2), superseding the earlier light, map-first design. Use restrained green accents, near-black surfaces, soft gray and white text, restrained corners, clear spacing and legible status. Create original layouts and assets.

Messaging is the primary view: a searchable conversation list (channels and direct messages) and a unified thread. The map is a separate workspace for heard nodes, fixed positions and local or shared map items. Settings are kept apart from daily messaging, with routine setup first and technical maintenance under *Advanced*. On narrow screens, switch between views while preserving drafts and selection.

Show node name plus stable ID, last-heard age, reported location source and age, and honest queued/transmitted/destination-ACK/failed/unknown outcomes. Keep disconnected, stale, unsupported and empty states useful. A missing response is not proof that a node is offline. Map tiles may fail to load; node and message functions must keep working. Do not upload local mesh history to any service.

## Phase boundaries

All phases follow the stable-core principle (D41): the firmware and protocol core stays small, and new features are built in agents and plugins wherever possible. Before core v1, breaking changes are allowed with owner approval (D42).

Phase 2 adds GPS/position reporting explicitly; it does not add broad telemetry, cloud accounts, MQTT, remote administration or device-screen features. Discovery/location is plaintext and unauthenticated until the relevant protection is implemented; the portal must display that plainly. Phase 3 must define whether/how discovery metadata is protected, rather than implying channel encryption automatically hides beacons.

Phase 3 uses the implemented agent-side group-key profile described in [Channel encryption](../guides/encryption.md). Acceptance includes tamper/replay rejection, wrong keys, rotation, unsupported peers, explicit no-downgrade behavior, RACE recovery, both target builds and two-board checks. Phase 4 battery state must come from supported hardware measurements; do not invent percentages on USB-only or unsupported devices.

EU transmit support, mobile/native agents, additional boards, signed public releases, rollback and field qualification remain separately tracked work. The product phases do not waive existing compatibility, regional or RACE requirements.

## Phase 3 delivery order

1. Verify protocol, browser and firmware automated checks; retain the frozen RME1 binary envelope and ciphertext-only recovery behavior.
2. Build both targets, connect both boards, confirm keys never cross USB/radio, verify same-key decryption and wrong-key/rotation outcomes, and confirm device ACK still reports transport delivery only.
3. Test disconnect/reconnect and reboot at partial upload and inbox recovery boundaries. Require exact ciphertext retry semantics and no plaintext downgrade.
4. Review browser dependency provenance, security limitations, current direct-message group-key semantics and the in-process plugin boundary before general release.

## Phase 4 delivery order

Board-local features only (D41). Design and rules: [device screen and buttons](../reference/device-display.md), decision D44.

1. **Done (November 3):** startup icon and title, main/nodes/debug pages, main-button gestures, T-Beam PWR page shortcut, 30-second screen timeout. Verified on the T-Beam; the Heltec builds but is not yet checked on hardware.
2. Check step 1 on the Heltec V3.
3. **Built (November 3):** screen settings stored on the device and set from the portal's Screen tab: timeout and optional wake on a new message. There is no settings page on the device. Settings round trip and reboot persistence verified over USB on both boards; the owner confirmed a 10 s timeout and wake on message on the Heltec.
4. LED indication for TX/RX and new messages.
5. **Built for the T-Beam (November 3):** measured battery percent and a plugged-in indicator in the top right of the main page (also shown with no battery), shown only when known. The Heltec shows nothing until its battery voltage input is verified.
6. Processor sleep modes for real battery savings, without missing radio traffic.
