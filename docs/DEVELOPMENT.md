# Host development and CI

Python 3.9+ (python3 on PATH, or PYTHON) and a C++17 compiler are required by the host suite (c++ on PATH or CXX). The codec compiles with strict warnings and UBSan locally; Linux also enables ASan. See firmware/README.md for the local ASan limitation and standalone CMake/CTest build.

Use Node 24 (the `.node-version` baseline) or Node 25. Local verification currently uses Node 25.9.0 on macOS arm64.

```sh
npm ci --ignore-scripts
npm run check
```

`check` runs strict TypeScript checks across packages, tools, and tests, verifies generated TS/C++ protocol descriptors, runs the host suite, and builds the web client. `npm test` still runs generated checks and tests without static checking; `npm run typecheck` checks types alone. After editing the schema, use `npm run generate:protocol`, review the generated diff, then run the combined check.

`package-lock.json` pins TypeScript 7.0.2 and Node 24 type definitions 24.19.2, including transitive integrity hashes and platform-specific compiler packages. Install scripts are not required. Vite 8.3.5 is also pinned for the local browser build/dev server (MIT; retained dependency license notices apply). These are development-only tools: TypeScript/compiler packages use Apache-2.0, and Node/Undici type definitions use MIT. These dependency licenses do not select a license for Reaper Mesh, whose licensing decision remains deferred.

`.github/workflows/checks.yml` runs the combined check for pushes and pull requests on Node 24 and 25 on Ubuntu. Checkout/setup actions are pinned to verified commit IDs, with read-only repository permissions and persisted Git credentials disabled. CI uses the lockfile through `npm ci --ignore-scripts`. The repository now tracks origin/main. The workflow is configured, but remote CI results have not been verified in this session.

Passing host checks does not establish browser permission behavior, native serial-driver cleanup, firmware flash durability, or RF delivery. See `docs/SERIAL.md` and `docs/HARDWARE.md` for those boundaries.
