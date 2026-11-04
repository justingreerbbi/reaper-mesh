# Hardware

Reaper Mesh currently targets two boards. Both are owner-confirmed US/915 MHz units with
their antennas attached. For the dated bring-up and test evidence, see the
[changelog](../overview/changelog.md).

## Supported boards

| Board | SoC | Radio | Flash | USB bridge | Port (this setup) |
| --- | --- | --- | --- | --- | --- |
| Heltec WiFi LoRa 32 V3 | ESP32-S3FN8 | SX1262 | 8 MB (GD) | CP2102 | `/dev/cu.usbserial-0001` |
| LILYGO T-Beam V1.2 | ESP32-D0WDQ6-V3 | SX1276 | 4 MB (Winbond) | CH9102 | `/dev/cu.wchusbserial57700003341` |

Full board-specific wiring, power rails, and radio bring-up for the T-Beam are in
[T-Beam V1.2](t-beam-v12.md).

### Manufacturer transmit power

Power is expressed in dBm at the radio output, before antenna gain. The radio-chip
programming ranges and board output specifications have different scopes:

| Board | Manufacturer radio minimum | Manufacturer radio maximum | Board specification | Current Reaper Mesh TX range |
| --- | --- | --- | --- | --- |
| Heltec WiFi LoRa 32 V3 (SX1262) | −9 dBm | +22 dBm | Heltec specifies maximum output as 21 ± 1 dBm; it does not specify a board-level minimum on its product page | 0–10 dBm |
| LILYGO T-Beam V1.2 (SX1276, PA_BOOST path) | +2 dBm | +20 dBm with high-power settings; normal PA_BOOST operation is +2 to +17 dBm | Values describe the SX1276 PA_BOOST path used by this board; they are not measurements of this unit | 2–10 dBm |

Manufacturer sources, checked November 4, 2026: [Heltec V3 product specifications](https://heltec.org/project/wifi-lora-32-v3/),
[Semtech SX1261/SX1262 datasheet](https://semtech.my.salesforce.com/sfc/p/E0000000JelG/a/RQ000008nKCH/hp2iKwMDKWl34g1D3LBf_zC7TGBRIo2ff5LMnS8r19s)
(SetTxParams), and [Semtech SX1276/77/78/79 datasheet](https://semtech.my.salesforce.com/sfc/p/E0000000JelG/a/2R0000001Rbr/6EfVZUorrpoKFfvaF_Fkpgp5kzjiNyiAbqcpqh9qSjE)
(RF power amplifiers and +20 dBm operation). The SX1276 +20 dBm mode has additional
supply, duty-cycle and antenna-mismatch conditions in the datasheet.

These manufacturer capabilities do not expand the firmware limits in
[radio configuration](../reference/radio-configuration.md) and the [T-Beam guide](t-beam-v12.md).
Actual output power on these units has not been measured; see [Status](../overview/status.md).

## Heltec WiFi LoRa 32 V3

### Confirmed inventory

Read-only USB inspection on November 1, 2026 found:

| Property | Value |
| --- | --- |
| Serial port | `/dev/cu.usbserial-0001` |
| USB product | CP2102 USB to UART Bridge Controller, Silicon Labs |
| USB vendor / product ID | `0x10c4` / `0xea60` |
| SoC | ESP32-S3, revision v0.2 |
| Flash | 8 MB, 40 MHz crystal, quad (DIO) wiring |
| Secure boot / flash encryption | Both disabled |
| Display | 0.96″ 128×64 SSD1306 OLED |
| NVS partition | offset `0x9000`, size `0x5000` |
| RF band | **Owner-reported US/915 MHz**, not electronically verified |

> [!IMPORTANT]
> The USB bridge identifies a UART path — it does **not** prove the board model, PCB
> revision, RF band, antenna, or flash size. Treat the US band as owner-reported. Check the
> board label and order details before any radio firmware development or transmission.
> ROM serial commands opened/reset the device and ran a read-only RAM stub; no flash, erase,
> or eFuse writes occurred.

### Manufacturer baseline

Heltec documents the WiFi LoRa 32 V3 with an ESP32-S3FN8, SX1262 transceiver, CP2102 USB
UART, the 128×64 OLED, and a nominal 8 MB flash
([product details](https://heltec.org/project/wifi-lora-32-v3/), checked November 1, 2026).
These identify the expected board family, not an electronic verification of this specific unit.

### Firmware posture

The USB-only ESP-IDF v5.5.4 application integrates the portable session engine, framed UART0
at 115200, fresh boot IDs, and a fail-closed NVS backend. The firmware preserves the existing
NVS range and uses a separate namespace/key with no automatic erase fallback. The owner
explicitly declined preserving the factory firmware/settings, so no backup gates the first
flash; recovery means reinstalling a reviewed Reaper image through the ESP32-S3 ROM loader.
See the [first-flash walkthrough](first-flash.md) and [Flashing firmware](flashing-firmware.md).

## LILYGO T-Beam V1.2

| Property | Value |
| --- | --- |
| SoC | ESP32-D0WDQ6-V3, revision 3.1 |
| Radio | SX1276 (register-version `0x12` gated) |
| Power management | AXP2101 at I2C `0x34` (identifies as `0x4a`) |
| Flash | 4 MB Winbond, 40 MHz crystal |
| MAC | `08:b6:1f:9f:e5:48` |
| Node ID | `node-000008b61f9fe548` |
| Port | `/dev/cu.wchusbserial57700003341` (alias `/dev/cu.usbserial-57700003341`) |
| RF band | Owner-confirmed US/915 MHz, antenna attached |

Both boards can stay connected to one computer at the same time. The web console handles one
device at a time; automated two-board tests use separate serial adapters. Recheck device/port
identities after reconnects. Details are in [T-Beam V1.2](t-beam-v12.md).

## Antenna and transmission gate

RF transmission is disabled by default on both boards. The owner confirmed the US/915 MHz
antennas are attached, which clears the board antenna gate recorded in each board profile.
Transmission still requires explicit mesh mode plus confirmed region, board, antenna, and
driver readiness — firmware never infers a regulatory region from the computer's timezone.
