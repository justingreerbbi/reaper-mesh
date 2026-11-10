# Development and CI

How to set up a development environment, run the checks, format code and understand CI. New
here? Start with [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Requirements

| Tool | Version | Used for |
| --- | --- | --- |
| Node.js | 24 (the `.node-version` baseline) or 25 | TypeScript checks, tests, the web build |
| Python | 3.9+ (`python3` on `PATH`, or set `PYTHON`) | Cross-language and updater tests |
| C++ compiler | C++17 (`c++` on `PATH`, or set `CXX`) | Compiling the real firmware code for host tests |

The codec compiles with strict warnings and UBSan; Linux also enables ASan. See
[firmware/README.md](../../firmware/README.md) for the macOS ASan limitation and the standalone
CMake/CTest build. Firmware builds need ESP-IDF; see
[Flashing firmware](../guides/flashing-firmware.md).

## Run the checks

```sh
npm ci --ignore-scripts
npm run check
```

`check` runs strict TypeScript checks across packages, tools, and tests, verifies generated TS/C++ protocol descriptors, runs the host suite, and builds the web portal and the firmware installer. `npm test` still runs generated checks and tests without static checking; `npm run typecheck` checks types alone. After editing the schema, use `npm run generate:protocol`, review the generated diff, then run the combined check.

`package-lock.json` pins TypeScript 7.0.2 and Node 24 type definitions 24.19.2, including transitive integrity hashes and platform-specific compiler packages. Install scripts are not required. Vite 8.3.5 is also pinned for the local browser build/dev server (MIT; retained dependency license notices apply). The portal's runtime dependencies and their licenses are listed in [Third-party notices](third-party-notices.md). Development-only tools: TypeScript/compiler packages use Apache-2.0, and Node/Undici type definitions use MIT. These dependency licenses do not select a license for Reaper Mesh, which is licensed under Apache-2.0 (D6).

### Other scripts

| Script | What it does |
| --- | --- |
| `npm run dev:web` | Runs the web portal with live reload at <http://127.0.0.1:5173/> |
| `npm run build:web` | Builds the portal into `dist/web/` |
| `npm run build:flasher` | Builds the firmware installer (`agents/flasher/`) into `dist/flasher/` |
| `npm run build:site` | Builds both and assembles the GitHub Pages site in `dist/site/`, with any firmware you built in `build/` (see [GitHub Pages](#github-pages)) |
| `npm run preview:site` | Serves `dist/site/` at <http://127.0.0.1:4173/>, the same path as on Pages |

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
| Firmware build (heltec-v3, heltec-stick-v3, tbeam-v12) | `tools/build-firmware.sh` inside the `espressif/idf:v5.5.4` container (pinned by digest). The script verifies the ESP-IDF commit against `firmware/esp-idf.lock.json`. The job fails if the build touches tracked files, and writes image sizes and hashes to the job summary |
| Shell script lint | `shellcheck --severity=warning tools/*.sh` |
| Pages site | After every job above passes: builds the portal and installer, validates both firmware builds with `tools/update-firmware.py`, and assembles the site. On `main` it uploads the site |
| Deploy to GitHub Pages | On `main` only: publishes the site |

Actions and the container image are pinned to verified digests. Permissions are read-only, persisted Git credentials are disabled, and superseded pull-request runs are cancelled. When ESP-IDF is upgraded, update `firmware/esp-idf.lock.json`, `tools/bootstrap-esp-idf.sh` and the container tag and digest together. Firmware builds in CI do not flash anything or qualify hardware behavior.

Firmware build jobs keep their images (and the ESP-IDF license notices) as workflow artifacts for 7 days, so the Pages site job can publish exactly what CI built.

`tools/build-firmware.sh` uses the bootstrapped ESP-IDF under `.tools/` by default. Set `REAPER_IDF_FROM_ENV=1` to use a preinstalled ESP-IDF at `IDF_PATH` instead, as CI does.

Passing host checks does not establish browser permission behavior, native serial-driver cleanup, firmware flash durability, or RF delivery. See [Serial adapter](../reference/serial-adapter.md) and [Hardware](../guides/hardware.md) for those boundaries.

## GitHub Pages

Every push to `main` that passes CI publishes the site at <https://reapermesh.com/>:

| Page | Address | Source |
| --- | --- | --- |
| Project landing page | <https://reapermesh.com/> | `agents/site/index.html` |
| Web portal | <https://reapermesh.com/web/> | `agents/web/` |
| Firmware installer | <https://reapermesh.com/flash/> | `agents/flasher/` |
| Mobile app (App Store marketing URL) | <https://reapermesh.com/app/> | `agents/site/app/` |
| Support | <https://reapermesh.com/support/> | `agents/site/support/` |
| Privacy policy | <https://reapermesh.com/privacy/> | `agents/site/privacy/` |

The App Store and Google Play listings link to the last three, so keep their addresses stable.
The privacy policy must stay true to the mobile app's code and its "Data Not Collected" App Store
label: update it, and its effective date, before shipping anything that collects or sends data.
The contact address on those pages is `SUPPORT_EMAIL` in `tools/build-site.ts`.

How it works:

1. The **Firmware build** jobs build every board and keep the images as artifacts.
2. The **Pages site** job builds both apps with a relative base path (`--base ./`), so they work
   at the domain root or under any subpath, then runs `node tools/build-site.ts
   --require-firmware`. That script validates each firmware build with
   `tools/update-firmware.py`, the same checks as a USB install, and lays out the site:

   ```text
   dist/site/                 the landing page, with theme.css and favicon.svg from the portal
   dist/site/web/             the portal
   dist/site/flash/           the installer
   dist/site/flash/firmware/  index.json, one folder of images per board and build, notices/
   dist/site/app/, support/, privacy/, assets/   static pages and images from agents/site/
   ```

   The pages in `agents/site/` share one header and footer, `agents/site/partials/`, which the
   script fills in, together with the relative path to the site root and the contact address.
   Their images are cropped from `docs/assets/` and kept in `agents/site/assets/`. Before the
   mobile app launches in a store, that store's button says "Coming soon"; at launch, replace it
   in `index.html` and `app/index.html` with a link to the store's listing. The App Store button
   links to <https://apps.apple.com/us/app/reaper-mesh/id6832375918>.

3. The **Deploy to GitHub Pages** job publishes it, using the `github-pages` environment.

Pull requests run steps 1 and 2 too, so a change that breaks the site fails CI, but they never
deploy. Each deploy replaces the whole site, so the installer always offers the firmware built
from the latest `main`. Image folders are named after the firmware version and commit, so a
browser holding a cached image can never pair it with a newer index.

**One-time setup:** in the repository's **Settings → Pages**, set **Source** to **GitHub
Actions** and **Custom domain** to `reapermesh.com`, then tick **Enforce HTTPS**. The domain is
set there, not with a `CNAME` file, because the site deploys from Actions. Its DNS needs the
GitHub Pages `A` and `AAAA` records on the apex and a `www` `CNAME` to `justingreerbbi.github.io`.
reapermesh.org only redirects to reapermesh.com. Pages is free for public repositories.

**Origin:** browsers isolate storage by origin. On its own domain the portal's browser storage,
including channel keys, is not shared with any other site. Without the custom domain it would
share `justingreerbbi.github.io` with every other Pages site of the account, which could read it.
GitHub redirects the old `justingreerbbi.github.io/reaper-mesh/` links to the domain, but
browser storage does not move with them: someone who used the portal at the old address finds it
empty at reapermesh.com and has to rejoin their channels there. Moving the portal from the root to
`/web/` kept it on the same origin, so its storage carried over. Every page uses relative paths,
so the site works at either address with no code change.

Firmware published this way is unsigned prototype firmware. The installer checks every image's
SHA-256 against the index, and the index comes from the same deploy, so this detects corruption
but not a compromised repository or account (open question Q10; decision D54).
