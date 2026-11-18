# Adding a board

Every board runs the same firmware core, protocol and settings; only its adapter differs (pins,
radio driver, screen, buttons, power and storage). This page lists everything a new board touches,
so nothing is missed. `tests/simulator/boards.test.ts` fails if a board is listed in one place and
missing from another.

Before starting, record the target in a decision (`Dnn`): what the board is, which platform builds
it, and anything the core does not already handle. Keep the core unchanged (D41); if the board
needs a core change, propose it separately.

## 1. Firmware

| Step | Where |
| --- | --- |
| A project folder for the board, named for its target ID (for example `heltec-stick-v3`) | `firmware/<id>/`. An ESP32 board is an ESP-IDF project with a board profile and the board implementations of `app/`'s interfaces; reuse another board's files when the wiring matches (D55). Another chip family needs its own platform application, as the T1000-E has on Zephyr (D57) |
| The radio gate: band and antenna confirmed by the owner, per unit | The board profile (`board_profile.hpp` or equivalent). It stays closed until the owner confirms the unit |
| The firmware name, `{device}-reaper-mesh-v{semver}` (D8) | `firmware/components/reaper_device/include/reaper/version.hpp` |
| A radio driver, only for a new radio chip | `firmware/components/reaper_radio/`, with host tests in `firmware/tests/` and `firmware/CMakeLists.txt`. Vendored code gets an `upstream.json` and `UPSTREAM.md`, is listed in `tools/check-vendor.ts`, and is reviewed for license first |
| The driver choice | `firmware/app/mesh_service.hpp` |

## 2. Build, install and publish

| Step | Where |
| --- | --- |
| The board's entry: name, maker, status, chips, website summary and installer hint. The website, the installer's menu and the site build read it | [`agents/boards.json`](../../agents/boards.json) |
| The installer's safety rules: chip, flash size and image offsets | `SUPPORTED` in `agents/flasher/firmware.ts`. A board whose bootloader is not ESP32 ROM also needs its install path (see `agents/flasher/nrf-dfu.ts`) |
| The build | ESP32: `tools/build-firmware.sh` and `tools/firmware-manifest.py`. Other platforms: a build script that writes `build/<id>/reaper-manifest.json`, as `tools/build-t1000e.sh` does |
| Site publishing checks | `tools/build-site.ts`. ESP32 builds are checked with `tools/update-firmware.py`; another platform needs its own manifest check |
| CI builds it and hands it to the site | `.github/workflows/checks.yml`: a build job or matrix entry, and an artifact download in the `site` job |

## 3. Documentation

| Step | Where |
| --- | --- |
| The board's page, from the template | `docs/boards/<id>.md` from [`docs/boards/TEMPLATE.md`](../boards/TEMPLATE.md), and a row in the [board list](../boards/README.md) |
| Transmit power: a new row, or the board added to its radio chip's row | [Radio configuration](../reference/radio-configuration.md#transmit-power) |
| Buttons and battery rows | [Device screen and buttons](../reference/device-display.md) |
| What has been tested on it | A row in [Status](../overview/status.md#boards), and the unit in the development boards table |
| Release notes | [Changelog](../overview/changelog.md) |
| Its commit scope | [Commits and pull requests](commits-and-prs.md#scopes) |
| Its folder | The repository layout in [Architecture and standards](plan.md#repository-layout) |
| Any new SDK or vendored code | [Third-party notices](third-party-notices.md) and `NOTICE` |

Nothing else should name every board. Overviews, guides and the website say "supported boards"
and link to the board list.

## 4. Qualify it on hardware

A new board starts as `experimental` in `agents/boards.json` and on its page. These checks, on the
owner's units, promote it to `supported`:

1. The owner confirms the unit's band and antenna, and the radio gate opens.
2. It installs from the browser installer, both over other firmware and as an update that keeps
   settings, keys and pairings.
3. A USB session works, the radio passes its startup probe, and settings survive a restart.
4. It exchanges direct messages with acknowledgment, both ways, with an already supported board,
   and broadcasts in both directions.
5. A phone pairs over Bluetooth and messages through it.
6. Its button, LED, screen and battery reading behave as its page says.

Record what was tested in the pull request and in Status, then change its `status` to `supported`.
