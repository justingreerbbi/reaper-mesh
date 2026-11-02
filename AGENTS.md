# Contributor instructions

Read `AI.md`, `docs/contributing/plan.md`, `docs/contributing/decisions.md`, and `docs/reference/protocol.md` before changing this project. `AI.md` is the maintained project handoff and engineering guidance. The documentation set is organized under `docs/` (start at `docs/README.md`).

Install pinned dev tools with `npm ci --ignore-scripts`, then run `npm run check` for changes. This includes strict TypeScript checking, generated TS/C++ schema verification, compiler-backed host tests, and the web build. A C++17 compiler is required; see firmware/README.md for sanitizer/toolchain limits. Never hand-edit generated descriptors or silently refresh frozen compatibility fixtures. Update relevant protocol documentation and add behavioral recovery tests when changing the synchronization contract. Keep hardware limitations explicit; host tests do not qualify radio or firmware behavior.
