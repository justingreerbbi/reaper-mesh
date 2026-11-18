# LILYGO T-Beam V1.2

Built for battery use: an ESP32 with a Semtech SX1276 radio, an 18650 battery holder and an
AXP2101 power chip with a fuel gauge, so the screen shows a battery percentage. Buy the 915 MHz
version; the screen is optional on some kits.

**Status:** supported. What has been tested on it is in [Status](../overview/status.md).

| | |
| --- | --- |
| Firmware target | `tbeam-v12`, image `tbeam-reaper-mesh-v…` |
| Processor | ESP32 (D0WD), 4 MB flash |
| Radio | Semtech SX1276 |
| Screen | Optional 0.96″ 128 × 64 OLED |
| Battery | 18650; percentage and a plugged-in indicator from the fuel gauge |
| USB | CH9102 serial bridge |
| Install | [Browser installer](../guides/flashing-firmware.md#install-from-your-browser) |

## Using it

- **Buttons:** the **middle** button (GPIO38) is the main button (see
  [buttons](../guides/hardware.md#buttons)). A short **PWR** press goes to the next page; holding
  PWR about 6 seconds powers off. RST resets.
- **Transmit power:** low +2 dBm, medium +10 dBm, high +17 dBm, at the radio chip. **Boost** adds
  about 3 dB at each level (+5, +13, +20 dBm); the datasheet limits it to a 1% duty cycle and a
  well-matched antenna, and it is off until turned on.
- **Not used:** GPS and Wi-Fi are never started.

## Developer details

| Property | Value |
| --- | --- |
| USB serial | UART0 TX1 / RX3 at 115200 baud, through the CH9102 |
| SPI | SCK 5, MISO 19, MOSI 27, CS 18, reset 23 |
| Radio | SX1276, first-party driver; IRQ polling on DIO0 (26) and DIO1 (33). The probe requires register version `0x12` |
| Power | AXP2101 at I2C `0x34` (SDA 21, SCL 22). It must identify as `0x4a` before the firmware turns on the radio's ALDO2 rail at 3.3 V; no other power settings change |
| Screen | Optional SSD1306 at `0x3c` on the same I2C bus |
| Flash layout | Bootloader at `0x1000`, partition table `0x8000`, app at `0x10000` |
| Radio gate | `firmware/tbeam-v12/main/tbeam_profile.hpp`. Open on the development unit (owner-confirmed US/915 MHz model and antenna) |

Sources (no code copied):
[LILYGO T-Beam hardware](https://github.com/Xinyuan-LilyGO/LilyGo-LoRa-Series/blob/1991b1ed70915d4f246b841f99f6027166ea7330/docs/en/t_beam/t_beam_hw.md),
[AXP2101 registers](https://github.com/lewisxhe/XPowersLib/blob/master/src/REG/AXP2101Constants.h),
[SX1276 registers](https://github.com/Lora-net/LoRaMac-node/blob/master/src/radio/sx1276/sx1276Regs-LoRa.h)
and the [SX1276 datasheet](https://semtech.my.salesforce.com/sfc/p/E0000000JelG/a/2R0000001Rbr/6EfVZUorrpoKFfvaF_Fkpgp5kzjiNyiAbqcpqh9qSjE).
