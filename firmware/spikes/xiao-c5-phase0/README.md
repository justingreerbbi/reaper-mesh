# XIAO ESP32-C5 Phase 0 spike

Throwaway bench firmware for Phase 0 of the [signals add-on](../../../docs/contributing/signals-design.md#phase-0-bench-spike)
(D60). It checks what a Seeed Studio XIAO ESP32-C5 actually hears. It is not a product build and
is not published by CI or the installer.

It only listens. It never transmits Wi-Fi frames, its capture filter delivers management frames
only (data frames never reach the code), and it scans Bluetooth passively, so it sends no scan
requests. It prints counts as one JSON object a line, never addresses or network names.

Each 36-second cycle:

1. Sweeps Wi-Fi channels 1 to 11 and the 25 US 5 GHz channels, 250 ms each, counting beacons,
   probe requests and responses, action and NAN frames, Remote ID beacons and access points.
2. Scans Bluetooth on LE 1M and Coded PHY together for 6 seconds, then Coded PHY alone, counting
   reports, devices and Remote ID advertisements.
3. Listens on Wi-Fi channel 6 alone, then together with a Bluetooth scan, then scans Bluetooth
   alone, to show how the shared radio splits.

## Build and flash

From the repository root, after `bash tools/bootstrap-esp-idf.sh`:

```bash
export IDF_TOOLS_PATH="$PWD/.tools/espressif" && source .tools/esp-idf/export.sh
idf.py -C firmware/spikes/xiao-c5-phase0 -B build/xiao-c5-phase0 -D SDKCONFIG="$PWD/build/xiao-c5-phase0/sdkconfig" -D SDKCONFIG_DEFAULTS="$PWD/firmware/spikes/xiao-c5-phase0/sdkconfig.defaults" -p /dev/cu.usbmodemXXXX flash
```

Opening the USB port resets the board, so read it with any serial terminal and expect a `boot`
line first. The console must stay on UART0 with USB as the secondary output: a USB-only console
hangs the boot in ROM (see the Phase 0 results). If a board is stuck, hold BOOT, press RESET,
release BOOT, and flash again.
