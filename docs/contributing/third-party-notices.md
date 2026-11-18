# Third-party notices

Reaper Mesh is licensed under the Apache License 2.0 (`LICENSE`, with attribution in `NOTICE`). Bundled third-party code keeps its own license, listed below. Keep `NOTICE` in sync with this page when a bundled dependency is added or removed.

## Semtech SX126x driver

The radio component vendors the unmodified core of Semtech's official sx126x_driver 2.5.0 at commit a10c5dfdf89788c6ac805e9fe98889de44175aa2. Source/provenance and the full Clear BSD license are in firmware/components/reaper_radio/vendor/. Include that LICENSE.txt in binary release materials, preserve source notices, and do not imply endorsement. The Clear BSD license does not grant patent rights. LR-FHSS/BPSK modules and Arduino/RadioLib/Meshtastic code are not included.

## Semtech LR11xx driver

The radio component vendors the unmodified radio, system and register-memory sources of Semtech's official LR11xx driver (SWDR001) 3.0.0 at commit a333238acfa0a9dee9ce2824ce52e89b98f3d24b, for the T1000-E's LR1110. Source/provenance and the full Clear BSD license are in firmware/components/reaper_radio/lr11xx/. The same obligations as the SX126x driver apply. GNSS, Wi-Fi scanning, LR-FHSS, ranging, crypto-engine and bootloader modules are not included.

## Zephyr

The T1000-E firmware is built with pinned Zephyr v4.5.0 (Apache-2.0) and its hal_nordic (nrfx, BSD-3-Clause), CMSIS (Apache-2.0), Mbed TLS and TF-PSA-Crypto (Apache-2.0) and picolibc (BSD-style) modules, listed in firmware/zephyr.lock.json. Preserve their license notices in T1000-E firmware distributions; inspect the pinned modules' LICENSE files when packaging releases. The board's Adafruit nRF52 bootloader and Nordic SoftDevice ship on the device and are not distributed by this project.

## Desktop app

The desktop app (`agents/desktop/`) is built with Tauri 2 (MIT or Apache-2.0) and links the Rust
crates in `agents/desktop/src-tauri/Cargo.lock`, including `serialport` (MPL-2.0, used unmodified;
its source is published on crates.io) and `open` (MIT). Preserve their license notices in desktop
app distributions; `cargo about` or a similar tool can list them from the lock file when packaging.
On Windows the installer may download Microsoft's WebView2 runtime, which Microsoft distributes
under its own terms.

## ESP-IDF

Firmware uses pinned ESP-IDF v5.5.4. Preserve its Apache-2.0 license and applicable bundled third-party notices in firmware distributions; inspect the actual pinned SDK's LICENSE/NOTICE materials when packaging releases. Local SDK/tool downloads remain ignored.

## Web agent map library

The field portal bundles Leaflet 1.9.4 (BSD-2-Clause) for the interactive position map. Preserve Leaflet copyright and license notices when redistributing the web agent build. Map tiles are loaded at runtime from Esri’s publicly reachable Dark, Topo and Satellite services; the agent remains usable when tiles cannot load. Leaflet does not select a license for Reaper Mesh.

## Web agent encryption library

The web agent bundles libsodium.js (`libsodium-wrappers-sumo` 0.8.4, ISC License) for channel encryption and PIN key derivation. Preserve its copyright and license notice when redistributing the web agent build.

## Web agent QR, icon and coordinate libraries

The web agent bundles four small libraries, each pinned in package-lock.json. Preserve their copyright and license notices when redistributing the web agent build:

- `qrcode-generator` 2.0.4 (MIT License) draws channel QR codes. "QR Code" is a registered trademark of DENSO WAVE INCORPORATED.
- `jsqr` 1.4.0 (Apache License 2.0) reads QR codes from the camera and from images.
- `lucide` 1.68.0 (ISC License) provides the icons, the same set as the mobile app.
- `mgrs` 2.2.0 (MIT License) converts coordinates to MGRS.

## Firmware installer libraries

The firmware installer (`agents/flasher/`) bundles `esptool-js` 0.7.0 (Apache License 2.0), Espressif's browser port of esptool, which includes Espressif's flasher stub binaries. It also bundles its dependencies `pako` 2.2.0 (MIT and Zlib licenses) for compression and `atob-lite` 2.0.0 (MIT License). Preserve their copyright and license notices when redistributing the installer build.

## Web tooling

Development tooling is pinned in package-lock.json, including the MIT-licensed Web Serial and Web USB type definitions (`@types/w3c-web-serial`, `@types/w3c-web-usb`), which are used only for type checking; preserve applicable notices for any tooling/runtime code actually redistributed.
