#!/usr/bin/env bash
# Builds the T1000-E firmware (D57) with the Zephyr workspace and SDK pinned in
# firmware/zephyr.lock.json (run tools/bootstrap-zephyr.sh first). Writes build/t1000-e/ with
# t1000e-reaper-mesh-v<version>-install.uf2 (first install over other firmware: also blanks the
# settings, key and Bluetooth areas) and -update.uf2 (keeps them).
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
tools="$repo_root/.tools"
lock="$repo_root/firmware/zephyr.lock.json"
expected_commit="$(python3 -c "import json;print(json.load(open('$lock'))['commit'])")"
sdk_version="$(python3 -c "import json;print(json.load(open('$lock'))['sdk']['version'])")"
export ZEPHYR_BASE="$tools/zephyr/zephyr"
export ZEPHYR_SDK_INSTALL_DIR="$tools/zephyr-sdk-$sdk_version"
export PATH="$tools/zephyr-venv/bin:$PATH"
if [ ! -d "$ZEPHYR_BASE" ] || [ ! -d "$ZEPHYR_SDK_INSTALL_DIR" ]; then
  echo 'Run bash tools/bootstrap-zephyr.sh first.' >&2
  exit 1
fi
if [ "$(git -C "$ZEPHYR_BASE" rev-parse HEAD)" != "$expected_commit" ]; then
  echo "Unexpected Zephyr revision; firmware/zephyr.lock.json requires $expected_commit." >&2
  exit 1
fi
# REAPER_RELAY_TEST=1 builds the desk relay test firmware into its own folder.
build_dir="$repo_root/build/t1000-e"
extra=()
suffix=""
if [ "${REAPER_RELAY_TEST:-}" = 1 ]; then
  build_dir="$repo_root/build/t1000-e-relay-test"
  extra=(-D REAPER_TEST_RELAYED_ONLY=1)
  suffix="-relay-test"
fi
cmake -S "$repo_root/firmware/t1000-e" -B "$build_dir" -G Ninja ${extra[@]+"${extra[@]}"}
ninja -C "$build_dir"
version="$(sed -n 's/.*"t1000e-reaper-mesh-v\([0-9.]*\)".*/\1/p' \
  "$repo_root/firmware/components/reaper_device/include/reaper/version.hpp")"
python3 "$repo_root/tools/uf2-image.py" "$build_dir/zephyr/zephyr.bin" "$build_dir" \
  "t1000e-reaper-mesh-v$version$suffix"
