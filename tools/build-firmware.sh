#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
board="${1:-heltec-v3}"
case "$board" in heltec-v3|heltec-wsl-v3|tbeam-v12) ;; *) echo "Unsupported board: $board" >&2; exit 1;; esac
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
mkdir -p "$repo_root/build/$board"
# This prototype's config is generated from the tracked defaults, not menuconfig. The Wireless
# Stick Lite V3 shares the WiFi LoRa 32 V3's defaults and adds its own small overrides.
defaults="$repo_root/firmware/$board/sdkconfig.defaults"
if [ "$board" = heltec-wsl-v3 ]; then
  defaults="$repo_root/firmware/heltec-v3/sdkconfig.defaults;$defaults"
fi
rm -f "$repo_root/build/$board/sdkconfig"
idf.py -C "$repo_root/firmware/$board" -B "$repo_root/build/$board" \
  -D "SDKCONFIG=$repo_root/build/$board/sdkconfig" \
  -D "SDKCONFIG_DEFAULTS=$defaults" build
python "$repo_root/tools/firmware-manifest.py" "$board"
