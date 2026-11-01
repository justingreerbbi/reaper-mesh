# Third-party notices

Reaper Mesh licensing remains deferred. This does not change dependency licenses.

## Semtech SX126x driver

The radio component vendors the unmodified core of Semtech's official sx126x_driver 2.5.0 at commit a10c5dfdf89788c6ac805e9fe98889de44175aa2. Source/provenance and the full Clear BSD license are in firmware/components/reaper_radio/vendor/. Include that LICENSE.txt in binary release materials, preserve source notices, and do not imply endorsement. The Clear BSD license does not grant patent rights. LR-FHSS/BPSK modules and Arduino/RadioLib/Meshtastic code are not included.

## ESP-IDF

Firmware uses pinned ESP-IDF v5.5.4. Preserve its Apache-2.0 license and applicable bundled third-party notices in firmware distributions; inspect the actual pinned SDK's LICENSE/NOTICE materials when packaging releases. Local SDK/tool downloads remain ignored.

## Web tooling

The shipped web client has no runtime package dependencies. Development tooling is pinned in package-lock.json; preserve applicable notices for any tooling/runtime code actually redistributed. No root project license has been selected.
