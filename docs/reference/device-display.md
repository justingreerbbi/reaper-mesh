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
| Main | Device name (2× when it fits in 10 characters; the node ID if no name is set), radio state `RX`, `TX`, `OFF` or `FAULT`, `NEW n` (inbox messages that arrived after the screen last turned off), `NODES n` (nodes heard), and the firmware version in the bottom-right corner. Battery percent will appear bottom-left once measured; it is never estimated. |
| Nodes | Up to five heard nodes: name (or node ID), `*` when it shared a position, and last-heard age. |
| Debug | Node ID, USB state and configuration revision, NVS health, radio mode and power, RX/TX counters, free heap and minimum stack, uptime. |

**Power:** the screen turns off 30 s after the last button press. Off means display off and
the panel's charge pump off, so it draws almost nothing; the panel keeps its image and wakes
instantly. Frames are drawn at most ten times a second, and unchanged frames are not sent.
The screen is a small part of the board's power draw; the processor and radio receiver use
most of it, so larger savings need the sleep modes planned later in Phase 4.

## Built-in defaults and planned settings

Step 1 uses fixed defaults. Planned next:

- Device settings for the screen timeout (never, 10, 30, 60 or 300 s) and optional wake on a new
  message, stored on the device and editable in the portal.
- LED indication: a short blink on TX/RX and a slow blink while there are new messages
  (T-Beam GPIO4; Heltec LED to be verified).
- Battery percent: T-Beam from the AXP2101 fuel gauge, Heltec from its battery voltage input
  (both to be verified on hardware).

## Code map

| File | Role |
| --- | --- |
| `firmware/app/device_ui.hpp/.cpp` | Button gestures, screen state, font, icon and page drawing |
| `firmware/app/status_display.hpp/.cpp` | Shared SSD1306 driver: power and frame writes |
| `firmware/app/board_input.hpp` | Board button interface |
| `firmware/<board>/main/status_display.cpp` | Board panel power, reset and I2C setup |
| `firmware/<board>/main/board_input.cpp` | Board button pins and optional extra buttons |
| `firmware/app/main.cpp` | Samples buttons, feeds the screen state and redraws |
| `firmware/tests/device_ui_test.cpp` | Host tests; `device_ui_test preview` prints each page as ASCII art |

To change the startup icon, edit the `kIcon` rows in `device_ui.cpp` (32 rows of 32 characters,
`#` for a lit pixel).
