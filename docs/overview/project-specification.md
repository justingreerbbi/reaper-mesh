# Reaper Mesh — Project Specification and Vision

| Document control | Value |
| --- | --- |
| Status | Draft for owner approval; not an approved release standard |
| Version | 0.3 (consistency review against current docs and code, November 7) |
| Date | November 7, 2026 |
| Scope | Project vision, product phases, system requirements and implementation direction |
| Authority | Proposed project baseline; existing approved protocol contracts remain authoritative until explicitly revised |

## 1. Purpose and upstream intent

Reaper Mesh is an independent, locally operated LoRa messaging and situational-awareness system. Its purpose is to let people exchange short messages, identify participating nodes and view deliberately shared positions without depending on a cloud account or internet connection for radio messaging.

The upstream intent is a dependable communications platform with understandable behavior: users should know what the system has done, what remains uncertain and how to recover from interruptions. Reliability, privacy choices, compatibility and usability take precedence over feature count.

This specification consolidates the intended product standard. It is not a claim that every requirement is implemented or qualified. It introduces no new authorization to transmit, flash hardware, publish software or enable deferred features.

### 1.1 Intended outcomes

- A small, stable core that rarely needs firmware updates, with new capability added in agents and plugins.
- Reliable local and direct radio messaging with explicit delivery outcomes.
- Simple channel creation and management, with optional agent-side message encryption.
- Discovery and map views based on observed information rather than assumed connectivity.
- Local ownership of configuration, channel keys and agent history.
- Predictable operation during disconnection, reboot, packet loss and partial failure.
- A polished web interface that presents everyday actions directly and keeps technical diagnostics secondary.

### 1.2 Product boundaries

Reaper Mesh is not currently specified as a safety-critical emergency service, a guaranteed-delivery network, a high-bandwidth transport or an anonymous communications system. Candidate field uses do not establish suitability for life-safety decisions.

The project uses an independent Reaper Mesh protocol. Interoperability with Meshtastic or another mesh protocol is not an established requirement. The project is licensed under Apache-2.0; public release and distribution terms remain owner decisions.

### 1.3 Stable core, extensible edges

Reaper Mesh is built for organizations that need a messaging system that stays stable once deployed. Its core (board firmware and the radio and USB protocols) is kept deliberately small: messaging with acknowledgments, relay, discovery, positions, channels and the means to carry new kinds of data. New capability is added at the edges, in agents and plugins, so boards do not need frequent firmware updates and agents keep working with the firmware already installed.

This is a deliberate contrast with mass-market mesh projects, where many requested features are added to the firmware core. Each addition brings new firmware and app versions, older installs stop working with newer ones, and the core grows with features most users never use. Reaper Mesh does not follow that model.

In practice:

- New features SHOULD be built in agents or plugins. A firmware or protocol change needs a stated reason why the edge cannot do it.
- The core SHOULD carry application data it does not understand: firmware relays, acknowledges and delivers typed payloads, and agents ignore types they do not support. This lets new features reach older firmware and lets older agents coexist with newer ones.
- Once core v1 is released, firmware changes are expected to be limited to bug fixes, new boards and rare, deliberate major versions.
- Optional board-local features, such as screen layout or battery display, MUST NOT change the radio protocol.

### 1.4 Project stage

Reaper Mesh is in active development and is not yet stable. It is used only by its maintainer, on development boards, and is not deployed anywhere. There are no outside users to keep compatible with.

Until core v1 is declared:

- The owner may approve breaking changes to the radio protocol, USB protocol or storage formats when they simplify the core, instead of adding another compatibility layer for earlier prototype builds. Boards are reflashed as needed.
- Compatibility fixtures pin the current behavior so changes are always deliberate. A breaking change updates them explicitly with owner approval; they are never refreshed silently.
- Testing, recovery and honest-reporting requirements apply in full.

At core v1, the protocol and storage formats are frozen, the fixtures are reset to that baseline, and the compatibility requirements in section 6 apply from then on.

## 2. Users and use cases

| User or setting                              | Intended workflow                                           | Required system behavior                                                                    |
| -------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Individual operator                          | Connect a node, inspect its state and exchange messages     | Clear connection state, retained drafts and truthful delivery outcomes                      |
| Small field team, search and rescue, overlanders | Use a common channel to coordinate activity                 | Matching channel numbers, explicit encryption policy and deliberate shared-key distribution |
| Camp, event or temporary work area           | Discover participating nodes and send channel broadcasts    | Bounded discovery traffic; no assumption that a missing reply means offline                 |
| Asset or position observer                   | Inspect the last reported location of a node and contact it | Consistent map/list selection, location source and age, usable unlocated nodes              |
| Privacy-conscious operator                   | Protect locally saved keys or remove local app data         | Optional app PIN, understandable protection state and confirmed local wipe                  |
| Maintainer                                   | Configure, update and troubleshoot supported hardware       | Capability checks, compatible migrations, reproducible builds and recovery evidence         |

These are intended applications and evaluation scenarios, not performance or deployment guarantees. Range, capacity, battery endurance and interference tolerance require measured evidence for the selected hardware and environment.

## 3. System model and responsibilities

| Layer | Responsibility | Boundary |
| --- | --- | --- |
| Web portal | Messaging, the map (nodes, positions and shared map items), channel management, key provisioning, plugins and local privacy controls | Must not imply browser preferences are device-wide policy |
| Shared agent core | Negotiation, state synchronization, command lifecycle, messaging and recovery | Transport-independent behavior with explicit connection/session context |
| Device firmware | Authoritative persisted device settings, bounded queues, radio operation and inbox retention | Does not receive channel encryption keys or the app PIN. Since `v0.8.0` (D50) a radio on a team stores a relay key and holds a team key in memory |
| Radio network | Carry bounded message fragments, acknowledgments and discovery reports | Delivery and observations are constrained by airtime, loss and topology |
| Local browser storage | Agent journals, message metadata, encryption policies, key records, map items and installed plugins | Scoped to browser origin/profile; separate from device storage |
| Build and update tooling | Validate target, schema, provenance, images and installation outcomes | Hardware qualification cannot be inferred from host tests |

The web agent supports one connected node at a time, over USB or Bluetooth. Simultaneous multi-device browser operation requires separately designed device-scoped journals, ownership and selection behavior.

### 3.1 Terminology

- **Node:** a supported radio device running Reaper Mesh firmware.
- **Agent:** software connected to a node: the browser portal in this repository, or a mobile app built outside it (D48).
- **Channel:** a numbered logical messaging group sharing the configured radio profile.
- **Direct message:** a message routed to a specific node; not necessarily pairwise-private.
- **Observed asset:** a node heard by the system, possibly with a last-known reported position.
- **RACE:** the project's synchronization and recovery discipline; not a separate framework.

## 4. Product phases

Phase completion records product milestones. It does not waive outstanding security, hardware or release gates. Work from a later phase may be implemented before all qualification for an earlier phase is complete.

| Phase | Intended outcome | Current baseline | Acceptance direction |
| --- | --- | --- | --- |
| 1 — Working communications | Supported nodes exchange messages through the independent protocol | Owner marks complete; two-board direct RF, destination ACK and inbox behavior have recorded evidence | Preserve configuration authority, compatibility, bounded transport and recovery; qualify three-node relay separately |
| 2 — Discovery and field portal | Operators discover nodes, inspect shared positions and communicate through a usable portal | Active; discovery and fixed-position slices have hardware evidence; the messaging and map portal is implemented, with new features paused for field qualification | Complete end-to-end portal workflows, privacy controls, reconnect behavior and hardware/browser checks; GPS is explicitly deferred |
| 3 — Encrypted channels | Agents encrypt message bodies while devices route ciphertext | Initial group-key implementation exists; direct encrypted exchanges and interrupted-upload recovery on Heltec/T-Beam have recorded evidence | Validate key transfer/rotation, tamper/replay handling and no plaintext downgrade; independent security review remains outstanding |
| 4 — Device presentation and power visibility | Clear on-device status and supported power information | In progress; screen pages, buttons, screen settings and battery display are built, with evidence in Status; LED indication and sleep modes are not built | Define screen management, sleep/wake, RX/TX indication and measured battery reporting with unknown/unsupported states |

The current priority is field qualification: three-node relay, outdoor range, power loss and soak testing on real hardware (owner direction, November 3). New portal features are paused until relay and range pass. GPS acquisition is not the next automatic task.

## 5. Functional requirements

In this draft, **MUST** defines a proposed mandatory requirement, **SHOULD** defines the preferred behavior unless an exception is documented, and **MAY** identifies an optional implementation. These terms do not imply owner approval of new scope.

### 5.1 Connection and device configuration

- The agent MUST negotiate versions and capabilities before enabling affected operations.
- The device MUST remain authoritative for its persisted settings. Writes MUST use revision checks and atomic persistence.
- Unsupported, disconnected, read-only and storage-failure states MUST be explicit and actionable.
- A reconnect MUST obtain authoritative state rather than silently apply stale browser settings.
- Logical channels, regional radio profiles, hardware capabilities and agent privacy preferences MUST remain separate concerns.

### 5.2 Messaging

- The system MUST distinguish accepted/queued, transmitted, destination-acknowledged, failed and unknown outcomes. USB acceptance is not remote delivery; an acknowledgment is not a read receipt.
- Ambiguous sends MUST NOT be automatically resent after reconnect or reboot. Recovery MUST query retained outcomes where supported.
- Broadcasts MUST NOT create recipient acknowledgment storms.
- Fragmentation, retries, queues, histories, deduplication and reassembly MUST have explicit bounds.
- Drafts SHOULD survive navigation and temporary disconnection within the active agent session. Reload persistence of unsent drafts requires an explicit storage/privacy decision.
- The UI MUST NOT invent timestamps, message order, read receipts or connectivity information absent from the available data.

### 5.3 Channels and message encryption

- The initial model supports eight numeric channel slots, 0–7. Slot 0 is Public. Names are labels; channel identity depends on the numeric slot.
- Management MUST show configured channels, provide creation only when capacity remains, and open one selected channel's settings independently.
- Channel naming is device configuration. Encryption policy and keys are agent-local and MUST be presented as such.
- Creating or importing a key MUST NOT send that key to firmware or over the radio. Sharing keys with other agents MUST be deliberate. Under D50 (planned), a deliberate rekey may send a key over the radio only when wrapped to a verified member.
- An agent requiring encryption MUST fail closed when the key is absent or unavailable. It MUST NOT silently send plaintext instead.
- Rotation MUST retain the ability to decrypt retained older epochs locally where supported and require deliberate distribution of the new key. Under D50 (planned), keys ratchet automatically, old keys are erased, and history stays readable from the local vault instead.
- Direct routes currently use the selected channel's group key. The UI and documentation MUST NOT describe this as pairwise privacy or individual sender authentication.

### 5.4 Discovery, positions and assets

- Automatic beacons, discovery responses and location sharing MUST be independent opt-in policies.
- Manual discovery MUST use bounded request/reply behavior, cooldowns and reply scheduling. A missing response is inconclusive.
- Location MUST distinguish missing, fixed, GPS and unavailable/stale data as capabilities evolve. Geographic zero coordinates are valid.
- Position sharing MUST be explicitly enabled. Stored coordinates or installed GPS hardware alone MUST NOT cause disclosure.
- Disabling sharing MUST stop future eligible reports; it cannot erase previously received peer data or recall an in-flight transmission.
- Map markers and node-list selection MUST agree. Nodes without locations MUST remain usable for supported messaging workflows.
- Tile/network failure MUST NOT disable messaging or fabricate node positions. Last-known data MUST remain distinguishable from current observations.

### 5.4.1 Shared map items and plugins

- Local map items MUST be saved without sending anything; sharing MUST be an explicit action per item.
- When sharing, the user MUST choose the channel explicitly. The share dialog MUST NOT preselect a channel, and Share stays disabled until one is chosen. The dialog SHOULD show whether the chosen channel is encrypted. Broadcast to the channel or a specific node remains the user's choice.
- A shared item belongs to the node that first shared it: its identity is the channel, the original sender's node ID and the item's ID. Only that sender's updates and removals apply to it, and per-item revision barriers MUST reject older or repeated revisions. Other users MAY copy an item and share their own version.
- By default, received items, updates and removals MUST NOT change the map until the user accepts them on the message card.
- Each channel has an agent-local **Auto-add shared map items** setting, off by default. When it is on, valid items, updates and removals from that channel apply to the map automatically, without a prompt, following the ownership and revision rules above. The message card still appears and says the change was applied automatically.
- Auto-add MUST be available only on channels where this agent requires encryption and holds the key. Senders on unencrypted channels, including Public, are not authenticated, so anyone in radio range could otherwise change the map. If encryption is no longer required on a channel, auto-add for that channel MUST turn off.
- Group keys do not authenticate individual senders: any holder of the channel key can send items that appear to come from another member. The auto-add setting MUST say so.
- A user MAY remove an auto-added item locally. Later updates to that item MUST then appear as message cards instead of re-adding it, until the user adds it back.
- Auto-add MUST respect the map workspace storage limits. When storage is full, new items MUST fall back to message cards rather than evicting saved items.
- Shared items are stored locally on each agent. Delivery is best effort: an agent that is offline, or whose device has already discarded the message from its inbox, misses that update. There is no history synchronization between agents.
- Deleting messages MUST NOT remove accepted map items. Local items are plaintext browser data, and the UI MUST say so; encrypted shared items MUST stay ciphertext at rest.
- Plugin manifest v1 is declarative JSON: it MAY add map item types, fields and settings, and MUST NOT execute code, load remote content or send messages. Only fields marked `shared` MAY be sent.
- Plugins that run code MUST run isolated in a sandboxed iframe on a separate origin, with permissions declared in the manifest and approved by the user. They MUST NOT receive channel keys, and receive decrypted content only through an explicit, separately approved permission (decision D40). An approved design document precedes any implementation.

### 5.5 Optional local PIN

- PIN protection MUST be optional and off by default for a new agent profile. Under D50 (planned), it is required in team mode.
- Users MUST be able to enable a 4–6 digit PIN and remove it in Privacy settings without losing channel keys or replay records.
- With protection enabled, a device connection MUST require one app-wide unlock. Channel editors MUST NOT introduce separate PINs or vault unlocks.
- The PIN MUST remain agent-local. It MUST NOT be sent to a device, stored in firmware or described as device authentication.
- Protected key storage MUST use a reviewed password-derivation and authenticated-encryption implementation. Without protection, the UI MUST state that keys are stored without a password.
- Failed unlock attempts MUST have a persisted, bounded cooldown. This is not a defense against an attacker controlling the browser or copying storage for offline guessing.
- Locking, reconnecting and reloading MUST require a new unlock when protection is enabled. Existing protected records MUST have a loss-preserving migration path.

### 5.6 Local data deletion

- Privacy settings MUST provide a clearly destructive Wipe local data action with explicit confirmation. It MUST also be reachable from the lock screen without requiring the PIN.
- Wiping MUST stop local app sessions, prevent background storage restoration, coordinate browser writers and clear app-owned settings, keys, PIN state, local messages and message metadata.
- The app MUST report deletion failures honestly and provide a stopped state suitable for retry.
- The action MUST NOT erase device configuration or device inboxes. Messages retained on the device may return after reconnecting.
- Other profiles/browsers, exported backups and forensic storage remnants are outside the local wipe contract. The product MUST NOT claim secure physical erasure.

## 6. Reliability and compatibility standard

The system MUST preserve connection/session identity, boot identity, request identity and authoritative revision boundaries. Duplicate requests inside retained windows MUST converge on one operation. Missing receipts, exhausted retention and previous-boot outcomes MUST remain explicitly unknown when execution cannot be established.

Configuration and message recovery MUST remain distinct. Configuration commits MUST not be inferred from a successful transport write; message delivery MUST not be inferred from configuration synchronization. Unavailable or corrupt persisted state MUST fail closed without automatic formatting or implicit data loss.

From core v1 onward, protocol changes MUST use negotiated versions/capabilities, generated bindings and preserved compatibility fixtures; before core v1, see section 1.4. Frozen fixtures MUST NOT be silently refreshed. New synchronization behavior requires deterministic race/recovery tests, including delayed, duplicated, missing and out-of-order information.

## 7. Security, privacy and trust

External input, radio observations, browser storage, configuration files and connected-device responses MUST be validated for their current use. Parsers, memory and storage MUST be bounded. UI output MUST be escaped for its context; errors and logs MUST not expose secrets.

The current channel design protects message bodies using shared group keys. It does not provide individual sender authentication, forward secrecy, metadata anonymity or protection from a compromised unlocked agent. Discovery and position information are not implicitly protected by channel message encryption. Device acknowledgments confirm transport behavior, not successful decryption.

The owner approved the [security architecture](../contributing/security-architecture.md) (D50) as the direction for trusted devices: radios outside a team cannot read, inject or relay team traffic, and Open operation stays an explicit choice. Team networks and key rotation are built (steps 1 and 2a). The paragraph above still describes channel encryption until the later steps ship, and [Status](status.md) lists what remains.

No cloud account is required for core operation. Map tiles may require a network and disclose ordinary network requests to a tile provider; local radio messages and history MUST NOT be uploaded as a side effect of portal operation.

## 8. User experience and design standard

The portal SHOULD use a restrained dark technical visual language with legible text, consistent spacing and clear status. Messaging and the map are primary workflows; configuration and diagnostics are secondary.

Every action MUST have one clear place in the interface. Existing channels SHOULD appear as a list or contextual submenu; empty capacity MUST be represented by Create channel rather than a grid of blank inputs. Selected-channel editing MAY use a separate dialog or view. Settings dialogs MUST stay anchored as sections change, grow within the available viewport and scroll internally when required.

Controls MUST support keyboard operation, visible focus and meaningful labels. Forms MUST provide actionable validation. Layouts MUST accommodate common desktop and narrow-screen sizes without hiding essential actions. Loading, empty, offline, read-only, disabled, success and error states MUST be deliberately designed.

Explanatory copy SHOULD be short and task-specific. Security limitations and consequential destructive behavior MUST remain available without filling everyday workflows with technical narrative.

## 9. Implementation baseline and possibilities

| Area | Current direction | Future possibility and decision boundary |
| --- | --- | --- |
| Firmware | ESP-IDF and C++17; a shared application (`firmware/app/`) with board-specific drivers behind shared protocol/service boundaries | Additional boards require validated hardware profiles, resource budgets and physical qualification |
| Web agent | TypeScript, Vite, native DOM, shared agent core and Web Serial | A UI framework is optional only when justified by maintainability; it is not a product requirement |
| Transport | Capability-negotiated device connection over USB, or Bluetooth with physical-access pairing (D47) | Mobile apps use this same contract and are built outside this repository (D48). Native desktop and simultaneous multi-device agents require separately approved contracts |
| Cryptography | Agent-side XChaCha20-Poly1305 group-key envelope; Argon2id for protected local key storage | Pairwise keys and sender authentication are designed in D50 and still require independent review |
| Location | Explicit fixed position; GPS acquisition deferred | GPS requires verified wiring, power, bounded parsing and freshness rules before inclusion |
| Portal extensions | Declarative JSON plugins (manifest v1) for map item types, fields and settings | Code plugins such as Weather Radar, Reaper ADS-B and APRS bridges run in sandboxed iframes (D40) after the plugin API and permissions design is approved |
| Regional operation | Initial US hardware and profile | EU or other regions require intended-country, hardware and regulatory validation before transmission |
| Distribution | Validated local firmware tooling and retained provenance | Public signing, authenticated releases and automatic rollback require dedicated hardening |

These possibilities are not approved implementation work. Broad telemetry, MQTT/cloud infrastructure, voice and remote administration remain outside current scope unless explicitly adopted.

## 10. Current quantitative baseline

| Property | Current baseline | Interpretation |
| --- | --- | --- |
| Supported development boards | Heltec WiFi LoRa 32 V3; LILYGO T-Beam V1.2 | Confirmed US/915 development units; not every board revision or regional variant |
| Web device connections | One at a time | CLI pair testing is not simultaneous-device browser support |
| Logical channels | Eight numeric slots | Shared radio profile; names do not create independent frequencies |
| Plaintext message payload | Up to 1,024 UTF-8 bytes | Capacity bound, not a throughput guarantee |
| Encrypted text payload | Up to 950 UTF-8 bytes | Current 1,024-byte envelope limit includes 74 bytes of overhead |
| Radio preset | `US915_LAB1`: 915 MHz, 500 kHz bandwidth, spreading factor 7, low, medium or high transmit power (default medium, at most +22 dBm) | A short-range lab preset tuned for speed; range results describe this preset only |
| Airtime budget | 1% refill with a one-second burst, shared by original, relay, retry and ACK traffic | About one full 1,024-byte message per node per minute after the first burst; a project courtesy limit, not a regulatory claim |
| Discovery node snapshot | Up to 32 retained device entries | Observed cache, not a complete inventory or online roster |
| Local retained histories | Bounded; the browser keeps a rolling 160-entry sent history, at most 32 unresolved operations, within a 1 MiB journal | Detailed limits remain in the referenced contracts |
| Map workspace | Up to 512 local items, 1,024 shared item records and 16 plugins, within 2 MiB | Browser-local; not synchronized between agents |
| Radio range, battery life and network throughput | Not established as product guarantees | Require documented measurements under specified conditions |

Exact wire layouts, timing constants and storage bounds belong in the detailed references. Changing a baseline requires updating its contract, generated artifacts where applicable, tests and this specification when the product commitment changes.

## 11. Verification and release acceptance

A feature is ready only when its implementation, security boundaries, error behavior, UX and relevant tests agree. Evidence MUST distinguish host tests, compiler-backed tests, target builds, browser checks and actual hardware observations.

Required verification includes:

1. Static checking, generated-binding verification, compatibility fixtures, behavioral tests and the web production build.
2. Deterministic failure and recovery tests for communications or persistence changes.
3. Browser workflow and responsive-layout checks for UI changes.
4. Target builds and physical checks for affected board/radio behavior.
5. Recorded remaining limitations and an explicit release decision.

Recorded evidence includes direct two-board messaging, destination acknowledgments, discovery, fixed-position behavior and initial encrypted direct exchanges. Three-board relay, extended coexistence/range/soak, arbitrary power interruption, interrupted updates and broader security review remain release qualification work; the procedures are in the [field qualification plan](../contributing/field-qualification.md). Existing hardware evidence MUST NOT be expanded into untested claims.

The present project is a development prototype, not a production-qualified public release. A phase milestone alone does not change that status.

## 12. Open decisions and ownership

Open and parked questions, and the event that reopens each parked one, are maintained in [Decisions](../contributing/decisions.md#open-questions) rather than repeated here.

The project owner approves scope and product commitments. Contributors propose changes with rationale, affected contracts, compatibility implications and verification evidence. Candidate ideas MUST remain labeled until approved.

## 13. Maintenance and reference hierarchy

Once approved, this document is the high-level product baseline: vision, use cases, phases and cross-system requirements. Each other kind of information has one home:

| Information | Canonical document |
| --- | --- |
| Product priorities and phase order | [Roadmap](roadmap.md) |
| What is implemented and verified now; installed firmware | [Status](status.md) |
| Dated hardware and test evidence | [Changelog](changelog.md) |
| Decisions and open questions | [Decisions](../contributing/decisions.md) |
| Architecture and engineering standards | [Development plan](../contributing/plan.md) |
| Exact wire, storage and recovery contracts | [Protocol](../reference/protocol.md), [radio protocol](../reference/radio-protocol.md), [messaging](../reference/messaging.md), [persistence](../reference/persistence.md), [compatibility](../reference/compatibility.md) |
| Phase 2 requirements and acceptance | [Phase 2 contract](../contributing/phase-2.md) |
| Relay, range, power-loss and soak test procedures | [Field qualification plan](../contributing/field-qualification.md) |
| Shared map item and plugin contracts | [Shared map items](../reference/map-sharing.md), [plugins](../guides/plugins.md) |
| Contributor working rules | [AI.md](../../AI.md) |

Conflicts MUST be resolved explicitly rather than by silently changing a protocol or treating an old paragraph as current intent. Until this draft is approved, the latest explicit owner decisions and existing approved contracts take precedence.
