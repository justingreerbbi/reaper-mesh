#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
sdk_root="$repo_root/.tools/esp-idf"
export IDF_TOOLS_PATH="$repo_root/.tools/espressif"
sdk_commit=735507283d5b2f9fb363a1901172dbd9e847945d
mkdir -p "$repo_root/.tools"
if [ ! -d "$sdk_root" ]; then
  git clone --branch v5.5.4 --depth 1 --recursive --shallow-submodules https://github.com/espressif/esp-idf.git "$sdk_root"
fi
if [ "$(git -C "$sdk_root" rev-parse HEAD)" != "$sdk_commit" ]; then
  echo 'ESP-IDF checkout does not match firmware/esp-idf.lock.json' >&2
  exit 1
fi
"$sdk_root/install.sh" esp32s3
