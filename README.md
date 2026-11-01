# Reaper Mesh

A focused LoRa mesh messaging project, starting with custom Heltec WiFi LoRa 32 V3 firmware and a desktop browser client connected over USB.

The goal is dependable messaging, small firmware, and compatibility across supported releases. Reaper Mesh uses an independent, documented protocol; Meshtastic is a functional reference. The repository contains the shared USB/client core, a local web console and simulator, and portable C++ protocol/configuration components, with 157 host tests. The USB-only ESP-IDF image is installed on the development Heltec and passes initial USB/NVS smoke checks; browser hardware qualification remains pending.

## Start here

- [AI.md](AI.md): project context and instructions for AI contributors.
- [Development plan](docs/PLAN.md): proposed architecture, milestones, and acceptance criteria.
- [Decisions](docs/DECISIONS.md): assumptions and unresolved product choices.
- [Protocol draft](docs/PROTOCOL.md): synchronization semantics and implementation limits.
- [Device storage contract](docs/PERSISTENCE.md): commit, uncertain-write, and recovery behavior.
- [Embedded foundation](firmware/README.md): C++ codec contracts, builds, and target integration limits.
- [Hardware inventory](docs/HARDWARE.md): read-only USB findings and outstanding verification.

## Run the host tests

Use Node 24–25 (Node 24 is the proposed baseline; locally tested with 25.9.0):

```sh
npm ci --ignore-scripts
npm run check
```

A C++17 compiler is required by the cross-language host tests. Pinned development dependencies provide strict TypeScript checking. Node's built-in runner executes the tests; generated protocol declarations are also checked. GitHub CI is configured; remote results have not been verified here. See [development checks](docs/DEVELOPMENT.md). After editing `packages/protocol/schema.json`, run `npm run generate:protocol`. The serial adapter has been tested with simulated ports only; hardware/browser validation is pending. See [serial integration](docs/SERIAL.md).

## Run the web console

```sh
npm run dev:web
```

Open the printed localhost URL, then connect the simulated Heltec. Configuration saves, lost replies, disconnects, and result queries can be exercised without hardware. [Web console guide](docs/WEB.md). The development Heltec runs USB configuration, OLED status and bounded message acceptance; radio transmission is still disabled.

## Repository layout

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

M0 foundations in progress. Review the open decisions before firmware work. The Git repository is initialized and now tracks origin/main. Verify remote CI separately from local checks. License selection is deferred by the owner; no third-party code should be copied without checking its license.
