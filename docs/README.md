# Reaper Mesh documentation

Reaper Mesh is a small, dependable LoRa mesh messaging system: custom firmware for
hobbyist LoRa boards plus a desktop browser client that talks to them over USB.

This folder is the full documentation set. Start with the section that matches what
you want to do.

> [!IMPORTANT]
> Reaper Mesh is a working development prototype, not a production release. It is honest
> about what has and has not been verified on real hardware. See [current status](overview/status.md)
> for exactly what works today and what is still unqualified.

## New here? Start with the overview

| Document | What it covers |
| --- | --- |
| [Project specification and vision](overview/project-specification.md) | Draft project-wide standard: intent, use cases, phases, requirements and future direction |
| [Introduction](overview/introduction.md) | What Reaper Mesh is, who it is for, and how the pieces fit together |
| [Roadmap](overview/roadmap.md) | The four product phases and what each one delivers |
| [Status](overview/status.md) | What is implemented and verified today versus what remains |
| [Changelog](overview/changelog.md) | Dated record of firmware builds and hardware test evidence |

## Guides — do something

| Document | What it covers |
| --- | --- |
| [Getting started](guides/getting-started.md) | Run the host tests and the web console with no hardware |
| [Hardware](guides/hardware.md) | Supported boards and the confirmed inventory |
| [T-Beam V1.2](guides/t-beam-v12.md) | Board-specific notes for the LILYGO T-Beam |
| [Flashing firmware](guides/flashing-firmware.md) | Build, validate, install, and recover firmware over USB |
| [First flash walkthrough](guides/first-flash.md) | Detailed record of the original Heltec V3 bring-up |
| [Web portal](guides/web-portal.md) | Using the field portal: messaging, assets, settings, recovery |
| [Channel encryption](guides/encryption.md) | Setting up client-side encryption and its security limits |

## Reference — how it works in detail

| Document | What it covers |
| --- | --- |
| [Protocol](reference/protocol.md) | USB framing, typed payloads, negotiation, and the synchronization contract |
| [Radio protocol](reference/radio-protocol.md) | The over-the-air datagram, routing, and resource bounds |
| [Radio configuration](reference/radio-configuration.md) | Modes, channels, transmit power, and the regional profile |
| [Messaging](reference/messaging.md) | Message acceptance, delivery states, and bounds |
| [Inbox & diagnostics](reference/inbox.md) | Inbox retrieval, local delivery, and live radio diagnostics |
| [Persistence](reference/persistence.md) | Device configuration authority and the storage contract |
| [Serial adapter](reference/serial-adapter.md) | The Web Serial transport layer |
| [Compatibility](reference/compatibility.md) | Version matrix and RACE recovery coverage |

## Contributing — change the project

| Document | What it covers |
| --- | --- |
| [Development & CI](contributing/development.md) | Toolchain, host checks, and continuous integration |
| [Development plan](contributing/plan.md) | Architecture, milestones, and acceptance gates |
| [Decisions](contributing/decisions.md) | Confirmed choices and open questions |
| [Phase 2 contract](contributing/phase-2.md) | Discovery, position, and field-portal acceptance criteria |
| [Third-party notices](contributing/third-party-notices.md) | Bundled dependencies and their licenses |

See also [`AI.md`](../AI.md) (the maintained handoff for AI contributors),
[`AGENTS.md`](../AGENTS.md) (contributor rules), and
[`firmware/README.md`](../firmware/README.md) (the embedded C++ foundation).

## Conventions used in these docs

- **Node** — a radio device running Reaper Mesh firmware.
- **Client / agent** — software (the browser portal) connected to a node.
- **RACE** — designing and testing for **s**ynchronization and **r**ecovery across
  interrupted connections and concurrent operations. It is a discipline, not a framework.
- **Delivery states** are kept distinct on purpose: *queued*, *transmitted*,
  *acknowledged*, *failed*, and *unknown* never mean the same thing. USB acceptance and
  relay forwarding are not end-recipient delivery.
