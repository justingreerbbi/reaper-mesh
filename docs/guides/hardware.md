# Hardware

Reaper Mesh runs on three inexpensive LoRa development boards. You need at least **two boards**
to send messages between them, and **three** to test relaying.

> [!WARNING]
> Always attach the antenna before the radio transmits. Transmitting without an antenna can
> damage the radio. Reaper Mesh only supports the **US 915 MHz** band today; buy the 915 MHz
> version of each board.

## Supported boards

| | Heltec WiFi LoRa 32 V3 | Heltec Wireless Stick Lite V3 | LILYGO T-Beam V1.2 |
| --- | --- | --- | --- |
| **Good for** | The simplest, cheapest starting point | Relays and sealed cases: no screen to power or protect | Battery use: it has a battery holder and a fuel gauge |
| Processor | ESP32-S3 | ESP32-S3 | ESP32 |
| Radio chip | Semtech SX1262 | Semtech SX1262 | Semtech SX1276 |
| Flash | 8 MB | 8 MB | 4 MB |
| Screen | 0.96″ 128×64 OLED | None | Optional 128×64 OLED |
| USB chip | CP2102 | CP2102 | CH9102 |
| Battery display | Voltage | Voltage, read in the portal | Percent, plus a plugged-in indicator |
| Firmware target | `heltec-v3` | `heltec-wsl-v3` | `tbeam-v12` |

Other boards, and other bands such as EU 868 MHz, are not supported yet. Adding a board needs a
validated hardware profile and physical testing; see the [roadmap](../overview/roadmap.md).

## What else you need

- A **915 MHz antenna** for each board (usually included).
- A **USB data cable** (not a charge-only cable).
- A computer with **Chrome, Edge or Brave** for the web portal. USB uses Web Serial and
  Bluetooth uses Web Bluetooth; Safari and Firefox support neither.
- For the T-Beam, an optional **18650 battery**.

## Transmit power

Power is set as low, medium or high, so the same setting works on every board. Values are dBm at
the radio chip, before antenna gain. The default is medium.

| Board | Low | Medium | High | With boost |
| --- | ---: | ---: | ---: | --- |
| Heltec V3 and Wireless Stick Lite V3 (SX1262) | −9 dBm | +7 dBm | +22 dBm | No boost |
| T-Beam V1.2 (SX1276, PA_BOOST) | +2 dBm | +10 dBm | +17 dBm | +5 / +13 / +20 dBm |

Boost uses the SX1276's high-power mode, which the datasheet limits to a 1% duty cycle and a
well-matched antenna. Output power on real units has not been measured. Sources:
[Heltec V3 specifications](https://heltec.org/project/wifi-lora-32-v3/),
[SX1261/SX1262 datasheet](https://semtech.my.salesforce.com/sfc/p/E0000000JelG/a/RQ000008nKCH/hp2iKwMDKWl34g1D3LBf_zC7TGBRIo2ff5LMnS8r19s)
and [SX1276 datasheet](https://semtech.my.salesforce.com/sfc/p/E0000000JelG/a/2R0000001Rbr/6EfVZUorrpoKFfvaF_Fkpgp5kzjiNyiAbqcpqh9qSjE).
Details: [Radio configuration](../reference/radio-configuration.md#transmit-power).

## When the radio is allowed to transmit

A freshly flashed board is silent. It transmits only when all of these are true:

1. The radio mode is **Mesh** (Off and Listen never transmit).
2. A **radio network** is chosen: Open mode or a team.
3. The region is **US**, and the board profile confirms the band and antenna.
4. The radio chip passed its startup probe.

The firmware never guesses the region from your computer's time zone.

## Buttons and screen

| Board | Main button | Other buttons |
| --- | --- | --- |
| Heltec V3 and Wireless Stick Lite V3 | **PRG** | RST resets the board |
| T-Beam V1.2 | The **middle** button (GPIO38) | A short **PWR** press goes to the next page; holding PWR about 6 s powers off. RST resets |

On the main button: one press turns the screen on or off, two presses go to the next page, and
a long press returns to the main page. Holding it for **5 seconds** opens Bluetooth pairing.
See [Device screen and buttons](../reference/device-display.md).

## Board details for developers

### Heltec WiFi LoRa 32 V3

| Property | Value |
| --- | --- |
| USB serial | UART0 on GPIO43 (TX) / GPIO44 (RX) at 115200 baud, through the CP2102 (`0x10c4:0xea60`) |
| Radio | SX1262 over DMA-backed SPI, driven by Semtech's pinned driver |
| Flash layout | Bootloader at `0x0`, partition table `0x8000`, settings `reaper_nvs` `0x9000` (`0x5000`), app slot 0 at `0x10000`, Bluetooth `nvs` `0x210000` (`0x8000`), keys `reaper_keys` `0x218000` (`0x2000`) |
| Quirk | Opening the USB port resets the board, so the app waits for it to boot |

The USB chip identifies a serial bridge, not the board revision, band or antenna. Check the
board label and order details before transmitting.

### Heltec Wireless Stick Lite V3

Wired like the WiFi LoRa 32 V3 for everything Reaper uses, so its build reuses the V3's board code:
the same SX1262 pins (CS 8, SCK 9, MOSI 10, MISO 11, reset 12, busy 13, DIO1 14, 1.8 V TCXO,
DIO2 as RF switch), PRG on GPIO0, battery sense on GPIO1 gated by GPIO37, the white LED on GPIO35
and Vext on GPIO36. The differences:

| Property | Value |
| --- | --- |
| Screen | None. Pair Bluetooth over USB in the portal, which shows the passkey |
| 32 kHz crystal | None; Reaper uses the internal clock on both Heltec boards |
| Firmware name | `heltec-wsl-reaper-mesh-v…` |
| Radio gate | Set per unit in `board_profile.hpp`. Open on the development unit: the owner confirmed its US/915 MHz model and antenna on November 8, 2026 |

Its chip and USB bridge are identical to the V3's, so neither the updater nor the browser installer
can tell the two apart: choose the board you actually have. Installing the V3's image on it would
work, but it would report itself as a WiFi LoRa 32 V3.

### LILYGO T-Beam V1.2

| Property | Value |
| --- | --- |
| USB serial | UART0 TX1 / RX3 at 115200 baud, through the CH9102 |
| SPI | SCK 5, MISO 19, MOSI 27, CS 18, reset 23 |
| Radio | SX1276, first-party driver; IRQ polling on DIO0 (26) and DIO1 (33). The probe requires register version `0x12` |
| Power | AXP2101 at I2C `0x34` (SDA 21, SCL 22). It must identify as `0x4a` before the firmware turns on the radio's ALDO2 rail at 3.3 V; no other power settings change |
| Screen | Optional SSD1306 at `0x3c` on the same I2C bus |
| Flash layout | ESP32 with 4 MB flash: bootloader at `0x1000`, partition table `0x8000`, app at `0x10000` |
| Not used | GPS and Wi-Fi are not started |

References (no code copied): [LILYGO T-Beam hardware](https://github.com/Xinyuan-LilyGO/LilyGo-LoRa-Series/blob/1991b1ed70915d4f246b841f99f6027166ea7330/docs/en/t_beam/t_beam_hw.md),
[AXP2101 registers](https://github.com/lewisxhe/XPowersLib/blob/master/src/REG/AXP2101Constants.h)
and [SX1276 registers](https://github.com/Lora-net/LoRaMac-node/blob/master/src/radio/sx1276/sx1276Regs-LoRa.h).

### Both boards

Firmware uses ESP-IDF 5.5.4 and C++17. Secure boot and flash encryption must be off; the
updater refuses a board that has them on and never changes eFuses. Both boards can be plugged
into one computer at once. The web portal talks to one at a time, and the two-board test tools
in `tools/` open each port separately.
