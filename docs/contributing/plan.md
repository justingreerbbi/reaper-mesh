# Architecture and engineering standards

This document describes how Reaper Mesh is built, the requirements it must meet, and the
engineering standards it follows. It does not track progress: see
[Status](../overview/status.md) for what works now and the [Roadmap](../overview/roadmap.md) for
priorities. For a plain-language overview, start with
[How Reaper Mesh works](../overview/how-it-works.md).

## Product boundary

Reliable text messaging and device configuration through a small web agent over USB or Bluetooth,
backed by custom firmware on supported LoRa boards. The firmware and protocol core stays small and
stable, and new features are built in agents and plugins (D41); before core v1, breaking changes are
allowed with owner approval (D42). No cloud service is required. Mobile apps are built outside this
repository (D48). Native desktop agents, additional boards and EU operation are later, separately
scoped work.

Longer messages consume more airtime and may reduce reliability, so message size, fragment count
and retry behavior need explicit budgets backed by measurements, not just a larger text field.
Old versions should not be supported forever: publish a support window, compatible release
ranges and security advisories, without forcing routine upgrades just to keep communicating.

## Repository layout

| Path | Contents |
| --- | --- |
| `packages/protocol/` | `schema.json` (the single source for USB message types), generated TypeScript bindings, framing, typed config/position/discovery/map/encryption payloads, and frozen fixtures |
| `packages/agent-core/` | Transport-independent agent logic: serial adapter, connection state machine, commands, sync, messaging, inbox and discovery |
| `packages/simulator/` | Simulated devices used by host tests and the portal's Simulator mode |
| `agents/web/` | Browser portal (TypeScript, Vite, native DOM, Leaflet). `main.ts` wires the UI modules and runs the render loop; `app-state.ts` holds shared state and the render hook; one `*-ui.ts` module per area, such as `connection`, `messages`, `map`, `nodes`, `device`, `settings`, `channels`, `network` and `access`. Static markup lives in `index.html`, including `<template>` elements that `map-workspace.ts` clones |
| `firmware/components/` | Portable C++17 firmware components: `reaper_protocol` (codec, generated descriptors), `reaper_device` (session, configuration, messages, inbox, discovery), `reaper_mesh` (radio packets, mesh core, regional profiles, airtime budget), `reaper_radio` (vendored Semtech SX126x driver and first-party SX1276 driver) |
| `firmware/app/` | Shared board application: entry point (`main.cpp`), NVS storage, mesh service, and the `radio_bus.hpp`/`status_display.hpp` interfaces each board implements |
| `firmware/heltec-v3/` | ESP-IDF project for the Heltec V3 (ESP32-S3, SX1262): board profile, radio bus and display implementations, partitions and SDK defaults |
| `firmware/tbeam-v12/` | ESP-IDF project for the T-Beam V1.2 (ESP32, SX1276, AXP2101): the same pieces for that board |
| `examples/` | Working examples, organized by the path of the component they target (for example `examples/agents/web/plugins/field-survey/`). See [examples/README.md](../../examples/README.md) |
| `tools/` | Protocol generator, vendor checks, firmware build/package/update tools and hardware smoke tests |
| `tests/simulator/` | Host test suite, including compiler-backed C++ tests through a codec bridge |

## Architecture

Firmware uses ESP-IDF (pinned in `firmware/esp-idf.lock.json`) and C++17. The board adapter owns
pins, reset and boot behavior, radio access, display, power management and storage. The
embedded core owns scheduling, queues, messages, configuration and forwarding. Board-specific
pin and radio details stay out of the mesh core.

The agent uses TypeScript and Vite with native DOM controls; a UI framework is deferred until
needed. Protocol and recovery logic live in `packages/agent-core/`, not in UI code.

Firmware and agent both consume bindings generated from `packages/protocol/schema.json`.
Hand-maintained duplicate schemas are prohibited. The USB payload encoding is a schema-driven
TLV (D38).

Desktop USB uses Web Serial in a supported Chromium browser, with explicit port selection and a
secure context (HTTPS or localhost). Do not promise all browsers or mobile USB. The
same framed protocol also runs over a [Bluetooth link](../reference/bluetooth.md) for mobile agents
(D47).

## Regional profiles: US first, EU later

Frequency plans, permitted modem settings, transmit power and airtime policies live in versioned
regional profiles, not scattered through routing and UI code. Only the verified US profile is
implemented. Research numeric limits against current authoritative sources when adding each
profile.

Firmware validates the selected profile against the board's band and antenna; agent-side
validation alone is not enough. An unset, unsupported or incompatible profile leaves
transmission disabled while USB configuration stays available. The handshake and configuration
snapshot expose the active profile and its version. Region changes are revision-checked and
quiesce pending transmissions so queued packets never go out under stale settings.

The airtime budget covers fragments, retries, ACKs and forwarded traffic under the active
profile. Host tests use synthetic restrictive profiles; simulation is not evidence of regulatory
compliance. Before enabling EU support, identify target countries and bands, verify compatible
hardware, research the requirements and run region-specific hardware and airtime tests. A US
device cannot be assumed to switch to EU operation through a software setting.

## Protocol and synchronization contract

The exact contract is in [Protocol](../reference/protocol.md) and
[Radio protocol](../reference/radio-protocol.md). The principles:

- The handshake reports device ID, boot/session identity, firmware build, supported protocol
  ranges, capabilities, limits, configuration schema and revision, and the current event
  sequence.
- USB frames have a bounded size, explicit delimiter, integrity check, typed payload, request ID
  and structured errors. Parsers tolerate split, concatenated and corrupt frames and never treat
  debug logs as commands.
- Connection states: disconnected, opening, negotiating, synchronizing, ready, recovering,
  incompatible. Mutations are allowed only when ready.
- Subscribe and snapshot share a sequence boundary. Events around a snapshot are buffered; gaps
  trigger a fresh snapshot. A reboot changes boot identity and invalidates stale replies and
  events.
- Configuration uses compare-and-set revisions and atomic persistence, acknowledged only after
  the write succeeds. A dropped response is resolved by querying, never by overwriting.
- Message sends use stable sender/message identity and bounded retry-safe acceptance. Ambiguity
  after a crash becomes `unknown` until resolved; exactly-once delivery is not promised.
- Radio packets carry network/protocol identity, origin and message ID, destination or channel,
  hop budget and fragment metadata. All metadata is validated before allocating memory.
- Forwarding is bounded managed flooding: randomized forwarding delay, duplicate suppression, hop
  limit, queue limits, expiry and airtime scheduling.
- A unicast destination ACK means the destination fully reassembled and accepted the message, not
  that a person read it. Broadcasts have no all-recipient guarantee, and nodes never ACK every
  broadcast.
- Logical channels are separate from radio frequency and modem settings. They add no RF capacity
  or confidentiality.
- Unknown optional fields stay compatible; unsupported required behavior is rejected explicitly.
  The proposed support window is the current and previous stable agent/device minor versions
  within one major protocol version.

## Product requirements

These requirements apply across the system. **MUST** is mandatory, **SHOULD** is the default
unless an exception is documented, and **MAY** is optional.

### Connection and configuration

- The agent MUST negotiate versions and capabilities before enabling the operations they gate.
- The device MUST stay authoritative for its saved settings, with revision-checked, atomic
  writes. A reconnect MUST read the device's state rather than apply stale browser settings.
- Unsupported, disconnected, read-only and storage-failure states MUST be explicit and
  actionable.
- Channels, regional radio profiles, hardware capabilities and app privacy preferences MUST stay
  separate concerns.

### Messaging

- The system MUST keep queued, transmitted, acknowledged, failed and unknown apart. USB
  acceptance is not delivery, and an acknowledgment is not a read receipt.
- Ambiguous sends MUST NOT be resent automatically after a reconnect or reboot; recovery MUST
  query instead.
- Broadcasts MUST NOT cause acknowledgment storms. Fragments, retries, queues, histories,
  deduplication and reassembly MUST be bounded.
- The UI MUST NOT invent timestamps, ordering, read receipts or connectivity.

### Channels and encryption

- Channel names and slots are device configuration. Encryption policy and keys are app-local and
  MUST be presented that way.
- Creating or importing a key MUST NOT send it to firmware or over the radio. Sharing a key MUST
  be deliberate. (Under D50, a rekey may send a key over the radio only when wrapped to a
  verified member.)
- An app that requires encryption MUST fail closed when the key is missing, never fall back to
  plaintext.
- Direct messages on a shared channel key MUST NOT be described as private or as authenticating
  the sender.

### Discovery and position

- Beacons, discovery replies and location sharing MUST be independent opt-in settings.
- Stored coordinates or GPS hardware alone MUST NOT cause a position to be sent.
- Map markers and the node list MUST agree, and nodes without a position MUST stay usable.
- Map tile failures MUST NOT stop messaging or invent positions.

Detailed rules: [Discovery and position](../reference/discovery.md).

### Shared map items and plugins

- Local map items MUST save without sending anything. Sharing MUST be an explicit action per
  item, to an explicitly chosen channel.
- A shared item belongs to the node that first shared it; only that sender's updates and
  removals apply, and older revisions MUST be rejected.
- Received items MUST NOT change the map until the user accepts them, except on channels with
  the planned per-channel auto-add setting (D43), which MUST be off by default and available only
  on channels where this app requires encryption and holds the key.
- Deleting messages MUST NOT remove accepted map items. Encrypted shared items MUST stay
  ciphertext at rest.
- Plugin manifest v1 is declarative: it MAY add map item types, fields and settings and MUST NOT
  run code, load remote content or send messages. Code plugins MUST run in a sandboxed iframe on
  a separate origin with user-approved permissions and MUST NOT receive channel keys (D40).

### Local privacy

- The app PIN MUST be optional, off by default, local to the browser, and never sent to a
  device. Protected key storage MUST use reviewed password derivation and authenticated
  encryption, with a persisted, bounded unlock cooldown.
- Wipe local data MUST be confirmed, reachable from the lock screen, report failures honestly,
  and MUST NOT claim to erase the device, other browsers or backups.

### Reliability

- Connection, boot, request and revision identity MUST be preserved. Duplicate requests inside
  their window MUST converge on one operation, and anything that cannot be established MUST stay
  unknown.
- Corrupt or unreadable stored state MUST fail closed without formatting or data loss.
- New synchronization behavior requires deterministic race and recovery tests covering delayed,
  duplicated, missing and out-of-order information.

### Security and interface

- All external input (radio, browser storage, files, device replies) MUST be validated and
  bounded. Output MUST be escaped for its context; logs and errors MUST NOT expose secrets.
- Local radio messages and history MUST NOT be uploaded anywhere as a side effect.
- Every action SHOULD have one clear place in the interface. Controls MUST work with the
  keyboard, show focus and have labels. Loading, empty, offline, read-only, error and success
  states MUST be designed deliberately. Messaging and the map come first; diagnostics are
  secondary.

## Verification standard

Use a deterministic simulator with a fake clock, seeded scheduler, virtual radio and serial
transports, and reproducible failure traces. Test the real protocol and state-machine code, not
simulator-only duplicates.

Required race and fault cases include: ACK before timeout handling; timeout and ACK at the same
instant; duplicate requests; a lost response after a durable commit; disconnect during send or
configuration; reboot during handshake or snapshot; delayed events from an old boot; event gaps
during a snapshot; concurrent configuration writes; fragmented, coalesced or corrupt serial
reads; dropped, duplicate, reordered, missing and conflicting radio fragments; relay loops;
queue exhaustion; slow consumers; and retry storms. Assert bounded memory and retries, no stale
overwrites, no duplicate user-visible acceptance inside the deduplication window, and explicit
ambiguous outcomes outside it.

Simulate two- and three-node topologies, including hidden links and asymmetric loss. Keep
old/new protocol fixtures and generated-binding checks in CI. Fuzz parsers and test malformed
input limits.

One physical board can validate USB, local state, flashing and radio initialization. It cannot
establish RF delivery, ACK timing, interference behavior or multi-hop operation. At least two
physical nodes are required for delivery claims and three for relay claims. Keep destructive or
flashing hardware checks explicitly invoked.

## Firmware updates

The current installer is a manifest-validating ROM serial updater (`tools/update-firmware.py`):
it checks build provenance, board target, partition layout, image hashes and ROM security state,
preserves NVS and verifies every write. See [Flashing firmware](../guides/flashing-firmware.md).

Still to design and qualify before a public updater:

- A guided browser installer that shows installed and target versions, offers configuration
  export, and verifies boot identity, version and configuration migration afterward. Keep a
  documented CLI recovery route.
- The dual-slot application update path, with self-test and automatic rollback. The partition
  table already has both slots (`v0.8.0`, D50), and nothing writes the second one yet. Test it against
  interrupted transfers, power loss, wrong-board or corrupt images, full storage, failed
  migrations and older-agent/newer-firmware combinations. Whole-flash ROM writes do not get
  rollback guarantees.
- Authenticated release manifests and images, and trust-key distribution. Checksums alone do not
  authenticate firmware. Do not burn secure-boot or anti-rollback eFuses during development.
- Transactional configuration migration, including what happens when downgraded firmware cannot
  read a newer schema.

Release artifacts carry a board-specific manifest with firmware version, USB and radio protocol
ranges, config schema, size, hash, toolchain and release notes.

## Evidence standard

Hardware evidence goes in the pull request that adds the work, with a short summary in the
[Changelog](../overview/changelog.md). It records what ran, against which firmware and agent
versions, which simulation seed or hardware, the result and the remaining limits. Track firmware size, peak RAM, queue and reassembly capacity, latency, retry
counts and airtime. Define numeric thresholds from measurements before declaring a release ready.

## References checked during planning

- [Heltec V3 product details](https://heltec.org/project/wifi-lora-32-v3/): ESP32-S3 and SX1262
  baseline; verify the actual board variant separately.
- [Web Serial API](https://developer.chrome.com/docs/capabilities/serial): permissions, streams
  and connection lifecycle.
- [ESP-IDF ESP32-S3 OTA](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/system/ota.html):
  partitions, validation and rollback.
- [Meshtastic LoRa configuration](https://meshtastic.org/docs/configuration/radio/lora/):
  terminology reference only, not a Reaper Mesh specification or legal authorization.

Recheck implementation APIs against the exact pinned versions before coding.
