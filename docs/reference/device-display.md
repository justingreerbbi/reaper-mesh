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
- The screen shows what the device itself knows. It never shows message text; the device never
  holds encryption keys.

## Buttons

| Gesture on the main button | Screen off | Screen on |
| --- | --- | --- |
| Single press | Wake on the main page | Turn the screen off |
| Double press | Wake on the main page | Next page |
| Long press (about 1 s) | Wake on the main page | Return to the main page |

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
| Debug | Node ID, USB state and configuration revision, NVS health, radio mode and transmit power in dBm, RX/TX counters, free heap and minimum stack, uptime. |

**Power:** the screen turns off after the configured timeout (30 s by default) counted from
the last button press. Off means display off and
the panel's charge pump off, so it draws almost nothing; the panel keeps its image and wakes
instantly. Frames are drawn at most ten times a second, and unchanged frames are not sent.
The screen is a small part of the board's power draw; the processor and radio receiver use
most of it, so larger savings need the sleep modes planned later in Phase 4.

## Screen settings

The portal's **Settings → Screen** tab sets two values, which are stored in the device
configuration and work with no agent connected. There is no settings page on the device itself.

| Setting | Values | Default |
| --- | --- | --- |
| Turn the screen off after | 10 s, 30 s, 1 min, 5 min or never (the device accepts 0 for never, or 10–3600 s) | 30 s |
| Wake the screen when a message arrives | On or off. When on, a new inbox message turns the screen on at the main page, or restarts the timeout if it is already on | Off |

They use the same revision-checked, atomic configuration writes as other settings, and a write
that omits them keeps the stored values. Wire fields and storage are in the
[protocol](protocol.md#screen-settings-v1-phase-4) and
[persistence](persistence.md#screen-settings-record-5) references.

On November 3 the owner confirmed both settings on the Heltec V3 (`v0.2.0`): with a 10 s timeout
and wake on, the screen turned off after 10 s, and a message from the T-Beam turned it back on.

## Battery and USB power

The top-right corner of the main page shows the board's power, using only what the board
measures. Nothing is estimated.

| State | Shown |
| --- | --- |
| Battery, plugged in | Lightning bolt, percent and gauge icon |
| Battery, not plugged in | Percent and gauge icon |
| Plugged in, no battery | Lightning bolt and `USB` |
| Not measured | Nothing |

The bolt means plugged in (USB power present), whether or not the battery is charging.

| Board | Source | State |
| --- | --- | --- |
| LILYGO T-Beam V1.2 | AXP2101, read only every 2 s while the screen is on: STATUS1 `0x00` bit 5 VBUS good (plugged in) and bit 3 battery present, `0x18` bit 3 fuel gauge enabled, `0xA4` fuel-gauge percent. The percent is shown only when a battery is present and the gauge is enabled. | Built in `v0.2.0`; owner confirmed the percent with a battery and the bolt and `USB` without one |
| Heltec WiFi LoRa 32 V3 | Battery voltage input, not yet verified on hardware; no USB power sense | Not shown |

## Planned

- LED indication: a short blink on TX/RX and a slow blink while there are new messages
  (T-Beam GPIO4; Heltec LED to be verified).

## Code map

| File | Role |
| --- | --- |
| `firmware/app/device_ui.hpp/.cpp` | Button gestures, screen state, font, icon and page drawing |
| `firmware/app/status_display.hpp/.cpp` | Shared SSD1306 driver: power and frame writes |
| `firmware/app/board_input.hpp` | Board button interface |
| `firmware/<board>/main/status_display.cpp` | Board panel power, reset and I2C setup |
| `firmware/<board>/main/board_input.cpp` | Board button pins and optional extra buttons |
| `firmware/app/board_power.hpp`, `firmware/<board>/main/board_power.cpp` | Battery percent and USB power, or unknown |
| `firmware/app/main.cpp` | Samples buttons, applies screen settings, feeds the screen state and redraws |
| `firmware/tests/device_ui_test.cpp` | Host tests; `device_ui_test preview` prints each page as ASCII art |

To change the startup icon, edit the `kIcon` rows in `device_ui.cpp` (32 rows of 32 characters,
`#` for a lit pixel).
