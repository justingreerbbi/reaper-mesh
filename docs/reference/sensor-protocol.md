# Sensor protocol: the signals add-on's link

This is the contract between the signals add-on, a XIAO ESP32-C5 that listens to Wi-Fi, Bluetooth
and drone Remote ID ([D60](../contributing/decisions.md#d60-signals-add-on-with-the-xiao-esp32-c5)),
and an app. The add-on reports what it hears and the app chooses what it listens to. Why it is
built this way is in the [signals add-on design](../contributing/signals-design.md).

Version 1 is built in the agent's TypeScript (`packages/protocol/sensor-messages.ts`), the
portable C++ codec (`firmware/components/reaper_protocol/sensor_protocol.cpp`) and a simulated
add-on (`packages/simulator/sensor-device.ts`). No add-on firmware exists yet, so nothing here has
run on hardware. Frozen fixtures in `packages/protocol/fixtures/sensor-*-v1.json` pin the exact
bytes.

## Envelope

The same envelope as the [node protocol](protocol.md#usb-envelope-draft-v1), with two differences:

| | Node protocol | Sensor protocol |
| --- | --- | --- |
| Magic bytes | `52 4d` (`RM`) | `52 53` (`RS`) |
| Largest payload | 2,048 bytes | 512 bytes |
| Largest encoded frame, without the delimiter | 2,067 bytes | 525 bytes |

Everything else is shared: envelope version `01`, zero flags, a little-endian length, CRC-32/ISO-HDLC
and COBS with a zero delimiter. A decoder for one protocol drops the other's frames as invalid, so an
app that opens the wrong port fails cleanly instead of misreading data. The receive buffer holds one
525-byte frame, and longer input is discarded up to the next delimiter.

## Payload

The same TLV encoding as the node protocol, generated from `packages/protocol/sensor-schema.json` by
`npm run generate:protocol`: a payload version byte (`01`), a message type, then fields as a 1-based
tag, a two-byte little-endian length and the data. Unknown optional tags are skipped; duplicate
tags, tag zero, overruns, missing required fields and unknown message types are rejected. Field
order and meanings are append-only.

The sensor schema uses two field kinds the node schema does not:

| Kind | On the wire | In the agent |
| --- | --- | --- |
| `i32` | Four bytes, signed, little endian | A whole number from −2,147,483,648 to 2,147,483,647 |
| `bytes` | 0 to 64 raw bytes | Lowercase hex, so an empty value is the empty string |

It also uses `u32`, `id` (1–64 letters, digits, `_` or `-`) and `version` (an `id` that may also
contain `.`), as the node protocol defines them.

## Messages

`boot` is the add-on's boot ID, which changes on every restart. `at` is milliseconds since the
add-on started; it has no clock, and the app adds wall-clock time when a report arrives. `request`
is chosen by the app and echoed back.

| Tag | Message | Direction | Fields in tag order (`?` optional) |
| --- | --- | --- | --- |
| 1 | `hello` | app → add-on | link, minVersion, maxVersion |
| 2 | `welcome` | add-on → app | link, sensor, boot, minVersion, maxVersion, firmware, capabilities, maxFrame |
| 3 | `planSet` | app → add-on | boot, request, profile, bands, dwell, bluetooth, probes, channels? |
| 4 | `planStatus` | add-on → app | boot, request, state, profile, bands, dwell, bluetooth, probes, channels? |
| 5 | `status` | add-on → app | boot, at, profile, band, channel, wifiFrames, bleReports, remoteIdReports, sent, dropped, evicted |
| 6 | `wifiAp` | add-on → app | boot, at, address, ssid, hidden, channel, band, security, rssi, rssiMin, rssiMax, count |
| 7 | `wifiProbe` | add-on → app | boot, at, address, channel, band, rssi, count, ssid? |
| 8 | `bleDevice` | add-on → app | boot, at, address, addressType, phy, rssi, rssiMin, rssiMax, count, name?, manufacturer?, services?, tracker? |
| 9 | `remoteId` | add-on → app | boot, at, transport, uasId, idType, uaType, rssi, address?, latitude?, longitude?, altitude?, height?, speed?, heading?, operatorLatitude?, operatorLongitude?, operatorId? |

### Identity and plan

- **`welcome`**: `sensor` is the add-on's stable ID and `firmware` its build. `maxFrame` is the
  largest payload it sends, at most 512. `capabilities` bits: 0 Wi-Fi 2.4 GHz, 1 Wi-Fi 5 GHz,
  2 Bluetooth, 3 Bluetooth long range (Coded PHY), 4 Remote ID, 5 probe capture.
- **`planSet`** replaces the whole scan plan; nothing in it is incremental.
  - `profile`: 0 balanced, 1 drones, 2 Wi-Fi, 3 Bluetooth. It weights the scheduler; drones also
    limits reports to `remoteId`, Wi-Fi turns Bluetooth off and Bluetooth turns Wi-Fi off.
  - `bands`: bit 0 is 2.4 GHz and bit 1 is 5 GHz; at least one is set.
  - `dwell`: milliseconds on each Wi-Fi channel, 20 to 10,000.
  - `bluetooth` and `probes`: 0 or 1. `probes` turns on probe-request capture, which is off by
    default.
  - `channels`: optional; one byte per channel number (for example `01060b` is 1, 6 and 11). Absent
    means every channel of the chosen bands. It is never empty.
- **`planStatus`**: `state` is `applied`, `invalid` (a field out of range, or a `boot` that is not
  the current one) or `unsupported` (an unknown profile, or a band or probe capture the add-on
  lacks). The plan fields are always the plan in force afterwards, so an app learns it either way.

### Reports

All three Wi-Fi and Bluetooth reports summarize one transmitter, keyed by `address` (6 bytes), and
are sent when it is first heard and then as it changes. `count` is how often it has been heard
since the add-on started. `rssi` is the latest signal strength in dBm, and `rssiMin` and `rssiMax`
the range seen, all from −128 to 127. `band` is 1 for 2.4 GHz and 2 for 5 GHz.

- **`wifiAp`**: an access point's beacon or probe response. `ssid` is the raw network name, up to
  32 bytes and not necessarily UTF-8; it is empty with `hidden` set to 1 for a hidden network.
  `security` bits: 0 WEP, 1 WPA, 2 WPA2, 3 WPA3, 4 enterprise (802.1X), 5 OWE; zero means open.
- **`wifiProbe`**: a device searching for networks, only while probe capture is on. `ssid` is the
  network asked for, absent for a search for any network. Phones usually randomize this address.
- **`bleDevice`**: a Bluetooth LE advertiser. `addressType`: 0 public, 1 random static,
  2 resolvable private, 3 non-resolvable private. `phy`: 1 LE 1M, 2 LE 2M, 3 Coded (long range).
  `name` is the advertised name as raw bytes. `manufacturer` is the Bluetooth SIG company ID
  (16 bits). `services` is a list of 16-bit service UUIDs, two little-endian bytes each.
  `tracker`: 1 Apple Find My, 2 Tile, 3 Samsung SmartTag, 4 Google Find Hub.
- **`remoteId`**: one drone's latest ASTM F3411 Remote ID state.
  - `transport`: 1 Bluetooth legacy, 2 Bluetooth long range, 3 Wi-Fi beacon, 4 Wi-Fi NAN.
  - `uasId`: 1 to 20 bytes, with F3411's `idType` (0–15, for example 1 is a serial number) and
    `uaType` (0–15, for example 2 is a helicopter or multirotor).
  - `latitude`, `longitude`, `operatorLatitude` and `operatorLongitude` are degrees × 10⁷, and come
    in pairs.
  - `altitude` (above the WGS-84 ellipsoid) and `height` (above takeoff or ground) are decimeters.
  - `speed` is centimeters a second over the ground. `heading` is the course in hundredths of a
    degree from true north, below 36,000.
  - `operatorId` is up to 20 bytes. `address` is the transmitter's 6-byte address, when known.

### Status

`status` arrives every few seconds: the profile in force, the band and channel being listened to,
counts of Wi-Fi frames, Bluetooth reports and Remote ID reports heard, and reports `sent`, `dropped`
(the output queue was full) and `evicted` (a full table forgot a transmitter).

## Checks the codec does not make

The codec checks kinds, not meanings. An agent calls `checkSensorMessage` on every message before
using it and counts a failure instead of showing it. It checks the ranges and lengths above: 6-byte
addresses, SSIDs of at most 32 bytes, RSSI and coordinate ranges, paired positions, the heading,
the manufacturer ID, the service list and the plan limits.

Code tables stay open, so a newer add-on keeps working with an older app: a band, PHY, address
type, tracker, transport, profile or capability the app does not know is shown as unknown, not
rejected. A `planStatus` state other than `applied` means the plan was not applied.

## Sessions

**Direct USB.** The add-on sends nothing until a `hello`. It answers with `welcome`, then streams
reports and `status` to that link. The newest `hello` takes over. A restart changes `boot`, ends
the session and resets the plan to the default, so the app says `hello` again and resends its plan.
A `planSet` before any `hello` is ignored.

**Through a node.** There is no sensor `hello`; the node's accessory port establishes presence and
carries these frames unread. That part is not built yet; see the
[design](../contributing/signals-design.md#accessory-port-on-the-node).

**Retries.** `planSet` is a whole replacement, so an app may send it again after a lost
`planStatus`. Reports are never resent: a lost report is replaced by the next one for that
transmitter.

## Default plan

Profile balanced, both bands, 150 ms dwell, Bluetooth on, probe capture off, every channel.

## Tests

`tests/simulator/sensor-messages.test.ts` covers the fixtures, the `RS` envelope against an
independently computed checksum, rejection of node frames, the 512-byte limit, the new kinds'
boundaries, unknown and reordered fields and the semantic checks.
`tests/simulator/sensor-embedded.test.ts` builds the C++ codec with sanitizers and checks that it
produces the same bytes and accepts and rejects the same input as the agent, including truncation,
every single-bit corruption of a frame, oversized streams and seeded malformed traffic.
`tests/simulator/sensor-device.test.ts` covers the simulated add-on's session, plans, reports,
bounded output and restart. These prove the codecs agree, not that any radio reports correctly.
