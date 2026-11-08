#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
board="${1:-heltec-v3}"
case "$board" in heltec-v3|heltec-stick-v3|tbeam-v12) ;; *) echo "Unsupported board: $board" >&2; exit 1;; esac
expected_commit="$(sed -n 's/.*"commit": *"\([0-9a-f]*\)".*/\1/p' "$repo_root/firmware/esp-idf.lock.json")"
# CI sets REAPER_IDF_FROM_ENV=1 to use a preinstalled ESP-IDF at IDF_PATH (for example the
# espressif/idf container); local builds use the bootstrapped copy under .tools/.
if [ "${REAPER_IDF_FROM_ENV:-}" = 1 ]; then
  sdk_root="${IDF_PATH:?IDF_PATH must point at a preinstalled ESP-IDF}"
else
  export IDF_TOOLS_PATH="$repo_root/.tools/espressif"
  sdk_root="$repo_root/.tools/esp-idf"
fi
if [ ! -f "$sdk_root/export.sh" ]; then
  echo 'Run bash tools/bootstrap-esp-idf.sh first.' >&2
  exit 1
fi
if [ "$(git -C "$sdk_root" rev-parse HEAD)" != "$expected_commit" ]; then
  echo "Unexpected ESP-IDF revision; firmware/esp-idf.lock.json requires $expected_commit." >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$sdk_root/export.sh"
# REAPER_RELAY_TEST=1 builds the desk relay test firmware (tools/hardware-relay-smoke.ts) into its
# own folder, so it is never published or mistaken for the normal build.
build_dir="$repo_root/build/$board"
extra=()
if [ "${REAPER_RELAY_TEST:-}" = 1 ]; then
  build_dir="$repo_root/build/$board-relay-test"
  extra=(-D REAPER_TEST_RELAYED_ONLY=1)
fi
mkdir -p "$build_dir"
# This prototype's config is generated from the tracked defaults, not menuconfig. The Wireless
# Stick V3 shares the WiFi LoRa 32 V3's defaults and adds its own small overrides.
defaults="$repo_root/firmware/$board/sdkconfig.defaults"
if [ "$board" = heltec-stick-v3 ]; then
  defaults="$repo_root/firmware/heltec-v3/sdkconfig.defaults;$defaults"
fi
rm -f "$build_dir/sdkconfig"
idf.py -C "$repo_root/firmware/$board" -B "$build_dir" \
  -D "SDKCONFIG=$build_dir/sdkconfig" \
  -D "SDKCONFIG_DEFAULTS=$defaults" ${extra[@]+"${extra[@]}"} build
python "$repo_root/tools/firmware-manifest.py" "$board"
