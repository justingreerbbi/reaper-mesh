# Heltec WiFi LoRa 32 V3

The simplest, cheapest place to start: an ESP32-S3 board with a Semtech SX1262 radio and a
0.96-inch screen that shows the node's name, radio state, messages and battery. Buy the 915 MHz
version.

**Status:** supported. What has been tested on it is in [Status](../overview/status.md).

| | |
| --- | --- |
| Firmware target | `heltec-v3`, image `heltec-reaper-mesh-v…` |
| Processor | ESP32-S3, 8 MB flash |
| Radio | Semtech SX1262 |
| Screen | 0.96″ 128 × 64 OLED |
| Battery | Optional LiPo; the screen shows its voltage |
| USB | CP2102 serial bridge |
| Install | [Browser installer](../guides/flashing-firmware.md#install-from-your-browser) |

## Using it

- **Buttons:** **PRG** is the main button (see [buttons](../guides/hardware.md#buttons)). RST
  resets the board.
- **Transmit power:** low −9 dBm, medium +7 dBm, high +22 dBm, at the radio chip. No boost.
- **Battery:** a measured battery-rail voltage and icon; no percentage. See
  [Device screen and buttons](../reference/device-display.md#battery-and-usb-power).

## Developer details

| Property | Value |
| --- | --- |
| USB serial | UART0 on GPIO43 (TX) / GPIO44 (RX) at 115200 baud, through the CP2102 (`0x10c4:0xea60`) |
| Radio | SX1262 over DMA-backed SPI, driven by Semtech's pinned driver: CS 8, SCK 9, MOSI 10, MISO 11, reset 12, busy 13, DIO1 14, 1.8 V TCXO, DIO2 as RF switch |
| Screen | SSD1306 on I2C (SDA 17, SCL 18, reset 21), powered by Vext (GPIO36) |
| Battery sense | GPIO1, divider gated by GPIO37 |
| Flash layout | Bootloader at `0x0`, partition table `0x8000`, settings `reaper_nvs` `0x9000` (`0x5000`), app slot 0 at `0x10000`, Bluetooth `nvs` `0x210000` (`0x8000`), keys `reaper_keys` `0x218000` (`0x2000`) |
| Radio gate | `firmware/heltec-v3/main/board_profile.hpp`. Open on the development unit: the owner confirmed its US/915 MHz model and antenna on November 1, 2026 |
| Quirk | Opening the USB port resets the board, so the agent waits for it to boot |

The USB chip identifies a serial bridge, not the board revision, band or antenna. Check the board
label and order details before transmitting.

Sources: [Heltec V3 product page](https://heltec.org/project/wifi-lora-32-v3/) and
[SX1261/SX1262 datasheet](https://semtech.my.salesforce.com/sfc/p/E0000000JelG/a/RQ000008nKCH/hp2iKwMDKWl34g1D3LBf_zC7TGBRIo2ff5LMnS8r19s).
