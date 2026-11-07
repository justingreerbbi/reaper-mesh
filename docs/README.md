<p align="center">
  <img src="assets/brand/reaper-icon-rounded.svg" width="72" alt="Reaper Mesh logo">
</p>

<h1 align="center">Reaper Mesh documentation</h1>

<p align="center">
  Everything about using, understanding and building Reaper Mesh.<br>
  New here? Start with <a href="overview/how-it-works.md"><strong>How Reaper Mesh works</strong></a>.
</p>

---

## Overview

| Document | What it covers |
| --- | --- |
| [How Reaper Mesh works](overview/how-it-works.md) | The system in plain language: the pieces, a message's journey, design principles and limits |
| [Status](overview/status.md) | What works right now and how it was verified |
| [Roadmap](overview/roadmap.md) | What comes next, in order |
| [Changelog](overview/changelog.md) | What changed in each release |

## Guides: do something

| Document | What it covers |
| --- | --- |
| [Getting started](guides/getting-started.md) | Run the web portal with a simulated device, no hardware needed |
| [Hardware](guides/hardware.md) | Which boards to buy, what else you need, and board details |
| [Flashing firmware](guides/flashing-firmware.md) | Build, check and install firmware over USB, and recover if it fails |
| [Web portal](guides/web-portal.md) | Messaging, channels, the map, nodes and every device setting |
| [Security and privacy](guides/security.md) | Team networks, channel encryption, the app PIN, and their limits |
| [Plugins](guides/plugins.md) | Install and write JSON plugins that add map item types |
| [Build a mobile app](guides/mobile-apps.md) | How a phone app pairs with and talks to a board |

## Reference: exact contracts

| Document | What it covers |
| --- | --- |
| [Protocol](reference/protocol.md) | The app-to-board link: framing, typed payloads, negotiation and recovery |
| [Radio protocol](reference/radio-protocol.md) | The over-the-air frame, keys, epochs, routing and bounds |
| [Radio configuration](reference/radio-configuration.md) | Modes, channels, transmit power and the regional profile |
| [Messaging and inbox](reference/messaging.md) | Message upload, delivery states, inbox reads and diagnostics |
| [Discovery and position](reference/discovery.md) | Beacons, discovery replies, position rules and bounds |
| [Bluetooth link](reference/bluetooth.md) | Pairing rules, the GATT service and flow control |
| [Persistence](reference/persistence.md) | How the board stores settings and keys |
| [Shared map items](reference/map-sharing.md) | Map item payloads, ownership, approval and limits |
| [Device screen and buttons](reference/device-display.md) | Screen pages, button gestures, battery and the status LED |
| [Serial adapter](reference/serial-adapter.md) | The Web Serial transport in the agent core |
| [Compatibility](reference/compatibility.md) | How versions fit together, and recovery test coverage |

## Contributing: change the project

| Document | What it covers |
| --- | --- |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | How to contribute, start to finish |
| [Development and CI](contributing/development.md) | Toolchain, checks, formatting and continuous integration |
| [Commits and pull requests](contributing/commits-and-prs.md) | Commit format, signing, branch names and the pull request checklist |
| [Architecture and standards](contributing/plan.md) | Repository layout, architecture, product requirements and test standards |
| [Decisions](contributing/decisions.md) | Every design decision (`D1`–`D53`) and the open questions |
| [Field qualification plan](contributing/field-qualification.md) | Relay, range, power-loss and soak test procedures |
| [Security architecture](contributing/security-architecture.md) | The approved trusted-device design (D50) and its delivery order |
| [Rotation and rekey design](contributing/rotation-design.md) | Epoch proofs, network frames, rekeying and relay status (D52) |
| [Third-party notices](contributing/third-party-notices.md) | Bundled dependencies and their licenses |

Also see [`firmware/README.md`](../firmware/README.md) for the embedded C++ components,
[`examples/README.md`](../examples/README.md) for working examples, and [`AI.md`](../AI.md) for
the working rules contributors and AI assistants follow.

## Where information lives

Each fact has one home, and other pages link to it.

| Question | Home |
| --- | --- |
| What works right now? | [Status](overview/status.md) |
| What comes next? | [Roadmap](overview/roadmap.md) |
| What changed, and when? | [Changelog](overview/changelog.md) (detailed test evidence goes in pull requests) |
| Why is it built this way? | [Decisions](contributing/decisions.md) |
| Exactly how does it behave? | The [reference](#reference-exact-contracts) pages |
