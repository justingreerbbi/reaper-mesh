# Heltec Wireless Stick V3

The smallest board, for compact kits and cases: the same ESP32-S3 and Semtech SX1262 as the
[WiFi LoRa 32 V3](heltec-v3.md), with a 0.49-inch screen that shows a compact version of each page.
Buy the 915 MHz version.

**Status:** supported. What has been tested on it is in [Status](../overview/status.md).

| | |
| --- | --- |
| Firmware target | `heltec-stick-v3`, image `heltec-stick-reaper-mesh-v…` |
| Processor | ESP32-S3, 8 MB flash |
| Radio | Semtech SX1262 |
| Screen | 0.49″ 64 × 32 OLED |
| Battery | Optional LiPo; its voltage shows in the portal |
| USB | CP2102 serial bridge |
| Install | [Browser installer](../guides/flashing-firmware.md#install-from-your-browser) |

## Using it

- **Buttons:** **PRG** is the main button (see [buttons](../guides/hardware.md#buttons)). RST
  resets the board.
- **Transmit power:** low −9 dBm, medium +7 dBm, high +22 dBm, at the radio chip. No boost.
- **Screen:** each page in compact form: name, radio state, battery, new messages, nodes and the
  pairing passkey.

## Developer details

Wired like the WiFi LoRa 32 V3 for everything Reaper uses, so its build reuses the V3's board code
(D55). The differences:

| Property | Value |
| --- | --- |
| Screen | 0.49″ 64 × 32 SSD1306 on the V3's I2C pins (SDA 17, SCL 18, reset 21, Vext 36), built with `REAPER_DISPLAY_64X32` |
| 32 kHz crystal | None; Reaper uses the internal clock on both Heltec boards |
| Status LED | White LED on GPIO35 |
| Radio gate | `firmware/heltec-stick-v3/main/board_profile.hpp`. Open on the development unit: the owner confirmed its US/915 MHz model and antenna on November 8, 2026 |

Its chip and USB bridge are identical to the V3's, so neither the updater nor the browser installer
can tell the two apart: choose the board you actually have. The V3's image would run on it, but it
would report itself as a WiFi LoRa 32 V3.
