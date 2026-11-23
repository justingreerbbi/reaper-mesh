# Signals add-on firmware (XIAO ESP32-C5)

Firmware for the [signals add-on](../../docs/contributing/signals-design.md) (D60) on a Seeed
Studio XIAO ESP32-C5. It listens to Wi-Fi on 2.4 and 5 GHz, Bluetooth LE and drone Remote ID, and
reports to the portal over USB with the [sensor protocol](../../docs/reference/sensor-protocol.md).
It only listens: it never transmits Wi-Fi frames, its capture filter delivers management frames
only, and Bluetooth scanning is passive.

The image is `xiaoc5-reaper-sensor-v0.1.0`. It is not a mesh node: it has no LoRa radio and does
not speak the node protocol.

## What is where

- `main/main.cpp` connects the radios and USB to the portable core: Wi-Fi capture and Bluetooth
  scanning callbacks queue observations, and the main loop runs the scan schedule, the tables and
  the USB session.
- `../components/reaper_sensor/` holds the parsers, tables, scheduler and session, covered by host
  tests (`firmware/tests/sensor_scan_test.cpp`, run from `npm run check` and CTest).

## Build and flash

From the repository root, after `bash tools/bootstrap-esp-idf.sh`:

```bash
export IDF_TOOLS_PATH="$PWD/.tools/espressif" && source .tools/esp-idf/export.sh
```

```bash
idf.py -C firmware/xiao-esp32c5-sensor -B build/xiao-esp32c5-sensor -D SDKCONFIG="$PWD/build/xiao-esp32c5-sensor/sdkconfig" -D SDKCONFIG_DEFAULTS="$PWD/firmware/xiao-esp32c5-sensor/sdkconfig.defaults" -p /dev/cu.usbmodemXXXX flash
```

The installer and CI do not build it yet (Phase 4 of the design).

## Board quirks found on the bench

- **The console must stay on UART0.** A USB-only console hangs every boot in ROM waiting for UART0.
  UART0 uses GPIO11 and GPIO12 (XIAO D6 and D7), and USB carries only protocol frames.
- **After flashing over USB, a USB reset can leave the chip in download mode.** Press RESET on the
  board, or unplug and replug it. If esptool cannot connect, hold BOOT, press RESET, release BOOT,
  and flash again.
- **JTAG works without download mode.** The same USB connection carries the chip's JTAG, so the
  pinned OpenOCD can write and verify images (`program_esp`) and show where the CPU is.
- **Opening the USB port restarts the board.** The portal repeats its hello while it starts.
