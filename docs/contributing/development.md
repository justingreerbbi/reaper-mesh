# Host development and CI

Python 3.9+ (python3 on PATH, or PYTHON) and a C++17 compiler are required by the host suite (c++ on PATH or CXX). The codec compiles with strict warnings and UBSan locally; Linux also enables ASan. See firmware/README.md for the local ASan limitation and standalone CMake/CTest build.

Use Node 24 (the `.node-version` baseline) or Node 25. Local verification currently uses Node 25.9.0 on macOS arm64.

```sh
npm ci --ignore-scripts
npm run check
```

`check` runs strict TypeScript checks across packages, tools, and tests, verifies generated TS/C++ protocol descriptors, runs the host suite, and builds the web agent. `npm test` still runs generated checks and tests without static checking; `npm run typecheck` checks types alone. After editing the schema, use `npm run generate:protocol`, review the generated diff, then run the combined check.

`package-lock.json` pins TypeScript 7.0.2 and Node 24 type definitions 24.19.2, including transitive integrity hashes and platform-specific compiler packages. Install scripts are not required. Vite 8.3.5 is also pinned for the local browser build/dev server (MIT; retained dependency license notices apply). The field portal runtime depends on Leaflet 1.9.4 (BSD-2-Clause); see third-party-notices.md. Development-only tools: TypeScript/compiler packages use Apache-2.0, and Node/Undici type definitions use MIT. These dependency licenses do not select a license for Reaper Mesh, which is licensed under Apache-2.0 (D6).

## Formatting

Code is formatted automatically; do not hand-align or compress code to save lines.

| Files | Tool | Config |
| --- | --- | --- |
| TypeScript, CSS, HTML, JSON, YAML | Prettier 3.9.10 (pinned in `package-lock.json`) | `.prettierrc.json`, `.prettierignore` |
| Firmware C/C++ (`firmware/`) | clang-format 23.1.3 | `.clang-format` |
| Python (`tools/`, `tests/`) | ruff 0.17.1 (format, plus lint for correctness and import order) | `ruff.toml` |

All three use a 100-column limit. Generated files, frozen fixtures, vendored sources and Markdown are excluded. Install clang-format and ruff once into the ignored `.tools/` folder:

```sh
python3 -m venv .tools/clang-format
.tools/clang-format/bin/pip install clang-format==23.1.3
python3 -m venv .tools/ruff
.tools/ruff/bin/pip install ruff==0.17.1
```

Then run `npm run format` to rewrite files, or `npm run format:check` to check them without changes. `tools/format-cpp.ts` and `tools/format-python.ts` refuse to run with any other clang-format or ruff version, because different versions format differently. `.editorconfig` sets line endings, final newlines and indentation for editors. `.gitattributes` makes Git store and check out text with LF on every OS (so generated-file comparisons also pass on Windows), keeps vendored files and frozen fixtures byte-exact, and marks generated files so GitHub collapses them in diffs.

## Continuous integration

`.github/workflows/checks.yml` runs on pull requests, pushes to `main` and manual dispatch, with these jobs:

| Job | What it checks |
| --- | --- |
| Host checks (Node 24, 25) | `npm ci --ignore-scripts` then `npm run check`: strict TypeScript, generated schema and vendor checks, compiler-backed host tests with sanitizers, Python updater tests and the web build |
| Formatting | `npm run format:check` with the pinned Prettier, clang-format and ruff |
| Firmware unit tests | Standalone CMake build of the portable firmware components with `-Werror`, the CTest suite and `codec_bridge selftest` |
| Firmware build (heltec-v3, tbeam-v12) | `tools/build-firmware.sh` inside the `espressif/idf:v5.5.4` container (pinned by digest). The script verifies the ESP-IDF commit against `firmware/esp-idf.lock.json`. The job fails if the build touches tracked files, and writes image sizes and hashes to the job summary |
| Shell script lint | `shellcheck --severity=warning tools/*.sh` |

Actions and the container image are pinned to verified digests. Permissions are read-only, persisted Git credentials are disabled, and superseded pull-request runs are cancelled. When ESP-IDF is upgraded, update `firmware/esp-idf.lock.json`, `tools/bootstrap-esp-idf.sh` and the container tag and digest together. Firmware builds in CI do not flash anything or qualify hardware behavior.

`tools/build-firmware.sh` uses the bootstrapped ESP-IDF under `.tools/` by default. Set `REAPER_IDF_FROM_ENV=1` to use a preinstalled ESP-IDF at `IDF_PATH` instead, as CI does.

Passing host checks does not establish browser permission behavior, native serial-driver cleanup, firmware flash durability, or RF delivery. See `../reference/serial-adapter.md` and `../guides/hardware.md` for those boundaries.
