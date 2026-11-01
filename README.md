# Reaper Mesh

A focused LoRa mesh messaging project, starting with custom Heltec WiFi LoRa 32 V3 firmware and a desktop browser client connected over USB.

The goal is dependable messaging, small firmware, and compatibility across supported releases. Meshtastic is a functional reference; interoperability with its radio protocol is not currently promised. This repository currently contains planning documents only. Nothing has been built or flashed.

## Start here

- [AI.md](AI.md): project context and instructions for AI contributors.
- [Development plan](docs/PLAN.md): proposed architecture, milestones, and acceptance criteria.
- [Decisions](docs/DECISIONS.md): assumptions and unresolved product choices.

## Proposed repository layout

```text
firmware/              Embedded core and board-specific adapters
clients/web/           Desktop browser application, USB first
packages/protocol/     Shared schemas, generated bindings, compatibility fixtures
packages/client-core/  Transport-independent connection and message state
tools/                 Build, flash, diagnostics, and release tooling
tests/simulator/       Deterministic virtual nodes and fault injection
tests/hardware/        Explicitly invoked physical-device checks
docs/                  Architecture, protocol, decisions, and release guidance
```

These directories will be introduced as their implementation begins. Future desktop and mobile clients can live under `clients/` or move to separate repositories while consuming a versioned protocol/SDK.

## Development status

Planning stage. Review the open decisions before starting firmware or client implementation. The local Git repository is initialized; no GitHub repository or remote is configured. License selection is pending; no third-party code should be copied without checking its license.
