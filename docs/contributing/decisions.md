# Decisions and open questions

One entry per decision: what was decided, why or with what consequence, and where the detail
lives. Evidence belongs in the [Changelog](../overview/changelog.md). When a decision changes,
mark the old entry **Superseded** and link the new one; do not rewrite history.

Status values: **Confirmed** (owner decision), **Adopted** (implemented engineering choice),
**Proposed** (recommendation awaiting review), **Deferred**, **Superseded**.

## Open questions

Questions that need a decision now:

| # | Question | Needed before | State |
| --- | --- | --- | --- |
| Q1 | Approve, revise or reject the draft [project specification](../overview/project-specification.md) as the governing baseline | Treating it as authoritative over other docs | Draft 0.2 reviewed against current docs and code on November 3; awaiting owner approval |

## Parked questions

These cannot be answered yet. Each waits on a specific trigger; revisit it then.

| # | Question | Revisit when |
| --- | --- | --- |
| Q3 | Is 1,024 bytes the right message cap? Each fragment carries a 54-byte header for 160 bytes of payload (about 25% overhead), and a full message is 7 fragments | After the outdoor range test in the [field qualification plan](field-qualification.md), from measured airtime and delivery rates |
| Q5 | Should shared map items get a message content type and a compact encoding, so older agents stop showing `RMAP1` JSON as chat text? (D39) | Together with Q3, when the radio protocol is reviewed after the range test |
| Q7 | GPS scope: acquisition requirements, fix freshness threshold and T-Beam wiring verification | When the owner resumes GPS work (D26) |
| Q8 | Formal performance targets (range, throughput, battery), set from the [field qualification plan](field-qualification.md) results | After field qualification, before publishing any range, throughput or battery figures |
| Q9 | EU countries and bands | When EU hardware or operation is planned (D3) |
| Q10 | Signed releases, rollback and stable-release support policy | Before the first public release or public updater |

Resolved: Q2 → D6 (Apache-2.0), Q4 → D38 (keep TLV), Q6 → D40 (sandboxed code plugins).

## Product and scope

### D1. Independent protocol
Nov 1 · **Confirmed**. Reaper Mesh uses its own documented protocol. Meshtastic is a functional
reference only: no interoperability and no copied code.

### D2. One monorepo
Nov 1 · **Adopted**. Firmware, protocol schema, agent core and agents live in one repository.
See [plan](plan.md#repository-layout).

### D3. US first, EU later
Nov 1 · **Confirmed**. Develop and operate in the US. Regional profiles exist from the start, but
EU transmission stays disabled until countries, hardware and settings are verified (Q9).

### D4. Owner product phases
Nov 1 · **Confirmed**. Phase 1 working communications (complete), Phase 2 discovery and field
portal (active), Phase 3 encrypted channels, Phase 4 device presentation and power. See the
[roadmap](../overview/roadmap.md).

### D5. RACE means synchronization and recovery
Nov 1 · **Confirmed**. RACE is the discipline of designing and testing device/agent
synchronization and recovery across interrupted connections and concurrent operations. It is not
a framework.

### D6. Apache License 2.0
Nov 3 · **Confirmed** (deferred since Nov 1). First-party code is licensed under Apache-2.0,
for its explicit patent grant, contribution terms and compatibility with ESP-IDF (Apache-2.0),
the Semtech driver (Clear BSD), Leaflet (BSD-2-Clause) and libsodium (ISC). Contributions are
accepted under the same license. Meshtastic remains a functional reference only; its code is not
copied. See [`LICENSE`](../../LICENSE) and [`NOTICE`](../../NOTICE).

### D7. Agent terminology
Nov 2 · **Confirmed**. Software connected to a node is an **agent** (`agents/`,
`packages/agent-core/`). Frozen wire fixtures and storage keys keep their historical names.

### D8. Firmware image naming
Nov 2 · **Confirmed**. On the next firmware change, images are named
`{device}-reaper-mesh-v{semver}` (for example `heltec-reaper-mesh-v8.0.2`) in firmware
identification, manifests, packages and docs. Installed images are not reflashed only to rename.

## Hardware and firmware

### D9. Boards
Nov 1 · **Confirmed**. US/915 MHz Heltec WiFi LoRa 32 V3 (first board), then a US/915 T-Beam
V1.2. Antennas are owner-confirmed. See [hardware](../guides/hardware.md) and
[T-Beam V1.2](../guides/t-beam-v12.md).

### D10. Firmware stack
Nov 1 · **Adopted**. ESP-IDF v5.5.4 (pinned commit in `firmware/esp-idf.lock.json`) with C++17.
One serialized UART session; one NVS blob in its own namespace; storage faults fail closed with
no automatic erase.

### D11. No factory firmware backup
Nov 1 · **Confirmed**. The owner waived preserving the previous firmware and settings. This does
not authorize whole-chip or NVS erases.

### D12. No irreversible eFuse changes in development
Nov 1 · **Confirmed**. Secure boot and anti-rollback need separate design decisions (Q10).

### D13. Radio drivers
Nov 1 · **Adopted**. Vendored Semtech `sx126x_driver` 2.5.0 core (Clear BSD notices retained) for
the SX1262, and a first-party bounded SX1276 driver that verifies chip version and configuration
readback. One airtime budget covers source, relay and ACK traffic. SPI uses DMA; the non-DMA path
is limited to 64 bytes.

### D14. T-Beam target
Nov 1 · **Adopted**. A separate ESP32/4 MB target (bootloader at `0x1000`) reusing the shared
protocol and state machines. Only verified AXP2101 radio-rail bits are changed. The ESP32 ROM
lacks `get_security_info`, so security eFuses are read (never written) before flashing.

### D15. OLED status display
Nov 1 · **Adopted**. A first-party, bounded I2C driver and font (no third-party display library),
outside protocol state. Display failures disable the display without blocking USB.

### D16. Firmware installation
Nov 1 · **Adopted**. A manifest-validating ROM serial updater that checks provenance, target,
layout, hashes and ROM security state, stages immutable images and preserves NVS. A single
factory app with no rollback is the prototype recovery route. Signed releases and rollback are
open (Q10). See [flashing firmware](../guides/flashing-firmware.md).

## Protocol and synchronization

### D17. Device is authoritative for configuration
Nov 1 · **Adopted**. Compare-and-set revisions and atomic persistence; a successful write is
acknowledged only after it is stored; lost replies are resolved by query. See
[persistence](../reference/persistence.md).

### D18. USB framing and encoding
Nov 1 · **Adopted for the prototype**. COBS with a zero delimiter, a versioned header, a
2,048-byte maximum payload and CRC-32; logs on a separate path. Payloads use a schema-driven TLV
with generated TypeScript and C++ descriptors (kept, D38). See [protocol](../reference/protocol.md).

### D19. Request history and recovery
Nov 1 · **Adopted**. Bounded FIFO receipts plus non-evicting per-owner sequence marks.
Reconnect recovery only queries; evicted results stay unknown and can never re-execute. Startup
repeats the same hello at most every 500 ms within a five-second deadline.

### D20. Additive configuration compatibility
Nov 1 · **Adopted**. Config schema 1 gains optional fields and capabilities. Omitted fields
preserve newer settings so older agents can still edit. Storage records 1–4 stay readable; a
newer record is written only when needed. Policy changes quiesce queued messages first.

### D21. Radio frame and mesh
Nov 1 · **Adopted**. An independent radio frame with a 54-byte header and CRC, up to 160 payload
bytes per fragment and 7 fragments per message. Bounded managed flooding with duplicate
suppression and hop limits. TX completion is distinct from destination ACK. See
[radio protocol](../reference/radio-protocol.md) and Q3.

### D22. Channels and relay role
Nov 1 · **Adopted**. Eight logical channel slots share one radio profile; names add no RF
capacity or privacy. Relaying is a per-node setting, separate from channel type.

### D23. Inbox
Nov 1 · **Adopted**. The inbox has its own sequence and cursors, separate from configuration
counters, and reports retention gaps. Local delivery to the connected node is explicit and makes
no RF claim. Inbox v2 (Nov 2) adds the original RF destination so broadcasts stay in channel
threads and direct messages appear in peer threads; v1 remains readable. See
[inbox](../reference/inbox.md).

### D24. Discovery v1
Nov 1 · **Adopted**. A separate control namespace, so text/ACK bytes are unchanged. Beacons,
discovery responses and location sharing are independent settings, all off by default. A
presence reply acknowledges discovery only; replies never trigger replies. Manual requests are
rate-limited with jitter and at most six replies per minute. See
[Phase 2 contract](phase-2.md).

### D25. Fixed position before GPS
Nov 1 · **Adopted**. Saved coordinates as offset fixed-point integers shared by USB, storage and
radio; sharing is opt-in; the computer's location is never used. Position-bearing reports use
control payload v2; manual requests stay name-only v1 so older nodes still respond.

### D26. GPS deferred
Nov 2 · **Confirmed**. T-Beam GPS (Phase 2.2b) is deferred. Fixed positions serve the map. See Q7.

### D38. Keep the schema-driven TLV encoding
Nov 3 · **Confirmed** (closes Q4). The USB protocol keeps its schema-driven TLV encoding, with
TypeScript and C++ descriptors generated from `packages/protocol/schema.json`. It is
implemented, fuzz-tested and pinned by frozen fixtures; moving to Protocol Buffers would need a
new protocol version, new codecs on both sides and a compatibility path for current firmware.
Revisit only if outside agent developers need Protobuf tooling.

## Agent and portal

### D27. Agent stack
Nov 1 · **Adopted**. TypeScript and Vite with native DOM controls and Leaflet for the map; no UI
framework yet. Web Serial in Chromium browsers.

### D28. Browser journal
Nov 1 · **Adopted**. Identity, counters, outcomes, message bodies and inbox are saved to
`localStorage` before any mutation is sent. A Web Lock allows one writer per browser storage
bucket. Reload turns unfinished work into `unknown` and never replays uploads. Corrupt storage is
kept for export until an explicit reset. Message bodies are stored in plaintext locally.

### D29. Sent history separate from recovery budget
Nov 2 · **Adopted**. A rolling 160-entry sent history, separate from the 32-entry limit on
unresolved operations, within a 1 MiB journal.

### D30. Messaging-first portal
Nov 2 · **Confirmed**. Supersedes the earlier light, map-first design. A Signal-style dark
messaging workspace with conversations and threads, a separate map, and settings apart from daily
messaging. No invented read receipts, timestamps, positions or online state. See
[web portal](../guides/web-portal.md).

### D31. Local deletion and unread state
Nov 2 · **Adopted**. Deletion and read state are browser-only and identity-scoped, with bounded
tombstones so deleted messages do not reappear on reconnect. Unread counts are local UX, not
device read receipts.

### D32. Task-first settings
Nov 2 · **Confirmed**. Routine setup first, technical maintenance under *Advanced*, primary
actions beside their section.

### D33. Agent-side channel encryption
Nov 2 · **Adopted**. XChaCha20-Poly1305 envelopes created in the agent; devices carry
ciphertext only and never see keys. Direct messages use the channel group key: not pairwise
private, members can forge, no forward secrecy. Plaintext stays the default unless an agent
requires encryption on a channel. See [channel encryption](../guides/encryption.md).

### D34. Optional browser PIN and local wipe
Nov 2 · **Confirmed**. Supersedes the per-key vault screen. An optional, off-by-default 4–6
digit PIN unlocks all keys in this browser; it does not authenticate a device. A typed-`WIPE`
reset deletes this browser's local data only.

### D35. Map sharing over text messages
Nov 2 · **Adopted** (see D39). Map points and rectangles are shared as validated `RMAP1` JSON in
ordinary text messages, with no firmware or schema change. Recipients approve items from the
message card. See [shared map items](../reference/map-sharing.md).

### D36. Declarative plugins only
Nov 2 · **Adopted**. Plugin manifest v1 is browser-local JSON that adds map item types
and settings. No scripts, HTML, URLs or network access. See [plugins](../guides/plugins.md).
Plugins that run code follow D40.

### D39. Keep RMAP1 map sharing for the prototype
Nov 3 · **Confirmed**. Shared map items stay `RMAP1` JSON inside ordinary text messages, with no
firmware change. Older agents show the JSON as text, which is acceptable while every agent is the
web portal and is updated together. A message content type and compact encoding (Q5) are
reviewed with the message-size question (Q3) after the range test, when the radio protocol may
change anyway.

### D40. Code plugins run in sandboxed iframes
Nov 3 · **Confirmed** (closes Q6). Plugins that run code, such as Weather Radar, ADS-B or an APRS
bridge, run in a sandboxed iframe on a separate origin and talk to the portal only through a
small message API. Their manifest declares the permissions they need (for example network
hosts, node positions or map layers), and the user approves them on install. Plugins never
receive channel keys, and get decrypted message content only through an explicit, separately
approved permission. A short design document covering the message API, permissions and update
review must be approved before any code-plugin implementation.

## Priorities

### D37. Field qualification before new portal features
Nov 3 · **Confirmed**. Pause new portal features until three-node relay and an outdoor range
test pass on real hardware. Portal work is limited to bug fixes and native QA meanwhile. Relay
is the product's core promise and has only been simulated; problems found in the field could
change the radio protocol, which is cheaper before more features depend on it. See the
[field qualification plan](field-qualification.md).
