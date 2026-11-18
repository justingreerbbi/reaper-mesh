#!/usr/bin/env bash
# Installs the pinned Zephyr workspace and SDK used by the T1000-E build (D57) under .tools/.
# Every version and checksum comes from firmware/zephyr.lock.json.
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
lock="$repo_root/firmware/zephyr.lock.json"
tools="$repo_root/.tools"
workspace="$tools/zephyr"
read_lock() { python3 -c "import json,sys;d=json.load(open('$lock'));print(eval(sys.argv[1]))" "$1"; }
commit="$(read_lock "d['commit']")"
sdk_version="$(read_lock "d['sdk']['version']")"
sdk_url="$(read_lock "d['sdk']['url']")"
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) host=macos-aarch64 ;;
  Linux-x86_64) host=linux-x86_64 ;;
  *) echo "No pinned Zephyr SDK for $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac
mkdir -p "$tools/downloads" "$workspace/manifest"

# Python tools in their own environment, so nothing is installed system-wide.
if [ ! -x "$tools/zephyr-venv/bin/west" ]; then
  python3 -m venv "$tools/zephyr-venv"
  "$tools/zephyr-venv/bin/pip" install --quiet --upgrade pip
  "$tools/zephyr-venv/bin/pip" install --quiet "west>=1.2"
fi
export PATH="$tools/zephyr-venv/bin:$PATH"

# A manifest that fetches Zephyr at the pinned commit and only the modules the build needs.
modules="$(read_lock "'\n'.join('          - '+m for m in d['modules'])")"
cat > "$workspace/manifest/west.yml" <<YAML
manifest:
  remotes:
    - name: zephyrproject-rtos
      url-base: https://github.com/zephyrproject-rtos
  projects:
    - name: zephyr
      remote: zephyrproject-rtos
      revision: $commit
      import:
        name-allowlist:
$modules
  self:
    path: manifest
YAML
if [ ! -d "$workspace/.west" ]; then
  (cd "$workspace" && west init -l manifest)
fi
(cd "$workspace" && west update --narrow --fetch-opt=--depth=1)
if [ "$(git -C "$workspace/zephyr" rev-parse HEAD)" != "$commit" ]; then
  echo 'Zephyr checkout does not match firmware/zephyr.lock.json' >&2
  exit 1
fi
pip install --quiet -r "$workspace/zephyr/scripts/requirements-base.txt"

# The SDK: the minimal bundle plus the ARM toolchain, each checked against the lock.
sdk="$tools/zephyr-sdk-$sdk_version"
if [ ! -x "$sdk/gnu/arm-zephyr-eabi/bin/arm-zephyr-eabi-gcc" ]; then
  for name in $(read_lock "' '.join(d['sdk']['files']['$host'])"); do
    file="$tools/downloads/$name"
    expected="$(read_lock "d['sdk']['files']['$host']['$name']")"
    [ -f "$file" ] || curl -fL --retry 3 -o "$file" "$sdk_url/$name"
    actual="$(shasum -a 256 "$file" | cut -d' ' -f1)"
    if [ "$actual" != "$expected" ]; then
      echo "Checksum mismatch for $name" >&2
      rm -f "$file"
      exit 1
    fi
  done
  tar -xf "$tools/downloads/zephyr-sdk-${sdk_version}_${host}_minimal.tar.xz" -C "$tools"
  mkdir -p "$sdk/gnu"
  tar -xf "$tools/downloads/toolchain_gnu_${host}_arm-zephyr-eabi.tar.xz" -C "$sdk/gnu"
fi
# tools/build-t1000e.sh points the build at this SDK, so nothing is registered outside .tools/.
echo "Zephyr $commit and SDK $sdk_version are ready in .tools/"
