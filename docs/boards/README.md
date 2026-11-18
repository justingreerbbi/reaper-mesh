# Boards

Every board Reaper Mesh runs on has its own page here, in the same layout: what it is, the facts
you need to buy and use it, and the developer details. To choose a board and see what else you
need, start with [Hardware](../guides/hardware.md).

| Board | Status | Processor | Radio | Good for |
| --- | --- | --- | --- | --- |
| [Heltec WiFi LoRa 32 V3](heltec-v3.md) | Supported | ESP32-S3 | SX1262 | The simplest, cheapest starting point, with a screen |
| [Heltec Wireless Stick V3](heltec-stick-v3.md) | Supported | ESP32-S3 | SX1262 | Compact kits and cases |
| [LILYGO T-Beam V1.2](tbeam-v12.md) | Supported | ESP32 | SX1276 | Battery use, with an 18650 holder and fuel gauge |
| [Seeed SenseCAP T1000-E](t1000-e.md) | Experimental | nRF52840 | LR1110 | A pocket radio used from the phone app |

**Supported** boards have exchanged messages over the radio with the other boards, on hardware,
and keep their settings across restarts. **Experimental** boards install and run, but radio
messaging with the other boards is not verified yet. What has and has not been tested on each board
is in [Status](../overview/status.md#boards).

Every board runs the same firmware core, protocol and settings, so any mix of them can talk to
each other. Only the board adapter differs: pins, radio driver, screen, buttons and power.

Adding a board: follow [the checklist](../contributing/adding-a-board.md) and start its page from
[TEMPLATE.md](TEMPLATE.md).
