# Flashing firmware

This guide builds Reaper Mesh firmware from source and installs it on a board over USB. It
takes about 20 minutes the first time, most of it downloading the toolchain.

> [!IMPORTANT]
> Releases are not signed yet, so build from source you have reviewed. Installing replaces the
> board's existing firmware. Your Reaper Mesh settings, Bluetooth pairings and network keys are
> kept between Reaper Mesh installs. Do not flash boards that use secure boot or flash
> encryption; the updater refuses them.

## What you need

- A supported board and a USB data cable ([Hardware](hardware.md)).
- macOS or Linux with Git, Python 3.9+ and Node.js 24 or 25.
- About 3 GB of free disk space for the ESP-IDF toolchain.

## 1. Install the toolchain (once)

From the repository root:

```sh
bash tools/bootstrap-esp-idf.sh
```

This downloads ESP-IDF 5.5.4, pinned to an exact commit in `firmware/esp-idf.lock.json`, into
the ignored `.tools/` folder. It does not touch anything outside the repository.

## 2. Build

| Board | Build command | Manifest |
| --- | --- | --- |
| Heltec V3 | `bash tools/build-firmware.sh` | `build/heltec-v3/reaper-manifest.json` |
| T-Beam V1.2 | `bash tools/build-firmware.sh tbeam-v12` | `build/tbeam-v12/reaper-manifest.json` |

The build writes a manifest that records each image's size, hash and flash address, the source
commit, the SDK version and the protocol versions.

## 3. Check the build

Validate the build without opening any device:

```sh
python3 tools/update-firmware.py
```

For the T-Beam, add `--manifest build/tbeam-v12/reaper-manifest.json`.

## 4. Install

Close the web portal (or disconnect it) so the USB port is free, keep the board on USB power,
then run the same command with `--flash` and the board's port:

```sh
python3 tools/update-firmware.py --flash --port /dev/cu.usbserial-0001
```

Find the port with `ls /dev/cu.*` on macOS or `ls /dev/ttyUSB* /dev/ttyACM*` on Linux. The
Heltec's CP2102 usually shows as `usbserial-…`; the T-Beam's CH9102 as `wchusbserial…`.

The updater shows progress and verifies every image after writing it.

## 5. Confirm it worked

Open the web portal, connect over USB, and check on the **Device** tab that:

- the firmware version is the one you built,
- your settings (name, region, radio) are still there, and
- the radio status reads **ready** (or tells you what it is waiting for, such as a network).

A freshly flashed board is silent until you choose a radio network in
**Device → Radio network**.

## If something goes wrong

| Problem | Fix |
| --- | --- |
| The updater cannot enter download mode | Hold **PRG/BOOT**, tap **RESET**, release PRG, then run the same command again |
| The install stopped partway | Assume the app is incomplete. Run the same install again; this has recovered every interrupted install so far |
| The port will not open | Close anything else using it (the portal, a serial monitor), unplug and replug the cable at the computer, and retry |
| The board connects but storage reports an error | Do **not** erase the board. Read the error in **Device → Diagnostics** and open an issue |

The board's ROM loader is always available, so a failed install can be reinstalled. There is
no automatic rollback yet.

## What the updater checks

The updater (`tools/update-firmware.py`) refuses to write unless everything matches:

- **Source:** the build is from a clean, committed tree, with supported protocol and storage
  schemas and the pinned SDK.
- **Target:** the board's chip and flash size match the manifest (ESP32-S3 with 8 MB for the
  Heltec, ESP32 with 4 MB for the T-Beam). Wrong targets fail closed.
- **Images:** every path, flash offset, size and SHA-256 hash, the ESP image checksums, and the
  fixed partition table.
- **Security:** secure boot and flash encryption are off, read without changing any eFuse.

It writes four images (bootloader, partition table, OTA data and the application) and never the
settings (`reaper_nvs`), Bluetooth (`nvs`) or key (`reaper_keys`) partitions. It never erases
the whole chip. Checksums detect corruption; they do not prove who built the firmware.

### Options

| Option | Use |
| --- | --- |
| `--manifest PATH` | Choose a board's manifest (required for the T-Beam) |
| `--flash --port PORT` | Install to that port |
| `--allow-dirty` | Allow a build from uncommitted changes, for local development only. It prints a warning and is never a release build |
| `--python PATH` | Use another Python environment that has esptool 4.12.0 |

## Build a firmware bundle

To hand someone a ready-to-flash package:

```sh
python3 tools/package-firmware.py --output build/heltec-v3/heltec-reaper-mesh-v0.11.1.zip
```

The zip holds the images, manifest, a standalone updater, an exact source archive,
`SHA256SUMS`, recovery instructions and the required SDK and Semtech notices. It refuses to
overwrite an existing file and uploads nothing. For the T-Beam, pass its `--manifest`.

## Hardware test tools

`tools/hardware-*.ts` and `tools/hardware-smoke.py` run checks against real boards, for example
two-board delivery:

```sh
node tools/hardware-pair-smoke.ts .tools/espressif/python_env/idf5.5_py3.12_env/bin/python \
  /dev/cu.usbserial-0001 /dev/cu.wchusbserial57700003341
```

They are never run by `npm run check`. Some change board settings and restore them afterward,
so read a tool's header before running it, and close the portal first.
