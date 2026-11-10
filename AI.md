# Reaper Mesh: contributor handoff

Reaper Mesh is custom LoRa firmware for the Heltec WiFi LoRa 32 V3 and LILYGO T-Beam V1.2, plus
a browser agent that talks to a node over USB or Bluetooth. It uses its own documented protocol; Meshtastic is
a functional reference only.

## Project principles

- **Stable core, extensible edges (D41).** Reaper Mesh is for organizations that need stability.
  The core (firmware and the radio and USB protocols) stays small: messaging with ACKs, relay,
  discovery, positions, channels and a way to carry application data it does not understand.
  New features go in agents and plugins so boards rarely need firmware updates. Do not add
  features to firmware just because they are requested; a firmware or protocol change needs a
  stated reason why an agent or plugin cannot do it.
- **Not stable yet (D42).** The project is in active development, used only by its maintainer
  and not deployed. Until core v1, breaking protocol or storage changes are allowed with owner
  approval when they simplify the core; propose one instead of adding another compatibility
  layer for an earlier prototype build. Fixtures are still changed only deliberately, never
  silently. Full compatibility rules start at core v1.

See [design principles](docs/overview/how-it-works.md#design-principles) and the
[product requirements](docs/contributing/plan.md#product-requirements).

This file holds current direction and working rules. It is not a log. Do not append test
evidence or history here.

## Where things go

| Question | Canonical document |
| --- | --- |
| What should be built next? | [Roadmap](docs/overview/roadmap.md) |
| What works and is verified right now? What firmware is installed? | [Status](docs/overview/status.md) |
| What changed in each release? | [Changelog](docs/overview/changelog.md) (a short summary per release) |
| What exactly was tested on hardware? | The pull request that made the change |
| Why is it built this way? What is still undecided? | [Decisions](docs/contributing/decisions.md) |
| How is the system put together, and what must it do? | [Architecture and standards](docs/contributing/plan.md) |
| Exact wire, storage and recovery contracts | `docs/reference/` (start with [protocol](docs/reference/protocol.md)) |
| How does it work, in plain language? | [How Reaper Mesh works](docs/overview/how-it-works.md) |
| How do I use it? | `docs/guides/` |

When work finishes: update Status in place, add a short Changelog entry (what changed, what was
verified on hardware, what was not), put detailed evidence in the pull request, add a Decisions
entry if scope or architecture changed, and update the affected guide and reference contract.
Remove finished items from the Roadmap. Say each fact in one place and link to it elsewhere.

Write docs to be understood by a newcomer first and a developer second: plain language and the
"what and why" up front, exact technical detail after it. Keep them simple and short; delete
history rather than letting it pile up, because Git keeps it.

Put examples under `examples/` at the path of the component they target (for example
`examples/agents/web/plugins/<name>/`), one folder per example with a README. See
[examples/README.md](examples/README.md).

Write documentation in plain, complete sentences. Do not drop spaces or articles to save tokens
("Heltec usb-prototype-8, revision 38", not "Heltec8 revision38").

## Current focus (November 8, 2026)

- Field qualification comes first: new portal features are paused until three-node relay and
  an outdoor range test pass on hardware (owner direction, November 3). Portal work is limited
  to bug fixes and native QA. See the
  [field qualification plan](docs/contributing/field-qualification.md). The exceptions are
  keeping the portal in step with the mobile app (D49), team setup (D51), and the portal controls
  for key rotation and rekeying (D52). The third board, a Wireless Stick V3 (D55), is on the bench,
  and the desk relay runs (D56) pass in Open and Team mode; the separated-boards run is next.
- Phase 4 device firmware: the status LED is built as `v0.11.1` (D53, off by default, with an
  owner-approved portal toggle) and works on the boards. The
  device has no settings page; device settings are changed in the portal. See the
  [roadmap](docs/overview/roadmap.md#device-phase-4) and [device screen and buttons](docs/reference/device-display.md).
- The owner approved the [security architecture](docs/contributing/security-architecture.md) (D50).
  Step 1 and step 2a (automatic key rotation, D52) are built and pass on two boards and through a
  relay on a desk, so field
  qualification runs on the frames that ship. Rekey and relay status (2b) follow qualification. See
  the [rotation and rekey design](docs/contributing/rotation-design.md). Existing behavior stands
  until each later step ships, and an independent security review is still open.
- Phase 1 is complete by owner decision. Phase 2 is active; the messaging and map portal (2.3)
  resumes after qualification.
- The website is live at reapermesh.com and the iOS app is live on the App Store. The store
  listings link to the support and privacy pages in `agents/site/`, so keep them true to the app
  (see [Development and CI](docs/contributing/development.md#github-pages)).
- GPS acquisition is deferred by the owner. Do not start it without a new decision.
- Phase 3 encryption has a first implementation; see [Security and privacy](docs/guides/security.md).
- Open release gates stay visible: three-node relay, range, power cut, interrupted flash, soak,
  and native desktop QA of recent portal features. Do not reopen Phase 1 over them, and do not
  claim them.
- Multi-device browser support needs per-device journaling first.

## Engineering rules

- Keep device/agent protocol, radio protocol, config schema and firmware release versions
  separate. Negotiate versions and capabilities before mutations; refuse incompatible operations
  with actionable errors.
- The device is authoritative for persisted configuration. Use revision-checked atomic writes,
  snapshot/event reconciliation, and explicit resynchronization after reboot, reconnect or
  missing events.
- Make commands retry-safe with request IDs, bounded deduplication and boot/session identities.
  Never blindly replay a send after an ambiguous result.
- Keep queued, transmitted, recipient-acknowledged, failed and unknown outcomes distinct. USB
  acceptance and relay forwarding are not end-recipient delivery.
- Bound memory, queues, retries, message size, fragment count, reassembly lifetime and airtime.
  No unbounded flooding or broadcast ACK storms.
- Communications changes need deterministic race and fault-injection tests plus compatibility
  fixtures. Sleep-based tests are not primary evidence.
- Keep transport-independent state out of UI code and board pin/radio details out of the mesh
  core.
- Never hand-edit generated descriptors or silently refresh frozen compatibility fixtures.
- Automatic beaconing, discovery responses and location sharing default off. GPS hardware alone
  never authorizes broadcasting a position.
- Do not add GPS, MQTT, telemetry, Wi-Fi networking, cloud accounts, voice or arbitrary modules
  without a scope decision.
- Prefer agent-side or plugin implementations over firmware changes (D41). Board-local features
  such as screen layout or battery display must not change the radio protocol.
- Check dependency licenses before reuse. Do not copy Meshtastic code.

## Hardware and owner authorizations

- All three bench boards are US/915 MHz with owner-confirmed antennas. Ports and installed builds are in
  [Status](docs/overview/status.md).
- The owner authorized ongoing reversible USB development, testing and firmware installs without
  routine prompts, and waived preserving the factory firmware. Ask before any firmware change in
  portal work.
- Never perform whole-chip erases or eFuse changes. Do not enable EU transmission until
  countries, hardware and settings are verified. Never infer a region from the computer's
  timezone.
- Never invoke the local data wipe against the owner's real browser data to test it.
- Never claim multi-device RF, relay, range or security results from one board or the simulator.
  Record what was not tested.
- Firmware naming: images are `{device}-reaper-mesh-v{semver}` (D8), for example
  `heltec-reaper-mesh-v0.10.0` and `tbeam-reaper-mesh-v0.10.0`, across firmware identification,
  manifests, packages and docs.

## Working process

The owner prefers token-efficient work: targeted reads, CLI checks and automated tests. Use
desktop or browser control only for necessary visual or hardware checks.

Write commits, branch names and pull requests in the format in
[Commits and pull requests](docs/contributing/commits-and-prs.md) (`type(scope): summary`).

Define observable acceptance criteria before coding. Install tools with
`npm ci --ignore-scripts` and run `npm run check` (needs a C++17 compiler). Report what ran,
what passed and what was not verified.
