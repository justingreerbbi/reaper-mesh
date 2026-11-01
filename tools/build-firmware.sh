#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
export IDF_TOOLS_PATH="$repo_root/.tools/espressif"
sdk_root="$repo_root/.tools/esp-idf"
if [ ! -f "$sdk_root/export.sh" ]; then
  echo 'Run bash tools/bootstrap-esp-idf.sh first.' >&2
  exit 1
fi
if [ "$(git -C "$sdk_root" rev-parse HEAD)" != 735507283d5b2f9fb363a1901172dbd9e847945d ]; then
  echo 'Unexpected ESP-IDF revision.' >&2
  exit 1
fi
source "$sdk_root/export.sh"
mkdir -p "$repo_root/build/heltec-v3"
# This prototype's config is generated from the tracked defaults, not menuconfig.
rm -f "$repo_root/build/heltec-v3/sdkconfig"
idf.py -C "$repo_root/firmware/heltec-v3" -B "$repo_root/build/heltec-v3" \
  -D "SDKCONFIG=$repo_root/build/heltec-v3/sdkconfig" \
  -D "SDKCONFIG_DEFAULTS=$repo_root/firmware/heltec-v3/sdkconfig.defaults" build
python "$repo_root/tools/firmware-manifest.py"
