# Reaper Mesh

A focused LoRa mesh messaging project, starting with custom Heltec WiFi LoRa 32 V3 firmware and a desktop browser client connected over USB.

The goal is dependable messaging, small firmware, and compatibility across supported releases. Reaper Mesh uses an independent, documented protocol; Meshtastic is a functional reference. The custom Heltec firmware and USB web console support persistent settings, public/named channels, 1024-byte messages, local delivery/inbox, diagnostics and recovery. The independent mesh core has deterministic multi-node tests; direct Heltec/T-Beam RF delivery is verified, while relay and field qualification remain outstanding. See [current status](docs/STATUS.md).

## Start here

- [Product roadmap](docs/ROADMAP.md): Phase 1 complete; Phase 2 discovery implemented, position and field portal next.
- [Phase 2 contract](docs/PHASE2.md): behavior, privacy, compatibility and RACE acceptance criteria.

- [AI.md](AI.md): project context and instructions for AI contributors.
- [Development plan](docs/PLAN.md): proposed architecture, milestones, and acceptance criteria.
- [Decisions](docs/DECISIONS.md): assumptions and unresolved product choices.
- [Protocol draft](docs/PROTOCOL.md): synchronization semantics and implementation limits.
- [Compatibility and RACE coverage](docs/COMPATIBILITY.md): version matrix, automated and physical evidence.
- [Device storage contract](docs/PERSISTENCE.md): commit, uncertain-write, and recovery behavior.
- [Embedded foundation](firmware/README.md): C++ codec contracts, builds, and target integration limits.
- [T-Beam V1.2](docs/TBEAM.md): ESP32 firmware, safe per-board updater, and verified bidirectional Heltec/T-Beam RF.
- [Hardware inventory](docs/HARDWARE.md): read-only USB findings and outstanding verification.

## Run the host tests

Use Node 24–25 (Node 24 is the proposed baseline; locally tested with 25.9.0):

```sh
npm ci --ignore-scripts
npm run check
```

Python 3.9+ and a C++17 compiler are required by the cross-language host tests. Pinned development dependencies provide strict TypeScript checking. Node's built-in runner executes the tests; generated protocol declarations are also checked. GitHub CI is configured; remote results have not been verified here. See [development checks](docs/DEVELOPMENT.md). After editing `packages/protocol/schema.json`, run `npm run generate:protocol`. Native Brave USB connect/save/reconnect and reload history, plus physical TS client recovery, have been checked. See [serial integration](docs/SERIAL.md).

## Run the web console

```sh
npm run dev:web
```

Open the printed localhost URL, then connect the simulated Heltec. Configuration saves, lost replies, disconnects, and result queries can be exercised without hardware. [Web console guide](docs/WEB.md). The development Heltec runs custom firmware with working OLED status, USB configuration and local messaging. RF qualification is tracked separately. See [USB updates](docs/UPDATES.md) for validated installation and recovery.

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

Future desktop and mobile clients can live under `clients/` or move to separate repositories while consuming a versioned protocol/SDK.

## Development status

The initial USB/local messaging slice works on hardware. RF delivery/relays, power-cut and field-soak qualification remain. The Git repository is initialized and now tracks origin/main. Verify remote CI separately from local checks. License selection is deferred by the owner; no third-party code should be copied without checking its license.
