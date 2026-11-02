# Reaper Mesh

**Long-range text messaging over LoRa radio — no internet, no cell service, no cloud.**

Reaper Mesh is custom firmware for inexpensive LoRa boards plus a desktop browser agent
that talks to them over USB. The goal is deliberately narrow: dependable messaging between a
small number of devices, with small firmware and careful compatibility across releases.

Reaper Mesh uses its own independent, documented protocol. [Meshtastic](https://meshtastic.org/)
is used only as a functional reference, not for interoperability.

> [!IMPORTANT]
> This is a working development prototype, not a production or certified release. It is
> careful to state exactly what has and has not been verified on hardware. See the
> [current status](docs/overview/status.md).

## What works today

- Connect a board over USB and configure it from the browser — verified on hardware.
- Public and named channels, transmit power, radio mode, and 1,024-byte messages with
  fragmentation — verified on hardware.
- **Direct radio delivery between two boards with destination acknowledgment** — verified on
  a Heltec V3 and a LILYGO T-Beam V1.2.
- Node discovery, fixed-position sharing, a local inbox, and recovery after disconnects.
- A first implementation of agent-side channel encryption (verified on two boards, not audited).

Still outstanding: three-node relaying, field range, power-loss durability, EU transmission,
BLE/mobile agents, signed releases, and a security audit.

## Documentation

The full documentation set lives in [`docs/`](docs/README.md). Quick links:

| If you want to… | Read |
| --- | --- |
| Understand what this is | [Introduction](docs/overview/introduction.md) |
| Try it with no hardware | [Getting started](docs/guides/getting-started.md) |
| See what works today | [Status](docs/overview/status.md) · [Roadmap](docs/overview/roadmap.md) |
| Flash a board | [Hardware](docs/guides/hardware.md) · [Flashing firmware](docs/guides/flashing-firmware.md) |
| Use the app | [Web portal](docs/guides/web-portal.md) · [Channel encryption](docs/guides/encryption.md) |
| Understand the internals | [Protocol](docs/reference/protocol.md) · [Radio protocol](docs/reference/radio-protocol.md) |
| Contribute | [Development plan](docs/contributing/plan.md) · [Development & CI](docs/contributing/development.md) |

## Quick start (no hardware required)

Use Node 24 or 25, Python 3.9+, and a C++17 compiler.

```sh
npm ci --ignore-scripts
npm run check
```

```sh
npm run dev:web
```

Open the printed localhost URL and connect the built-in **Simulator** — it speaks the real
protocol, so you can exercise configuration, lost replies, disconnects, and query-only
recovery without a board. Full walkthrough: [Getting started](docs/guides/getting-started.md).

## Repository layout

```text
firmware/              Embedded C++ core and board-specific adapters
agents/web/           Desktop browser application (field portal), USB first
packages/protocol/     Shared schemas, generated bindings, compatibility fixtures
packages/agent-core/  Transport-independent connection and message state
tools/                 Build, flash, diagnostics, and release tooling
tests/simulator/       Deterministic virtual nodes and fault injection
tests/hardware/        Explicitly invoked physical-device checks
docs/                  All documentation (see docs/README.md)
```

## Project status and scope

The USB/local-messaging slice and two-board direct RF delivery work on hardware. Relay,
power-cut, and field-soak qualification remain release gates. The Git repository tracks
`origin/main`; remote CI is configured but should be verified separately from local checks.
Licensing is deliberately deferred by the owner — no third-party code should be copied without
checking its license. See [Third-party notices](docs/contributing/third-party-notices.md).

Contributors should read [`AGENTS.md`](AGENTS.md) and [`AI.md`](AI.md) before making changes.
