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
| Q1 | Approve, revise or reject the draft [project specification](../overview/project-specification.md) as the governing baseline | Treating it as authoritative over other docs | Draft 0.3 reviewed against current docs and code on November 7; awaiting owner approval |

## Parked questions

These cannot be answered yet. Each waits on a specific trigger; revisit it then.

| # | Question | Revisit when |
| --- | --- | --- |
| Q3 | Is 1,024 bytes the right message cap? Each fragment carries 58 bytes of overhead for 160 bytes of payload (about 27% of the frame), and a full message is 7 fragments | After the outdoor range test in the [field qualification plan](field-qualification.md), from measured airtime and delivery rates |
| Q5 | Define the application payload type for core v1: typed payloads that firmware carries, relays and acknowledges without understanding them, so features such as map items live in agents and older agents ignore unknown types (D39, D41). Includes a compact encoding for map items, replacing `RMAP1` JSON in text | Firmware carrying bytes it does not understand was built for D50 step 1. The content types and map encoding stay for the core v1 protocol review, together with Q3 |
| Q7 | GPS scope: acquisition requirements, fix freshness threshold and T-Beam wiring verification | When the owner resumes GPS work (D26) |
| Q8 | Formal performance targets (range, throughput, battery), set from the [field qualification plan](field-qualification.md) results | After field qualification, before publishing any range, throughput or battery figures |
| Q9 | EU countries and bands | When EU hardware or operation is planned (D3) |
| Q10 | Signed releases, rollback and stable-release support policy. D50 sets the direction: signed dual-slot updates, flash encryption and Secure Boot V2 on release builds | Before the first public release or public updater |

Resolved: Q2 → D6 (Apache-2.0), Q4 → D38 (keep TLV), Q6 → D40 (sandboxed code plugins), Q11 → D45 (channel IDs), Q12 → D50 (security architecture), Q13 → D52 (rotation and rekey design).

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
Applied November 3 starting at `v0.1.0` (`tbeam-reaper-mesh-v0.1.0`, `heltec-reaper-mesh-v0.1.0`);
0.x marks pre-release builds until core v1 (D42). Firmware IDs use the protocol's `version`
field kind, which allows `.`.

### D41. Stable core, extensible edges
Nov 3 · **Confirmed**. Reaper Mesh is built for organizations that need stability. The core
(firmware and the radio and USB protocols) stays small: messaging with acknowledgments, relay,
discovery, positions, channels and a way to carry application data it does not understand. New
features go in agents and plugins, so boards rarely need firmware updates and agents keep
working with installed firmware. This contrasts with mass-market mesh projects that keep adding
requested features to the firmware core, forcing frequent firmware and app updates. A firmware
or protocol change needs a stated reason why an agent or plugin cannot do it. Optional
board-local features (screen, battery display) must not change the radio protocol. See the
[specification](../overview/project-specification.md#13-stable-core-extensible-edges).

### D42. No compatibility promise before core v1
Nov 3 · **Confirmed**. The project is in active development, used only by its maintainer and not
deployed. Until core v1, the owner may approve breaking changes to the protocols or storage
formats when they simplify the core, instead of keeping compatibility layers for earlier
prototype builds; boards are reflashed as needed. Fixtures still pin current behavior and are
only changed deliberately, with owner approval. At core v1 the formats are frozen, fixtures are
reset to that baseline, and full compatibility rules apply. See the
[specification](../overview/project-specification.md#14-project-stage).

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
protocol and state machines. Only verified AXP2101 radio-rail bits are changed, plus the
power-key short-press interrupt bits used by the screen (D44). Battery and USB power state are
read from the AXP2101 without writing (D44). The ESP32 ROM
lacks `get_security_info`, so security eFuses are read (never written) before flashing.

### D15. OLED status display
Nov 1 · **Adopted**; the status rows were replaced by the screen pages in D44. A first-party, bounded I2C driver and font (no third-party display library),
outside protocol state. Display failures disable the display without blocking USB.

### D16. Firmware installation
Nov 1 · **Adopted**; [D50](#d50-trusted-device-security-model) keeps this for development and makes
signed dual-slot updates the field route. A manifest-validating ROM serial updater that checks provenance, target,
layout, hashes and ROM security state, stages immutable images and preserves NVS. A single
factory app with no rollback is the prototype recovery route. Signed releases and rollback are
open (Q10). See [flashing firmware](../guides/flashing-firmware.md). Since `v0.8.0` the partition
table has two application slots and the application runs from the first; nothing writes the second
slot yet, so there is still no rollback.

### D44. Device screen and buttons
Nov 3 · **Confirmed**. Phase 4 step 1, owner-directed while waiting for a third board. Every
board has one main button that reaches every screen function: single press toggles the screen,
double press goes to the next page, long press returns to the main page. Extra buttons only add
shortcuts; the T-Beam PWR short press goes to the next page through the AXP2101 power-key
interrupt (enable INTEN2 `0x41` bit 3, poll and clear INTSTS2 `0x49` bit 3), the only power-chip
change beyond the radio rail. The screen shows a startup icon and title, then a main page
(device name, radio RX/TX/OFF/FAULT, new-message count, nodes heard, small version), a nodes
page and a debug page. There is no message page and no message text on the device. The screen
turns off after 30 seconds by default.

Nov 3 update (steps 3 and 5): the screen timeout and wake-on-message are device settings, set
from the portal's Screen tab; there is no settings page on the device. They are stored in the
device configuration (record 5, `screenVersion` 1) because the device must apply them with no
agent connected, which an agent or plugin cannot do (D41). The top-right corner of the main page
shows the battery percent and a bolt when plugged in, or the bolt and `USB` with no battery
(owner direction: plugged-in state must show even without a battery), only when measured: the
T-Beam reads its AXP2101 without writing; the Heltec shows nothing until its battery input is
verified. Since `v0.6.1` the Heltec shows a measured battery-rail voltage and icon.
These features never change the radio protocol (D41). See
[device screen and buttons](../reference/device-display.md).

### D53. Status LED with an on/off setting
Nov 7 · **Confirmed**. Owner direction, Phase 4. One LED gives a short pulse on radio activity and a
slow blink while messages wait, cleared by a button press or an attached agent. The owner chose an
on/off setting in the portal, on by default, because a lit LED can give away a radio's position and
uses battery. It is a device setting because the LED must follow it with no agent connected, which an
agent or plugin cannot do (D41). This is an owner-approved exception to the pause on portal features
(D37), and it changes no radio frame. `ledEnabled` is additive and storage adds record 8. See
[device screen and buttons](../reference/device-display.md#status-led).

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
Nov 1 · **Adopted**; [D50](#d50-trusted-device-security-model) replaced the frame layout with radio
version 2 (58 bytes of overhead, no CRC-32). An independent radio frame with a 54-byte header and CRC, up to 160 payload
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
Nov 1 · **Adopted**; [D50](#d50-trusted-device-security-model) will also require an attached agent
for beacons and replies, and move them under the team key. A separate control namespace, so text/ACK bytes are unchanged. Beacons,
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

### D50. Trusted-device security model
Nov 4 · **Confirmed** by the owner, with all six recommendations accepted (closes Q12). Not yet
built, so existing behavior stands until each step ships. Four key layers: a relay key on every radio that admits and forwards team frames without reading them; a
team key that agents load into their radio's memory, protecting headers, beacons and ACKs; channel
keys on agents; and pairwise direct-message keys on agents using Noise pattern K. A radio with no
agent attached is a relay and sends nothing of its own (owner direction). Trust starts from
in-person setup by a team authority, with optional deputies and a sealed backup; losing the authority
freezes membership and does not stop communications. Keys rotate automatically with a hash ratchet,
and removing a member needs an explicit rekey. Open operation stays available with today's channel
keys and the same frame format, and a radio stays silent until a mode is chosen. A small firmware
alert lets a backgrounded mobile app learn of new messages. Amends D16, D24, D33, D34, D45 and D47
as each step ships, and sets the direction for Q5 and Q10. The new radio format comes before field
qualification (D37 otherwise stands). An independent security review is still outstanding. See
[Security architecture](security-architecture.md).

### D51. Team setup in the portal before field qualification
Nov 4 · **Confirmed**. Owner direction: the owner tests through the web app, so team setup cannot wait behind D37, and test tools are not the way to use it. This is an exception to the pause on portal features, like D49. The portal's Radio network page creates or joins a team by an `RMTEAM1` QR code, adds a radio as a member or relay, and reloads the team key when a radio needs it. It needs no firmware change. This first version has no roster, deputies, rotation or member removal, so anyone with the code can join, and removing someone means creating a new team. A missing PIN only shows a warning for now, although D50 calls for requiring one in team mode. See the [web portal guide](../guides/web-portal.md).

### D52. Rotation and rekey design
Nov 5 · **Confirmed** by the owner, with all five recommendations accepted (closes Q13). Rotation (2a) is built in `v0.10.0`, and rekey and relay status (2b) are not. It has had no independent security review. Amends D50 for relays: a radio holding only the relay key forwards frames within an epoch window but erases old keys only on an epoch proof, a value from a one-way chain that agents hold and a relay key cannot produce, because a stolen relay key could otherwise strand relays. A flagged network frame carries proofs, rekeys and relay status to radios with no team key. Until step 4, a rekey reaches only the radios the issuing browser filled, and the portal calls it **Replace relay key**, because it locks out a radio and not a person. The rotation half (2a) is built before the three-node relay test so that test covers epoch changes, and rekey and status (2b) follow it, which changes the roadmap's order. Portal controls for this work are an exception to D37, like D49 and D51. The rotation interval is limited to between 6 hours and 7 days. See the [rotation and rekey design](rotation-design.md).

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
Nov 2 · **Adopted**; **superseded in part by [D50](#d50-trusted-device-security-model)** once built:
radios will hold a relay key and, in memory, a team key, while channel and direct keys stay off radios. XChaCha20-Poly1305 envelopes created in the agent; devices carry
ciphertext only and never see keys. Direct messages use the channel group key: not pairwise
private, members can forge, no forward secrecy. Plaintext stays the default unless an agent
requires encryption on a channel. See [channel encryption](../guides/encryption.md).

### D34. Optional browser PIN and local wipe
Nov 2 · **Confirmed**; [D50](#d50-trusted-device-security-model) will require the PIN in team mode
and stay optional in Open mode. Supersedes the per-key vault screen. An optional, off-by-default 4–6
digit PIN unlocks all keys in this browser; it does not authenticate a device. A typed-`WIPE`
reset deletes this browser's local data only.

### D35. Map sharing over text messages
Nov 2 · **Adopted** (see D39). Map points and rectangles are shared as validated `RMAP1` JSON in
ordinary text messages, with no firmware or schema change. Recipients approve items from the
message card, or opt in to per-channel auto-add (D43). See [shared map items](../reference/map-sharing.md).

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

### D43. Per-channel auto-add for shared map items
Nov 3 · **Confirmed**; implementation planned after field qualification (D37). Each channel gets
an agent-local **Auto-add shared map items** setting, off by default. When on, valid items,
updates and removals received on that channel apply to the map without a prompt, so every agent
following the channel keeps the sender's latest version; message cards still show what changed.
Rules:

- Only the original sender of an item can update or remove it; others copy it and share their
  own version.
- Available only on channels where the agent requires encryption and holds the key, because
  senders on unencrypted channels, including Public, are not authenticated. Turning off
  required encryption turns auto-add off. Group keys still cannot prove which member sent an
  item, and the setting says so.
- Locally removed items are not re-added by later updates; those appear as message cards.
- Storage limits apply; when full, new items fall back to message cards.
- Delivery is best effort, with no history synchronization between agents.

Sharing also changes: the user must pick the channel explicitly, with no preselected channel.
See the [specification, section 5.4.1](../overview/project-specification.md#541-shared-map-items-and-plugins).

### D45. Channel identity independent of slot numbers
[D50](#d50-trusted-device-security-model) will encrypt channel IDs on air and relay all frames of a
team; the rest stands. Nov 3 · **Confirmed** (owner chose options 1 and 2 and approved the breaking change before core
v1, D42). Built in firmware `v0.3.0`. A channel was only its slot number (0–7) on air and keys were
tied to slots, so a node joining later had to match everyone's slot layout, and unrelated groups
using the same slot shared a channel.

- **Channel ID on air.** Each channel has a 32-bit ID in the radio header's existing 4-byte
  channel field, so the packet layout did not change. Slots are only where a device stores a
  channel. Public is ID 0; IDs 1–255 are reserved, with 1–7 used for channels converted from
  slot numbers (slot *k* becomes ID *k*) so upgraded boards keep their channels; new channels get
  random IDs of 256 or more. A device admits, relays and receives only channels in its table.
- **Invites.** The web agent shares a channel as an `RMCH1` text bundle with its ID, name and,
  when encrypted, its key; joining puts it in any free slot. The format is versioned JSON and
  ignores unknown fields, so a QR form or more fields can be added later.
- **Consequences.** USB adds a `channelIds` field (capability-gated); storage adds record 6;
  encrypted payloads move to the RME2 envelope with a 4-byte channel ID, and RME1 is no longer
  accepted. The 32-bit width is fixed by the header; widening it later would need a new radio
  version. IDs are visible on air, like slot numbers were, so they are not secret. Removing a
  channel empties its slot and keeps its history and key in the browser, so an invite restores it.
  Public cannot be removed, only reset.

Details: [radio configuration](../reference/radio-configuration.md#channel-ids),
[protocol](../reference/protocol.md#channel-ids-v1-d45),
[persistence](../reference/persistence.md#channel-ids-record-6),
[Channel encryption](../guides/encryption.md#rme2-envelope).

### D49. Web portal follows the mobile app
Nov 4 · **Confirmed**. Owner direction: the portal should look like the Reaper Mesh mobile app and support everything it does, including channels and QR creation. This is an owner-directed exception to the pause on new portal features (D37). It adds no firmware, radio or USB change, and no storage or wire format change, so the field qualification plan is unaffected (D41).

- **Same formats.** QR codes carry the existing `RMCH1` invites and `RMKEY1` bundles (D45), so the app and the portal read each other's codes.
- **Portal features kept.** Search and filters, PIN protection, plugins, recovery tools, renaming a channel and Reset Public have no mobile equivalent and stay.
- **Mobile features adapted.** Following the phone becomes following this browser, with the same limits. Bluetooth scanning becomes the browser's chooser, and USB stays alongside it. Swiping a row becomes a trash button, shown on hover or focus for conversations and always on a touchscreen.
- **Earlier removals reversed.** Following the app brings back deleting a sent message and a conversation, and a way to show a node on the map from its thread, which the portal removed on November 3. The portal keeps its confirmation before deleting all of a conversation's messages, which the app does not ask for.
- **Not carried over.** Orientation lock has no equivalent in a browser tab. Keeping the screen on is not added, because a desktop browser is not mounted on a rig.
- **Rejoin on load** is on by default, as on the phone, and can be turned off. Unlike Bluetooth, opening a USB port can restart a board, so this default is one to revisit after use.
- **New dependencies.** `qrcode-generator`, `jsqr`, `lucide` and `mgrs`, all permissive and with no transitive dependencies. See [third-party notices](third-party-notices.md).

See the [web portal guide](../guides/web-portal.md).

### D48. Mobile apps are built outside this repository
Nov 4 · **Confirmed**. Owner direction. This repository holds firmware, the protocol and the web
portal, and documents how a mobile app connects; it contains no mobile app (D41). See
[Connect a mobile app](../guides/mobile-apps.md). The app's fixes and test results are kept with the
app, so this repository records a phone result only when the owner reports it.

### D47. Bluetooth link with physical-access pairing
Nov 4 · **Confirmed**; [D50](#d50-trusted-device-security-model) requires a cable or a
button-opened window for key fills, built in `v0.8.0`, and will require a host key for sessions on provisioned radios. Owner request, so a mobile app can act as an agent. Bluetooth carries the
same framed bytes as USB, because a phone cannot use USB and no agent or plugin can add a transport
to the device (D41). There is no radio protocol, USB schema or settings record change. The owner
requires that a device is never open to random connections: creating a connection needs physical
access. Owner choices: a 5-second hold on the main button opens pairing and a 15-second hold forgets
all paired devices; Bluetooth stays off until the first pairing and then accepts paired phones only,
with no off switch for now; a paired phone has the same access as USB. Passkey on the device screen
with LE Secure Connections only; at most four paired devices. One host owns the session at a time,
and the newest hello wins. Rotating private addresses are not
implemented, so the fixed random address can be recognized over time. The firmware now runs in its
own task, because Bluetooth reserves early memory on the classic ESP32 and the startup task could not
get a 24 KB stack. See [Bluetooth link](../reference/bluetooth.md).

Nov 4 update (`v0.6.0`): at the owner's request the web portal connects over Web Bluetooth and starts
pairing from Settings. A USB host can now open the window and read the passkey, because a cable is
also physical access; this needs firmware because no agent can open the window otherwise (D41). The
firmware accepts it only on the USB link, so a paired phone cannot admit another device. This also
gives boards without screens a route. USB and Bluetooth share one history in the portal, because they
reach the same device. Safari has no Web Bluetooth and Brave may need it turned on.

### D46. Transmit power levels
Nov 4 · **Confirmed**. Owner request. Transmit power is low, medium or high instead of a dBm number,
because a person choosing power needs the choice and not the radio's scale. Low is the radio's
minimum, high its maximum, medium halfway between them in dBm. The default is medium with boost off.

- **Range.** This replaces the 0–10 dBm development bound with each radio's full range, so the
  Heltec reaches +22 dBm and the T-Beam +17 dBm, or +20 dBm with boost. The limit that remains is
  the airtime budget. Neither is a compliance determination, and output has not been measured.
- **Boost.** Only the SX1276 has it (its high-power mode). It adds about 3 dB at every level rather
  than being a fourth level. The SX1262's receive boost is a different feature and is not used.
- **Firmware, not an agent.** The device owns the radio and the per-board values, so an agent cannot
  do this (D41). The wire carries the level; the dBm stays in the driver.
- **Consequences.** A breaking change approved under D42: `txLevel` replaces `txPower` at the same
  tag, `txBoost` is added, and storage adds record 7. Stored dBm values are not converted, so an
  upgraded board moves to medium, which raises a board that was at 2 dBm.

Details: [radio configuration](../reference/radio-configuration.md#transmit-power),
[protocol](../reference/protocol.md#transmit-power-levels-d46),
[persistence](../reference/persistence.md#transmit-power-levels-record-7).

## Priorities

### D37. Field qualification before new portal features
Nov 3 · **Confirmed**. Pause new portal features until three-node relay and an outdoor range
test pass on real hardware. Portal work is limited to bug fixes and native QA meanwhile. Relay
is the product's core promise and has only been simulated; problems found in the field could
change the radio protocol, which is cheaper before more features depend on it. See the
[field qualification plan](field-qualification.md). D49 is an owner-directed exception. D50 places
the new radio format ahead of these tests, so they describe the frames that ship.
