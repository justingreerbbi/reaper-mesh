# Initial hardware inventory

Read-only inspection on November 1, 2026 found:

- Serial port: `/dev/cu.usbserial-0001`.
- USB product: CP2102 USB to UART Bridge Controller, Silicon Labs.
- USB vendor/product IDs: `0x10c4` / `0xea60`.
- Owner confirms a US-model Heltec V3 / Version 3 board with the built-in display. This is the target board family; exact PCB subrevision and electronic flash identification remain unverified.

The USB bridge identification is consistent with a USB UART path but does not prove the board model, revision, RF band, antenna, or flash size. Treat US band as owner-reported, not electronically verified. Check the board label/order details before radio firmware development and transmission. No serial connection was opened, no reset was requested, and nothing was flashed.

Local tools observed: Node 25.9.0, npm 11.12.1, Python 3.12.4. `idf.py` was not on PATH. Host tests use the built-in Node TypeScript runner plus pinned development tooling and a C++17 host compiler. Node 24 is the proposed development baseline; Node 25 is the current locally tested runtime. ESP-IDF installation and version selection remain pending.

## Display and manufacturer baseline

The owner describes the screen as an LCD. Heltec documents the WiFi LoRa 32 V3 built-in screen as a 0.96-inch 128×64 OLED, with ESP32-S3FN8, SX1262, CP2102 USB UART, and nominal 8 MB flash. Source: [Heltec V3 product details](https://heltec.org/project/wifi-lora-32-v3/), checked November 1, 2026. These identify the expected board family, not an electronic verification of this unit. No display driver, pin map, or RF-band assumption is needed for the portable device authority. Display bring-up follows the first USB-only firmware milestone.
