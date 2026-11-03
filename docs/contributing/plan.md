# Development plan and architecture

This document describes how Reaper Mesh is built and the engineering standards it follows. It
does not track progress: see [Status](../overview/status.md) for what works now, the
[Roadmap](../overview/roadmap.md) for priorities, and the [Changelog](../overview/changelog.md)
for dated evidence.

## Product boundary

Reliable text messaging and device configuration through a small USB web agent, backed by custom
firmware on supported LoRa boards. The firmware and protocol core stays small and stable, and new
features are built in agents and plugins (D41); before core v1, breaking changes are allowed with
owner approval (D42). No cloud service is required. BLE, mobile and native agents,
additional boards and EU operation are later, separately scoped work.

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
| `agents/web/` | Browser portal (TypeScript, Vite, native DOM, Leaflet). `main.ts` wires the UI modules and runs the render loop; `app-state.ts` holds shared state and the render hook; one `*-ui.ts` module per area: `connection`, `messages`, `map`, `settings`, `channels`, `access`. Static markup lives in `index.html`, including `<template>` elements that `map-workspace.ts` clones |
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
TLV; see [Decisions](decisions.md) for the open question of TLV versus Protocol Buffers before a
public release.

Desktop USB uses Web Serial in a supported Chromium browser, with explicit port selection and a
secure context (HTTPS or localhost). Do not promise all browsers or mobile USB. Keep the
transport interface suitable for BLE later without implementing BLE now.

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
- A dual-slot application update path with self-test and automatic rollback, tested against
  interrupted transfers, power loss, wrong-board or corrupt images, full storage, failed
  migrations and older-agent/newer-firmware combinations. Whole-flash ROM writes do not get
  rollback guarantees.
- Authenticated release manifests and images, and trust-key distribution. Checksums alone do not
  authenticate firmware. Do not burn secure-boot or anti-rollback eFuses during development.
- Transactional configuration migration, including what happens when downgraded firmware cannot
  read a newer schema.

Release artifacts carry a board-specific manifest with firmware version, USB and radio protocol
ranges, config schema, size, hash, toolchain and release notes.

## Engineering milestones (historical)

These milestones organized the early engineering work. The owner's product phases in the
[Roadmap](../overview/roadmap.md) now set priorities; the release-hardening gates in M5 still
apply.

| Milestone | Deliverable | Acceptance gate |
| --- | --- | --- |
| M0: foundations | Hardware and region confirmed, dependencies chosen, first schemas and compatibility policy, reproducible toolchains and CI | Reviewed protocol fixtures and race-test harness run on host |
| M1: USB vertical slice | Firmware handshake, status and config storage; web connect/status/config UI | One board connects, reconnects safely, persists config, rejects incompatible peers and stale revisions |
| M2: message model | Agent send/history/status with simulated peers and bounded firmware queues | Duplicate, retry and loss cases converge or report unknown |
| M3: radio and mesh | Regional preset, public channel, fragmentation, unicast ACK, forwarding | Simulator topology suite passes; real two-node and three-node gates recorded separately |
| M4: channels and release UX | Named channels, roles, transmit power; guided installer and recovery | Channel semantics documented; region enforcement and update interruption tested |
| M5: release hardening | Resource and airtime measurements, soak tests, signed releases, published support policy | No unresolved release-critical race faults; remaining hardware gaps block related claims |

## Evidence standard

Each piece of hardware evidence in the [Changelog](../overview/changelog.md) records what ran,
against which firmware and agent versions, which simulation seed or hardware, the result and the
remaining limits. Track firmware size, peak RAM, queue and reassembly capacity, latency, retry
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
