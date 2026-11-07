# Radio and channel configuration v1

Base configuration schema 1 remains compatible. Welcome feature bit 4, radioSchema 1 and maxChannels 8 advertise this optional extension. Configure/snapshot/event append radioMode, txLevel, relay, channels and preset in that order, then `channelIds` ([channel IDs](#channel-ids)) and `txBoost` ([transmit power](#transmit-power)). A configure request supplies all of them or none. Missing radio fields preserve existing radio/channel values; changing the operating region away from US forces requested mode off. Older agents can keep editing label/region without resetting newer settings.

Modes are off, receive and mesh. Transmit power is a level, described [below](#transmit-power). Relay is a boolean. Preset is US915_LAB1; EU transmit profiles are not implemented. Persisting mode mesh does not itself prove the hardware is enabled; the board adapter must separately enforce region, board/antenna and driver readiness.

Eight logical channel slots share one physical radio preset. Slot 0 is always Public. Slots 1–7 are named/enabled or empty/disabled; names use up to eight ASCII letters, digits, underscores or hyphens. The canonical compact representation is exactly eight pipe-separated names beginning Public (e.g. `Public|Camp|Team|||||`). Names are local labels; each channel's on-air identity is its channel ID (below), not its slot. Public/named describes UI organization, not confidentiality. Messages are plaintext unless a channel uses agent-side [encryption](../guides/security.md#channel-encryption).

## Transmit power

Since firmware `v0.4.0` (D46), power is low, medium or high instead of a dBm number. Low is the radio's minimum, high its maximum and medium halfway between them in dBm, rounded up. The default is medium with boost off.

| Board | Low | Medium | High | Boost |
| --- | --- | --- | --- | --- |
| Heltec V3 (SX1262) | −9 dBm | +7 dBm | +22 dBm | Not available |
| T-Beam V1.2 (SX1276, PA_BOOST) | +2 dBm | +10 dBm | +17 dBm | About 3 dB more at each level: +5, +13 and +20 dBm |

Values are nominal settings at the radio output, before antenna gain; they have not been measured on these units. Medium is halfway in dBm, not half the milliwatts.

Boost is the SX1276's high-power mode. It raises the PA DAC (RegPaDac 0x87 instead of 0x84) and the current limit (140 mA instead of 100 mA), and leaves the output setting alone. The datasheet limits this mode to a 1% duty cycle, which the shared [airtime budget](#regional-bring-up-target) also holds to, and adds supply and antenna-mismatch conditions. It stays off until someone turns it on. The SX1262 has no equivalent, so the Heltec reports no boost and refuses it.

Over USB, `txLevel` is 0 (low), 1 (medium) or 2 (high). It takes the place of `txPower` at the same tag. `txBoost` is 0 or 1 and is required with the other radio fields. Welcome feature bit 11 (2048) means the board uses levels, and bit 12 (4096) means it has boost. The device refuses a level above 2, and boost without bit 12. Agents do not change radio settings on firmware without bit 11, because its `txLevel` field still holds dBm. The device screen's debug page shows the resulting dBm.

## Channel IDs

Since firmware `v0.3.0` (D45), each channel has a 32-bit ID that travels in the radio header, so a node can hold a channel in any free slot and still share it. Public is always ID 0 in slot 0. A named slot has a unique ID other than 0 and `ffffffff`; an empty slot has 0. IDs 1–255 are reserved: 1–7 are the channels converted from settings stored before IDs existed (slot *k* became ID *k*, so upgraded boards keep their channels), and new channels get random IDs of 256 or more. Two groups that create channels with the same name still get different IDs.

Over USB, `channelIds` (welcome `channelIdVersion` 1 with feature bit 10, value 1024) is eight 8-digit lowercase hex IDs joined by `|`, in slot order, for example `00000000|00000001|9c41e2a7|00000000|00000000|00000000|00000000|00000000`. It is required with the other radio fields. The device rejects a table that breaks the rules above, and only admits messages, relays and receives packets on channels in its table. Agents read firmware without channel IDs as slot *k* = ID *k* and do not change its channels or radio settings.

The web agent shares a channel with an `RMCH1` invite: the prefix `RMCH1.` and base64url JSON with `format` `"RMCH1"`, `id` (8 hex digits), `name`, and for an encrypted channel `key` (an `RMKEY1` bundle). Unknown fields are ignored so later versions can add some. Joining puts the channel in a free slot with the same ID. Removing a channel is an ordinary radio change that empties its slot; Public cannot be removed.

Radio/channel policy changes share the device's atomic revision/receipt rules. After commit and before any subsequent radio work, active message records are failed with radio-config-changed; channel admission is updated. An old-policy send must never leak into the new policy. Label-only edits do not cancel queued work. Accepted message status survives temporary config resync; polling pauses until the new authoritative snapshot is ready, while incomplete uploads become uncertain.

## Persistent record migration

Record 7 (`v0.4.0`) stores the level and boost in the existing power byte; see [persistence](persistence.md#transmit-power-levels-record-7). Record 6 (`v0.3.0`) keeps the record 5 layout and adds the eight slot channel IDs (32 bytes, little-endian) before the CRC; see [persistence](persistence.md#channel-ids-record-6).

The backend still stores one atomic NVS blob. Default radio settings keep the original RC/version-1 record format unchanged. Nondefault settings write RC/version-2: preserve the original prefix through label, then append mode (u8), power (u8), relay (u8), channel-string length (u8), channel bytes, profile ID (u8), then the same CRC32. Maximum size is 151 bytes. Version 1 loads with radio off/default channels. Version 2 validates every added field, complete length, region and CRC. No migration erases storage or resets revision. Downgrading to firmware that only reads record 1 may fail closed on record 2; ROM reinstall does not imply backward config migration.

## Regional bring-up target

US915_LAB1 targets 915 MHz center, nominal 500 kHz bandwidth, SF7, CR4/5, eight preamble symbols, explicit header and CRC, and output up to the board's maximum in the [power table](#transmit-power), at most +22 dBm. LoRa sync word is 0x52; Reaper packet magic/version further identify the protocol. A project token bucket charges every original, retry, forwarded and ACK packet, replenishes at 1%, and permits a one-second burst. This courtesy bound is not a regulatory compliance determination, and neither are the power levels. The pinned Semtech driver independently agrees with the airtime calculator after rounding to milliseconds.

Primary sources checked November 1, 2026: [47 CFR 15.247](https://www.ecfr.gov/current/title-47/chapter-I/subchapter-A/part-15/subpart-C/section-15.247) sets bandwidth/power/PSD and other requirements for applicable digital modulation systems; nominal modem settings do not establish measured compliance. [Semtech SX1262](https://www.semtech.com/products/wireless-rf/lora-connect/sx1262) supplies the hardware/driver reference. Actual band/antenna and board emission qualification remain separate; do not claim certification or apply US settings in the EU. The home-built-device provisions in [15.23](https://www.ecfr.gov/current/title-47/chapter-I/subchapter-A/part-15/subpart-A/section-15.23) have conditions and are not a general exemption for distributing modified development boards.
