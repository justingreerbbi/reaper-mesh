# Reaper Mesh — Project Specification and Vision

| Document control | Value |
| --- | --- |
| Status | Draft for owner review; not an approved release standard |
| Version | 0.1 |
| Date | November 2, 2026 |
| Scope | Project vision, product phases, system requirements and implementation direction |
| Authority | Proposed project baseline; existing approved protocol contracts remain authoritative until explicitly revised |

## 1. Purpose and upstream intent

Reaper Mesh is an independent, locally operated LoRa messaging and situational-awareness system. Its purpose is to let people exchange short messages, identify participating nodes and view deliberately shared positions without depending on a cloud account or internet connection for radio messaging.

The upstream intent is a dependable communications platform with understandable behavior: users should know what the system has done, what remains uncertain and how to recover from interruptions. Reliability, privacy choices, compatibility and usability take precedence over feature count.

This specification consolidates the intended product standard. It is not a claim that every requirement is implemented or qualified. It introduces no new authorization to transmit, flash hardware, publish software or enable deferred features.

### 1.1 Intended outcomes

- Reliable local and direct radio messaging with explicit delivery outcomes.
- Simple channel creation and management, with optional agent-side message encryption.
- Discovery and asset views based on observed information rather than assumed connectivity.
- Local ownership of configuration, channel keys and agent history.
- Predictable operation during disconnection, reboot, packet loss and partial failure.
- A polished web interface that presents everyday actions directly and keeps technical diagnostics secondary.

### 1.2 Product boundaries

Reaper Mesh is not currently specified as a safety-critical emergency service, a guaranteed-delivery network, a high-bandwidth transport or an anonymous communications system. Candidate field uses do not establish suitability for life-safety decisions.

The project uses an independent Reaper Mesh protocol. Interoperability with Meshtastic or another mesh protocol is not an established requirement. Licensing and public distribution terms remain owner decisions.

## 2. Users and use cases

| User or setting                              | Intended workflow                                           | Required system behavior                                                                    |
| -------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Individual operator                          | Connect a node, inspect its state and exchange messages     | Clear connection state, retained drafts and truthful delivery outcomes                      |
| Small field teamSearch & RescueOverlanders | Use a common channel to coordinate activity                 | Matching channel numbers, explicit encryption policy and deliberate shared-key distribution |
| Camp, event or temporary work area           | Discover participating nodes and send channel broadcasts    | Bounded discovery traffic; no assumption that a missing reply means offline                 |
| Asset or position observer                   | Inspect the last reported location of a node and contact it | Consistent map/list selection, location source and age, usable unlocated nodes              |
| Privacy-conscious operator                   | Protect locally saved keys or remove local app data         | Optional app PIN, understandable protection state and confirmed local wipe                  |
| Maintainer                                   | Configure, update and troubleshoot supported hardware       | Capability checks, compatible migrations, reproducible builds and recovery evidence         |

These are intended applications and evaluation scenarios, not performance or deployment guarantees. Range, capacity, battery endurance and interference tolerance require measured evidence for the selected hardware and environment.

## 3. System model and responsibilities

| Layer | Responsibility | Boundary |
| --- | --- | --- |
| Web portal | Messaging, assets, channel management, key provisioning and local privacy controls | Must not imply browser preferences are device-wide policy |
| Shared agent core | Negotiation, state synchronization, command lifecycle, messaging and recovery | Transport-independent behavior with explicit connection/session context |
| Device firmware | Authoritative persisted device settings, bounded queues, radio operation and inbox retention | Does not receive channel encryption keys or the app PIN |
| Radio network | Carry bounded message fragments, acknowledgments and discovery reports | Delivery and observations are constrained by airtime, loss and topology |
| Local browser storage | Agent journals, message metadata, encryption policies and key records | Scoped to browser origin/profile; separate from device storage |
| Build and update tooling | Validate target, schema, provenance, images and installation outcomes | Hardware qualification cannot be inferred from host tests |

The initial agent supports one connected USB node at a time. Simultaneous multi-device browser operation requires separately designed device-scoped journals, ownership and selection behavior.

### 3.1 Terminology

- **Node:** a supported radio device running Reaper Mesh firmware.
- **Agent:** software connected to a node; currently the desktop browser portal.
- **Channel:** a numbered logical messaging group sharing the configured radio profile.
- **Direct message:** a message routed to a specific node; not necessarily pairwise-private.
- **Observed asset:** a node heard by the system, possibly with a last-known reported position.
- **RACE:** the project's synchronization and recovery discipline; not a separate framework.

## 4. Product phases

Phase completion records product milestones. It does not waive outstanding security, hardware or release gates. Work from a later phase may be implemented before all qualification for an earlier phase is complete.

| Phase | Intended outcome | Current baseline | Acceptance direction |
| --- | --- | --- | --- |
| 1 — Working communications | Supported nodes exchange messages through the independent protocol | Owner marks complete; two-board direct RF, destination ACK and inbox behavior have recorded evidence | Preserve configuration authority, compatibility, bounded transport and recovery; qualify three-node relay separately |
| 2 — Discovery and field portal | Operators discover nodes, inspect shared positions and communicate through a usable portal | Active; discovery and fixed-position slices have hardware evidence; messaging/asset portal is implemented and being refined | Complete end-to-end portal workflows, privacy controls, reconnect behavior and hardware/browser checks; GPS is explicitly deferred |
| 3 — Encrypted channels | Agents encrypt message bodies while devices route ciphertext | Initial group-key implementation exists; direct encrypted exchanges on Heltec/T-Beam have recorded evidence | Validate key transfer/rotation, tamper/replay handling, no plaintext downgrade and interrupted encrypted upload recovery; independent security review remains outstanding |
| 4 — Device presentation and power visibility | Clear on-device status and supported power information | Planned; existing OLED support is not completion of this phase | Define screen management, sleep/wake, RX/TX indication and measured battery reporting with unknown/unsupported states |

The current priority is the messaging and asset portal, channel/key usability and agent privacy. GPS acquisition is not the next automatic task.

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
- Creating or importing a key MUST NOT send that key to firmware or over the radio. Sharing keys with other agents MUST be deliberate.
- An agent requiring encryption MUST fail closed when the key is absent or unavailable. It MUST NOT silently send plaintext instead.
- Rotation MUST retain the ability to decrypt retained older epochs locally where supported and require deliberate distribution of the new key.
- Direct routes currently use the selected channel's group key. The UI and documentation MUST NOT describe this as pairwise privacy or individual sender authentication.

### 5.4 Discovery, positions and assets

- Automatic beacons, discovery responses and location sharing MUST be independent opt-in policies.
- Manual discovery MUST use bounded request/reply behavior, cooldowns and reply scheduling. A missing response is inconclusive.
- Location MUST distinguish missing, fixed, GPS and unavailable/stale data as capabilities evolve. Geographic zero coordinates are valid.
- Position sharing MUST be explicitly enabled. Stored coordinates or installed GPS hardware alone MUST NOT cause disclosure.
- Disabling sharing MUST stop future eligible reports; it cannot erase previously received peer data or recall an in-flight transmission.
- Map markers and node-list selection MUST agree. Nodes without locations MUST remain usable for supported messaging workflows.
- Tile/network failure MUST NOT disable messaging or fabricate node positions. Last-known data MUST remain distinguishable from current observations.

### 5.5 Optional local PIN

- PIN protection MUST be optional and off by default for a new agent profile.
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

Protocol changes MUST use negotiated versions/capabilities, generated bindings and preserved compatibility fixtures. Frozen fixtures MUST NOT be silently refreshed. New synchronization behavior requires deterministic race/recovery tests, including delayed, duplicated, missing and out-of-order information.

## 7. Security, privacy and trust

External input, radio observations, browser storage, configuration files and connected-device responses MUST be validated for their current use. Parsers, memory and storage MUST be bounded. UI output MUST be escaped for its context; errors and logs MUST not expose secrets.

The current channel design protects message bodies using shared group keys. It does not provide individual sender authentication, forward secrecy, metadata anonymity or protection from a compromised unlocked agent. Discovery and position information are not implicitly protected by channel message encryption. Device acknowledgments confirm transport behavior, not successful decryption.

No cloud account is required for core operation. Map tiles may require a network and disclose ordinary network requests to a tile provider; local radio messages and history MUST NOT be uploaded as a side effect of portal operation.

## 8. User experience and design standard

The portal SHOULD use a restrained dark technical visual language with legible text, consistent spacing and clear status. Messages and assets are primary workflows; configuration and diagnostics are secondary.

Every action MUST have one clear place in the interface. Existing channels SHOULD appear as a list or contextual submenu; empty capacity MUST be represented by Create channel rather than a grid of blank inputs. Selected-channel editing MAY use a separate dialog or view. Settings dialogs MUST stay anchored as sections change, grow within the available viewport and scroll internally when required.

Controls MUST support keyboard operation, visible focus and meaningful labels. Forms MUST provide actionable validation. Layouts MUST accommodate common desktop and narrow-screen sizes without hiding essential actions. Loading, empty, offline, read-only, disabled, success and error states MUST be deliberately designed.

Explanatory copy SHOULD be short and task-specific. Security limitations and consequential destructive behavior MUST remain available without filling everyday workflows with technical narrative.

## 9. Implementation baseline and possibilities

| Area | Current direction | Future possibility and decision boundary |
| --- | --- | --- |
| Firmware | ESP-IDF and C++17; board-specific drivers behind shared protocol/service boundaries | Additional boards require validated hardware profiles, resource budgets and physical qualification |
| Web agent | TypeScript, Vite, native DOM, shared agent core and Web Serial | A UI framework is optional only when justified by maintainability; it is not a product requirement |
| Transport | USB-first, capability-negotiated device connection | BLE, mobile/native and simultaneous multi-device agents require separately approved contracts |
| Cryptography | Agent-side XChaCha20-Poly1305 group-key envelope; Argon2id for protected local key storage | Pairwise keys and sender authentication require protocol/security design and review |
| Location | Explicit fixed position; GPS acquisition deferred | GPS requires verified wiring, power, bounded parsing and freshness rules before inclusion |
| Portal extensions | No implemented extension framework | Weather Radar, Reaper ADS-B and APRS bridges are candidate integrations; define permissions, isolation and data boundaries first |
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
| Discovery node snapshot | Up to 32 retained device entries | Observed cache, not a complete inventory or online roster |
| Local retained histories | Bounded; the browser keeps a rolling 160-entry sent history, at most 32 unresolved operations, within a 1 MiB journal | Detailed limits remain in the referenced contracts |
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

Recorded evidence includes direct two-board messaging, destination acknowledgments, discovery, fixed-position behavior and initial encrypted direct exchanges. Three-board relay, extended coexistence/range/soak, arbitrary power interruption, interrupted updates and broader security review remain release qualification work. Existing hardware evidence MUST NOT be expanded into untested claims.

The present project is a development prototype, not a production-qualified public release. A phase milestone alone does not change that status.

## 12. Open decisions and ownership

The maintained list of open questions is in [Decisions](../contributing/decisions.md#open-questions).

| Decision | Required before |
| --- | --- |
| Approval and precedence of this specification | Treating draft requirements as the governing project standard |
| Licensing and public distribution terms | General distribution and new dependency reuse decisions |
| Formal performance targets and deployment envelope | Publishing range, throughput, scale or battery-life commitments |
| Three-node relay and field qualification plan | Claiming physically qualified mesh forwarding |
| GPS scope and acquisition requirements | Resuming GPS implementation |
| Stronger identity or pairwise confidentiality | Expanding current group-key security claims |
| Public update signing, rollback and recovery policy | Production automatic updates |
| Extension permissions and isolation | Building or enabling third-party portal plugins |
| Multi-device and broader regional/agent support | Enabling those capabilities |
| Stable-release support and data migration policy | A supported public release |

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
| Contributor working rules | [AI.md](../../AI.md) |

Conflicts MUST be resolved explicitly rather than by silently changing a protocol or treating an old paragraph as current intent. Until this draft is approved, the latest explicit owner decisions and existing approved contracts take precedence.
