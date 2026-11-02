# T-Beam V1.2 adapter

Owner requested support for the connected US/915 MHz LILYGO T-Beam V1.2 and confirmed its antenna is attached. Both boards can stay connected to one computer. The existing Heltec target/settings remain separate.

Observed ROM inventory: ESP32-D0WDQ6-V3 revision 3.1, 40 MHz crystal, Winbond 4MB flash, MAC 08:b6:1f:9f:e5:48. Use /dev/cu.wchusbserial57700003341; /dev/cu.usbserial-57700003341 is an alias for the same USB device, not a third board. Heltec remains /dev/cu.usbserial-0001. Recheck device/port identities after reconnects.

Build: `bash tools/build-firmware.sh tbeam-v12`. Validate: `python3 tools/update-firmware.py --manifest build/tbeam-v12/reaper-manifest.json`. Install with the same manifest plus `--flash --port /dev/cu.wchusbserial57700003341`. The target is ESP32/4MB, DIO/40 MHz, bootloader 0x1000, partition table 0x8000, app 0x10000; do not use the Heltec ESP32-S3 image. NVS is not erased. ESP32 security preflight uses a read-only named-eFuse summary because this ROM does not implement get_security_info. All security fields must be readable/zero. No security fuses are changed.

Board pins: UART0 TX1/RX3; SPI SCK5/MISO19/MOSI27/CS18/reset23; SX1276 IRQ polling (DIO0 26, DIO1 33); I2C SDA21/SCL22. AXP2101 at 0x34 must identify as 0x4a before enabling its radio ALDO2 at 3.3 V. Only that rail's voltage/enable bits change; CPU/charging settings are preserved. Power readback must succeed before the radio bus can begin. Optional SSD1306 at 0x3c uses the same bus and fails closed independently. GPS/Wi-Fi/BLE are not initialized.

Initial radio implementation is first-party SX1276, gated on register-version 0x12 plus configuration readback. A different radio must fail the probe; do not infer SX1276 from the processor alone. It uses the existing Reaper US915_LAB1 modem (915MHz, BW500kHz, SF7, CR4/5, preamble8, explicit header, CRC, sync0x52), bounded SPI DMA, shared airtime budget and software TX deadline. T-Beam's PA_BOOST path supports 2–10 dBm in this prototype. A lower requested TX power fails closed; no silent power increase or disconnected RFO selection. Receive/probe with power0 emits no TX. Default persisted mode is off.

The device ID is node-000008b61f9fe548, a canonical 64-bit radio address already understood by Heltec prototype-6. USB schema, config records, mesh/message IDs and acknowledgment semantics are shared. No GPS, alternative mesh protocol or extra features are introduced. The present web console can connect either board; simultaneous automated two-port tests can use separate SerialAdapters. Multi-tab writer ownership remains intentionally restricted until per-device journaling is implemented.

Acceptance: host register-driver RX/TX/fault tests, updater wrong-target/ESP32 security tests, both target builds, actual T-Beam USB handshake/reconnect/config persistence, SX1276 probe, receive-only startup, and local 1024-byte inbox delivery. Real Heltec/T-Beam delivery requires a separate explicitly recorded two-board test; building a driver alone proves none of it.

References reviewed (no third-party example code copied): [LILYGO T-Beam wiring/power](https://github.com/Xinyuan-LilyGO/LilyGo-LoRa-Series/blob/1991b1ed70915d4f246b841f99f6027166ea7330/docs/en/t_beam/t_beam_hw.md), [manufacturer pin definitions](https://github.com/Xinyuan-LilyGO/LilyGo-LoRa-Series/blob/1991b1ed70915d4f246b841f99f6027166ea7330/examples/LoRa/Receive_Interrupt/utilities.h), [AXP2101 register reference](https://github.com/lewisxhe/XPowersLib/blob/master/src/REG/AXP2101Constants.h), and [Semtech SX1276 register definitions](https://github.com/Lora-net/LoRaMac-node/blob/master/src/radio/sx1276/sx1276Regs-LoRa.h). Semtech's reference 500kHz high-band sensitivity settings are applied. Existing third-party notices stay intact; project licensing is still deferred.

## Installed hardware results

tbeam-usb-prototype-1 from commit 594bb10 installed with three verified image hashes, application237904 bytes. Probe (including AXP2101 readback) passed. Three TS adapter opens delivered local 1024-byte bodies/inbox with zero TX; ready671/669/670 ms, persisted revision3, free heap201748 bytes, minimum free main stack17484 bytes. Initial configuration's auxiliary reads timed out; reconnect recovered committed revision1 with no replay, followed by successful full checks. Arbitrary power/cable interruptions and soak remain qualification work.

Physical RF: seven full-message fragments reached TX_DONE; an unreachable unicast retried and failed with no fabricated ACK (TX10 total). Off policy restored at revision5; repeated opens675/671/671 ms. A subsequent real two-port test sent 1024 bytes Heltec -> T-Beam and T-Beam -> Heltec. Each reached destination-acknowledged, and its complete exact text appeared once in the receiver inbox with matching numeric source identity. The test restored original radio policies. It does not qualify relay, range, interference or public release.

Reproduce direct delivery with both antennas attached, both boards in the US and browser serial ports disconnected:

```sh
node tools/hardware-pair-smoke.ts .tools/espressif/python_env/idf5.5_py3.12_env/bin/python /dev/cu.usbserial-0001 /dev/cu.wchusbserial57700003341
```

It temporarily selects mesh/2 dBm as needed, validates actual destination ACK/body/source, and restores original settings. The report is build/tbeam-v12/pair-smoke.json. Third-node relay qualification is still outstanding.

Final read-only verification confirmed Heltec firmware6/revision21 stayed mesh/2dBm and T-Beam firmware1/revision7 was restored off/2dBm. Both were open simultaneously for the check. T-Beam package SHA256: 3a79222f814d1aebf8c5b4551f5f45d116b844e20c15ab7b299aef5f3ea57242. No old firmware backup, NVS erase, eFuse change, or Heltec reflash was performed.
