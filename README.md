# Reaper Mesh

A focused LoRa mesh messaging project, starting with custom Heltec WiFi LoRa 32 V3 firmware and a desktop browser client connected over USB.

The goal is dependable messaging, small firmware, and compatibility across supported releases. Reaper Mesh uses an independent, documented protocol. Meshtastic is a functional reference; radio interoperability is outside the scope. Host-side synchronization, command recovery, typed USB framing/validation, connection lifecycle management, a Web Serial adapter with configuration commands/recovery, and 79 tests exist; firmware and the web UI have not been implemented. Nothing has been flashed.

## Start here

- [AI.md](AI.md): project context and instructions for AI contributors.
- [Development plan](docs/PLAN.md): proposed architecture, milestones, and acceptance criteria.
- [Decisions](docs/DECISIONS.md): assumptions and unresolved product choices.
- [Protocol draft](docs/PROTOCOL.md): synchronization semantics and implementation limits.
- [Hardware inventory](docs/HARDWARE.md): read-only USB findings and outstanding verification.

## Run the host tests

Use Node 24–25 (Node 24 is the proposed baseline; locally tested with 25.9.0):

```sh
npm test
```

No dependency installation is required. Node's built-in TypeScript runner executes the tests; static type checking and CI are still pending. Tests also check generated protocol declarations. After editing `packages/protocol/schema.json`, run `npm run generate:protocol`. The serial adapter has been tested with simulated ports only; hardware/browser validation is pending. See [serial integration](docs/SERIAL.md).

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

M0 foundations in progress. Review the open decisions before firmware work. The local Git repository is initialized; no GitHub repository or remote is configured. License selection is deferred by the owner; no third-party code should be copied without checking its license.
