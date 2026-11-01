# Initial hardware inventory

Read-only inspection on November 1, 2026 found:

- Serial port: `/dev/cu.usbserial-0001`.
- USB product: CP2102 USB to UART Bridge Controller, Silicon Labs.
- USB vendor/product IDs: `0x10c4` / `0xea60`.
- Owner identifies the connected board as a US-model Heltec V3.

The USB bridge identification is consistent with a USB UART path but does not prove the board model, revision, RF band, antenna, or flash size. Treat US band as owner-reported, not electronically verified. Check the board label/order details before radio firmware development and transmission. No serial connection was opened, no reset was requested, and nothing was flashed.

Local tools observed: Node 25.9.0, npm 11.12.1, Python 3.12.4. `idf.py` was not on PATH. Host tests use built-in Node TypeScript stripping and test runner, without installed dependencies. Node 24 is the proposed development baseline; Node 25 is the current locally tested runtime. ESP-IDF installation and version selection remain pending.
