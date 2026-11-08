# Flashing firmware

There are two ways to put Reaper Mesh firmware on a board:

| | Best for | What you need |
| --- | --- | --- |
| **[Browser installer](#install-from-your-browser)** | Everyone. Pick your board and click Install | Chrome, Edge or Brave on a computer, and a USB cable |
| **[Build from source](#build-and-install-from-source)** | Developers changing the firmware | The ESP-IDF toolchain, about 20 minutes to set up |

Both write the same four images, check the board first, and keep your Reaper Mesh settings,
Bluetooth pairings and network keys.

> [!IMPORTANT]
> Releases are not signed yet. The browser installer serves firmware built by this repository's
> CI from the latest `main`, and checks every image against its published SHA-256 hash; that
> detects corruption, not a malicious publisher. Installing replaces the board's existing
> firmware. Boards with secure boot or flash encryption are refused.

## Install from your browser

1. Open the installer: **<https://justingreerbbi.github.io/reaper-mesh/flash/>**, or
   **Device → Install or update firmware** in the web portal.
2. **Choose your board** (Heltec V3 or T-Beam V1.2). Each shows the firmware version it will
   install.
3. Plug the board in with a USB **data** cable and close the web portal or anything else using
   it.
4. Select **Connect and install**, pick the board's port in the browser's list, and keep it
   plugged in for about a minute.

Before writing, the installer downloads the four images and checks their sizes and SHA-256
hashes, then confirms the board has the right processor and flash size and that secure boot and
flash encryption are off, the same checks as the command-line updater below. After writing, the
board's bootloader confirms every image with an MD5 check, and the board restarts. Open the
portal and connect to confirm the new version. The **Technical log** on the page shows every
step.

The installer's code is in `agents/flasher/`. To try a local copy with firmware you built, run
`npm run build:site` and then `npm run preview:site`, and open
<http://127.0.0.1:4173/reaper-mesh/flash/>. How the hosted copy is built and published is in
[Development and CI](../contributing/development.md#github-pages).

## Build and install from source

This builds the firmware yourself and installs it with the command-line updater.

### What you need

- A supported board and a USB data cable ([Hardware](hardware.md)).
- macOS or Linux with Git, Python 3.9+ and Node.js 24 or 25.
- About 3 GB of free disk space for the ESP-IDF toolchain.

### 1. Install the toolchain (once)

From the repository root:

```sh
bash tools/bootstrap-esp-idf.sh
```

This downloads ESP-IDF 5.5.4, pinned to an exact commit in `firmware/esp-idf.lock.json`, into
the ignored `.tools/` folder. It does not touch anything outside the repository.

### 2. Build

| Board | Build command | Manifest |
| --- | --- | --- |
| Heltec V3 | `bash tools/build-firmware.sh` | `build/heltec-v3/reaper-manifest.json` |
| T-Beam V1.2 | `bash tools/build-firmware.sh tbeam-v12` | `build/tbeam-v12/reaper-manifest.json` |

The build writes a manifest that records each image's size, hash and flash address, the source
commit, the SDK version and the protocol versions.

### 3. Check the build

Validate the build without opening any device:

```sh
python3 tools/update-firmware.py
```

For the T-Beam, add `--manifest build/tbeam-v12/reaper-manifest.json`.

### 4. Install

Close the web portal (or disconnect it) so the USB port is free, keep the board on USB power,
then run the same command with `--flash` and the board's port:

```sh
python3 tools/update-firmware.py --flash --port /dev/cu.usbserial-0001
```

Find the port with `ls /dev/cu.*` on macOS or `ls /dev/ttyUSB* /dev/ttyACM*` on Linux. The
Heltec's CP2102 usually shows as `usbserial-…`; the T-Beam's CH9102 as `wchusbserial…`.

The updater shows progress and verifies every image after writing it.

### 5. Confirm it worked

Open the web portal, connect over USB, and check on the **Device** tab that:

- the firmware version is the one you built,
- your settings (name, region, radio) are still there, and
- the radio status reads **ready** (or tells you what it is waiting for, such as a network).

A freshly flashed board is silent until you choose a radio network in
**Device → Radio network**.

## If something goes wrong

| Problem | Fix |
| --- | --- |
| The installer or updater cannot reach the bootloader | Hold **PRG/BOOT**, tap **RESET**, release PRG, then run the same command again |
| The install stopped partway | Assume the app is incomplete. Run the same install again; this has recovered every interrupted install so far |
| The port will not open, or is busy | Close anything else using it (the portal, another tab, a serial monitor), unplug and replug the cable at the computer, and retry |
| The board connects but storage reports an error | Do **not** erase the board. Read the error in **Device → Diagnostics** and open an issue |

The board's ROM loader is always available, so a failed install can be reinstalled. There is
no automatic rollback yet.

## What the updater checks

The command-line updater (`tools/update-firmware.py`) refuses to write unless everything matches. The Pages build runs the same validation on every firmware image before publishing it, and the browser installer repeats the hash, chip, flash-size and security checks on the board itself:

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
