#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
board="${1:-heltec-v3}"
case "$board" in heltec-v3|tbeam-v12) ;; *) echo "Unsupported board: $board" >&2; exit 1;; esac
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
mkdir -p "$repo_root/build/$board"
# This prototype's config is generated from the tracked defaults, not menuconfig.
rm -f "$repo_root/build/$board/sdkconfig"
idf.py -C "$repo_root/firmware/$board" -B "$repo_root/build/$board" \
  -D "SDKCONFIG=$repo_root/build/$board/sdkconfig" \
  -D "SDKCONFIG_DEFAULTS=$repo_root/firmware/$board/sdkconfig.defaults" build
python "$repo_root/tools/firmware-manifest.py" "$board"
