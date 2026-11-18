# Board name

One short paragraph: what the board is, who it suits, and which band version to buy.

**Status:** experimental. What has been tested on it is in [Status](../overview/status.md).

| | |
| --- | --- |
| Firmware target | `target-id`, image `prefix-reaper-mesh-v…` |
| Processor | Chip, flash size |
| Radio | Radio chip |
| Screen | Size and resolution, or None |
| Battery | What is measured and shown |
| USB | Serial bridge or native USB |
| Install | How the [browser installer](../guides/flashing-firmware.md) reaches it |

## Using it

- **Buttons:** which one is the main button, and any extra buttons.
- **Transmit power:** low, medium and high in dBm at the radio chip, and boost if it has one.
- **Not used:** hardware the firmware leaves off.

## Developer details

| Property | Value |
| --- | --- |
| USB serial | |
| Radio | Bus, pins, TCXO, RF switch |
| Power | Rails the firmware switches |
| Flash layout | Every region the firmware or installer writes |
| Radio gate | The profile file, and when the owner confirmed the unit's band and antenna |

Sources: manufacturer pages and datasheets. Note any reference code read, and that none was copied.
