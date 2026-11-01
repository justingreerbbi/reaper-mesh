# Contributor instructions

Read `AI.md`, `docs/PLAN.md`, `docs/DECISIONS.md`, and `docs/PROTOCOL.md` before changing this project. `AI.md` is the maintained project handoff and engineering guidance.

Install pinned dev tools with `npm ci --ignore-scripts`, then run `npm run check` for changes. This includes strict TypeScript checking, generated-schema verification, and host tests. Update relevant protocol documentation and add behavioral recovery tests when changing the synchronization contract. Keep hardware limitations explicit; host tests do not qualify radio or firmware behavior.
