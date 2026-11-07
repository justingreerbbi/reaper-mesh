# Device screen and buttons

The on-device screen and buttons are board-local features (Phase 4). They never change the
radio protocol (D41). The design and its rules are in decision D44; this page describes how it
works. Hardware evidence is in the [changelog](../overview/changelog.md).

## General approach

- **Every board has one main button, and every screen function is reachable with it alone.**
  Boards with more buttons get shortcuts, never exclusive functions.
- Screen logic, pages and drawing are shared by all boards in `firmware/app/device_ui.*` and are
  tested on the host. A board only provides the panel setup, the main button level and any
  optional extra button.
- The screen shows what the device itself knows. It never shows message text or keys, and the
  device never holds channel encryption keys.

## Buttons

| Gesture on the main button | Screen off | Screen on |
| --- | --- | --- |
| Single press | Wake on the main page | Turn the screen off |
| Double press | Wake on the main page | Next page |
| Long press (about 1 s) | Wake on the main page | Return to the main page |

Holding on past the long press reaches two Bluetooth actions: 5 s opens pairing and 15 s forgets all paired devices. Both are drawn over any page and keep the screen on; see [Bluetooth link](bluetooth.md).

A single press is reported about 0.3 s after release, once the double-press window has passed.
Presses are debounced for 30 ms. During the startup sequence, any button skips to the main page.

| Board | Main button | Extra buttons |
| --- | --- | --- |
| LILYGO T-Beam V1.2 | Middle button, GPIO38 (active low, board pull-up) | PWR short press: next page. Read from the AXP2101 power-key interrupt: enable INTEN2 `0x41` bit 3, poll INTSTS2 `0x49` bit 3 every 50 ms and clear it by writing 1. Holding PWR about 6 s still powers the board off in hardware. |
| Heltec WiFi LoRa 32 V3 | PRG button, GPIO0 (active low, internal pull-up) | None |

The RST button on both boards resets the processor.

## Screen

128×64 SSD1306, 5×7 first-party font (all printable ASCII, other characters show as `?`) at
1× or 2× size.

**Startup:** a 32×32 Reaper icon for 1.5 s, then "REAPER MESH" and the short version for 1 s.
The USB link and radio start at the same time; nothing waits for the screen.

**Pages** (cycled by double press or T-Beam PWR):

| Page | Contents |
| --- | --- |
| Main | Device name (the node ID if no name is set), radio state `RX`, `TX`, `OFF` or `FAULT`, `NEW n` (inbox messages that arrived after the screen last turned off), `NODES n` (nodes heard), and the firmware version in the bottom-right corner. Top right: the battery (see below), when measured. The name is drawn at 2× when it fits beside the battery (10 characters with no battery shown), otherwise at 1× on the battery's line. |
| Nodes | Up to five heard nodes: name (or node ID), `*` when it shared a position, and last-heard age. |
| Debug | Node ID, USB state and configuration revision, NVS health, radio mode and transmit power in dBm, RX/TX counters, free heap and minimum stack, uptime and the ESP-IDF reset reason (`R1` power-on, `R3` software, `R4` panic, `R5`/`R6`/`R7` watchdog, `R9` brownout). After a Bluetooth failure, a `BLE` line shows the last disconnect (`D`), host reset (`S`) and notification (`N`) reason codes. |

**Power:** the screen turns off after the configured timeout (30 s by default) counted from
the last button press. Off means display off and
the panel's charge pump off, so it draws almost nothing; the panel keeps its image and wakes
instantly. Frames are drawn at most ten times a second, and unchanged frames are not sent.
The screen is a small part of the board's power draw; the processor and radio receiver use
most of it, so larger savings need the sleep modes planned later in Phase 4.

## Screen settings

The portal's **Device → Screen** page sets these values, which are stored in the device
configuration and work with no agent connected. There is no settings page on the device itself.

| Setting | Values | Default |
| --- | --- | --- |
| Turn the screen off after | 10 s, 30 s, 1 min, 5 min or never (the device accepts 0 for never, or 10–3600 s) | 30 s |
| Wake the screen when a message arrives | On or off. When on, a new inbox message turns the screen on at the main page, or restarts the timeout if it is already on | Off |
| Status light | On or off. See [Status LED](#status-led) | On |

They use the same revision-checked, atomic configuration writes as other settings, and a write
that omits them keeps the stored values. Wire fields and storage are in the
[protocol](protocol.md#screen-settings-v1-phase-4) and
[persistence](persistence.md#screen-settings-record-5) references, with the LED under
[its own protocol section](protocol.md#status-led-setting-d53) and
[record 8](persistence.md#status-led-record-8).

On November 3 the owner confirmed both settings on the Heltec V3 (`v0.2.0`): with a 10 s timeout
and wake on, the screen turned off after 10 s, and a message from the T-Beam turned it back on.

## Battery and USB power

The top-right corner of the main page shows the board's power, using only what the board
measures. Nothing is estimated.

| State | Shown |
| --- | --- |
| Battery, plugged in | Lightning bolt, percent and gauge icon |
| Battery, not plugged in | Percent and gauge icon |
| Voltage-only board | Measured battery-rail voltage and outline battery icon; `?` and outline icon if unavailable |
| Plugged in, no battery | Lightning bolt and `USB` |
| Not measured | Nothing |

The bolt means plugged in (USB power present), whether or not the battery is charging.

| Board | Source | State |
| --- | --- | --- |
| LILYGO T-Beam V1.2 | AXP2101, read only every 2 s while the screen is on: STATUS1 `0x00` bit 5 VBUS good (plugged in) and bit 3 battery present, `0x18` bit 3 fuel gauge enabled, `0xA4` fuel-gauge percent. The percent is shown only when a battery is present and the gauge is enabled. | Built in `v0.2.0`; owner confirmed the percent with a battery and the bolt and `USB` without one |
| Heltec WiFi LoRa 32 V3 | Calibrated ADC1 channel 0 (GPIO1), 390 kΩ / 100 kΩ divider gated by GPIO37. Sixteen samples at each control level account for opposite gate polarities on V3.1/V3.2; the divider is disabled between two-second polls. Only 2.5–4.5 V readings are displayed. | Implemented in `v0.6.1`; measured voltage, not an estimated percentage. No USB-sense or battery-presence input: the charger can energize the measured rail even without a battery. Hardware measurement accuracy remains unqualified. |

Heltec pin/divider references: the manufacturer's
[V3.1 schematic](https://resource.heltec.cn/download/WiFi_LoRa_32_V3/HTIT-WB32LA(F)_V3.1_Schematic_Diagram.pdf),
[V3.2 schematic](https://resource.heltec.cn/download/WiFi_LoRa_32_V3/WiFi_LoRa_32_V3.2_Schematic_Diagram.pdf)
and [V3.2 ADC example](https://github.com/HelTecAutomation/Heltec_ESP32/blob/master/examples/ESP32/WiFiLoRa32_battery_read/WiFiLoRa32_battery_read.ino).
ADC setup, calibration or read failures show `?` rather than a stale or invented value.
Both boards otherwise use the same screen, settings, message, discovery and BLE code. The
T-Beam's PMU fuel gauge, USB sensing, extra PWR button and radio boost are hardware-specific.

## Status LED

Since `v0.11.0` (D53), one LED shows activity with nothing else attached. Its policy is shared by all
boards and tested on the host. A board only provides the pin.

| Signal | Pattern |
| --- | --- |
| Radio frame sent or received | A 60 ms pulse. Under constant traffic the pulses are at least 60 ms apart, so it stays readable as blinks |
| Messages waiting | A 200 ms flash every 2 s, until a main or extra button is pressed or an agent attaches. A restart clears it, because the inbox is held in memory |
| Nothing to show, or the setting is off | Dark |

A pulse follows the radio's counters, which include frames the device then discards. So it shows that
something was heard, not that a message arrived. Turning the setting off takes effect at once. It
controls only the status LED. An attached agent clears the slow blink, so a board connected to a portal
shows pulses only. A board with relay on also pulses when it forwards what it heard, so one message can
give two pulses.

Each board has other lights that firmware does not control. From the manufacturers' schematics:

| Board | Status LED | Lit by | Other lights |
| --- | --- | --- | --- |
| Heltec WiFi LoRa 32 V3 | White, LED2, on GPIO35 through 330 Ω | High | Orange, LED1, driven by the charger (`CHRG`) |
| LILYGO T-Beam V1.2 | Red, LED_G5, on GPIO4 through 1 kΩ to 3.3 V | Low | Red, LED_G2, driven by the GPS module's time pulse; blue, LED_G4, on the AXP2101's `CHGLED` output |

Sources: the [Heltec V3.2 schematic](https://resource.heltec.cn/download/WiFi_LoRa_32_V3/WiFi_LoRa_32_V3.2_Schematic_Diagram.pdf)
and the [T-Beam V1.2 schematic](https://github.com/Xinyuan-LilyGO/LilyGo-LoRa-Series/blob/1991b1ed70915d4f246b841f99f6027166ea7330/schematic/LilyGo_TBeam_V1.2.pdf).

## Code map

| File | Role |
| --- | --- |
| `firmware/app/device_ui.hpp/.cpp` | Button gestures, screen state, font, icon, page drawing and the LED policy |
| `firmware/app/board_led.hpp`, `firmware/<board>/main/board_led.cpp` | Board LED pin and polarity |
| `firmware/app/status_display.hpp/.cpp` | Shared SSD1306 driver: power and frame writes |
| `firmware/app/board_input.hpp` | Board button interface |
| `firmware/<board>/main/status_display.cpp` | Board panel power, reset and I2C setup |
| `firmware/<board>/main/board_input.cpp` | Board button pins and optional extra buttons |
| `firmware/app/board_power.hpp`, `firmware/<board>/main/board_power.cpp` | Battery percent and USB power, or unknown |
| `firmware/app/main.cpp` | Samples buttons, applies screen settings, feeds the screen state and redraws |
| `firmware/tests/device_ui_test.cpp` | Host tests; `device_ui_test preview` prints each page as ASCII art |

To change the startup icon, edit the `kIcon` rows in `device_ui.cpp` (32 rows of 32 characters,
`#` for a lit pixel).
