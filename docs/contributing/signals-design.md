# Signals add-on design

Status: **Confirmed** by the owner on November 23, 2026
([D60](decisions.md#d60-signals-add-on-with-the-xiao-esp32-c5)). Phase 1 is built: the
[sensor protocol](../reference/sensor-protocol.md), its codecs and a simulated add-on. Phase 2 is
built and runs on the owner's C5 over USB, with the portal's Signals view checked against the
simulated add-on; see [Phase 2](#phase-2-add-on-firmware-and-the-portal-over-direct-usb). The [Phase 0](#phase-0-bench-spike) bench spike has run on one XIAO ESP32-C5;
its results are below, and its open checks are marked there. Other hardware facts come from vendor
documents. Where this page proposes a number (a rate, a size, a timeout), it is a starting point
to measure, not a result.

## What it is

The signals add-on is a small second board, the Seeed Studio XIAO ESP32-C5, that listens to nearby
Wi-Fi, Bluetooth and drone Remote ID broadcasts and reports what it hears to the Reaper Mesh apps.
It works two ways:

- **On its own.** Plug the add-on into a computer's USB port and the portal shows what it hears.
- **Attached to a node.** Wire it to a Heltec WiFi LoRa 32 V3. The node notices it is there and
  passes its reports to the app over the node's existing USB or Bluetooth link, so one connection
  carries both.

A node without the add-on works exactly as it does today.

```
add-on ──USB───────────────────────────────▶ portal or app   (on its own)
add-on ──UART──▶ Heltec V3 ──USB or BLE────▶ portal or app   (attached)
```

## Why it is built this way

- **A second chip, not the node's own radio.** The Heltec's ESP32-S3 has Wi-Fi, but only on
  2.4 GHz, its 2.4 GHz radio already carries the phone link, and Wi-Fi in node firmware is out of
  scope without a decision. The ESP32-C5 adds 5 GHz and keeps scanning away from the node's timing.
- **One sensor protocol, carried unread.** The add-on speaks its own
  [sensor protocol](#sensor-protocol). When attached, the node forwards those frames byte for byte
  and never reads them, so the app uses the same decoder either way. New signal types change the
  add-on firmware and the apps, never the node (D41).
- **The node change is a generic accessory port.** The node gains a content-agnostic
  [accessory port](#accessory-port-on-the-node): detect a board on a spare UART, buffer its frames,
  and hand them to the app on request. This needs firmware because no agent or plugin can read a
  UART on the board, the same reasoning as Bluetooth in D47. Being generic, a later accessory can
  reuse it without another node change.

## What it can and cannot see

| Signal | What the add-on reports | Limits |
| --- | --- | --- |
| Wi-Fi access points, 2.4 and 5 GHz | Address, network name, channel, security type, signal strength, first and last seen | It hops channels, so it samples rather than watching every channel at once. 5 GHz needs a dual-band antenna |
| Wi-Fi devices looking for networks (probe requests) | Address and any network names asked for | Off by default ([privacy](#rules)). Most phones randomize addresses, so one device can look like many |
| Bluetooth LE devices | Address and type, name, manufacturer, advertised services, known tracker types, signal strength | Shares the radio with Wi-Fi by taking turns, so each sees less while both are on |
| Drones broadcasting Remote ID | Drone ID, type, position, altitude, speed, heading, operator position and ID | Only drones that broadcast Remote ID. DJI's own control and video links are not Wi-Fi, and need a software-defined radio |

The add-on only listens. It never transmits Wi-Fi frames, never joins networks and never connects
to Bluetooth devices.

## Rules

- **Broadcast metadata only.** The add-on parses Wi-Fi management frames (beacons, probe requests
  and responses, NAN action frames) and Bluetooth advertisements. It never captures or forwards the
  contents of Wi-Fi data frames: in the US, capturing unencrypted Wi-Fi payloads can violate the
  Wiretap Act (*Joffe v. Google*, 9th Cir. 2013).
- **Never transmit to disrupt.** No deauthentication frames, jamming or spoofing, in firmware or
  in tools. The FCC treats willful Wi-Fi interference as illegal (Communications Act §333).
- **Privacy defaults off.** Capturing probe requests and client addresses is off until the user
  turns it on. Nothing the add-on hears goes over the mesh unless a person shares it.
- **No invented data.** The add-on has no clock: it reports milliseconds since it started, and the
  app adds wall-clock time on arrival. Positions come only from Remote ID messages, never guessed.

These are engineering rules, not legal advice; check local law before field use.

## Hardware

### Parts

| Part | Notes |
| --- | --- |
| Seeed Studio XIAO ESP32-C5 | ESP32-C5 with 8 MB flash and 8 MB PSRAM; dual-band Wi-Fi 6, Bluetooth LE 5 and 802.15.4; native USB Serial/JTAG; U.FL antenna connector only. Launched January 2026, about USD 6.90 |
| Dual-band U.FL antenna (2.4 and 5 GHz) | The antenna in the box is 2.4 GHz only |
| Heltec WiFi LoRa 32 V3 | Only for the attached mode. Other boards are later work |

### Wiring for the attached mode

| Add-on pin | Heltec V3 pin | Notes |
| --- | --- | --- |
| D6 / GPIO11 (UART1 TX) | J2 pin 14 / GPIO48 (UART1 RX) | 1 kΩ series resistor, so neither board powers the other through a data line |
| D7 / GPIO12 (UART1 RX) | J2 pin 13 / GPIO47 (UART1 TX) | 1 kΩ series resistor |
| GND | J2 pin 1 | |
| 5V (VBUS) | J2 pin 2 (5V) | See power below |

Heltec documents GPIO47 and GPIO48 as connected to nothing on the board, and the firmware does not
use them (it uses GPIO 0, 1, 8–14, 17, 18, 21, 35–37, 43 and 44). Avoid GPIO45 and GPIO46, which
are strapping pins.

**Pin conflict found in Phase 0.** The add-on firmware must keep UART0 as its primary console (see
[Phase 0](#phase-0-bench-spike)), and ESP-IDF puts that console on GPIO11 and GPIO12, the D6 and D7
pins above. Phase 2 either moves the console to other pins or moves the link to another pair of
XIAO pins (both UARTs can use most pins); the table changes with that choice.

### Power

- Scanning should draw roughly 80–115 mA at 3.3 V (the ESP32-C5 datasheet gives 87 mA for 2.4 GHz
  receive, 110 mA for 5 GHz and 79 mA for Bluetooth receive). This is an estimate to measure.
- The XIAO's 5V pin accepts power, and its 3V3 pin is documented as an output only, so the add-on is
  powered from the Heltec's 5V pin.
- **Not yet known:** whether the Heltec's 5V pin is live on battery. Third-party notes say it may be
  live only on USB power, and its current limit for this board revision is not documented. If it is
  dead on battery, the attached mode needs a LiPo on the XIAO's own charger pads or a small boost
  converter. Phase 0 decides this.
- Never connect the add-on's USB while it is wired to the Heltec's 5V pin: the two 5 V supplies
  would fight. The attached mode uses only the UART.

## Sensor protocol

The sensor protocol is a separately versioned protocol between the add-on and an app. Its exact
contract is the [sensor protocol reference](../reference/sensor-protocol.md); in short:

- **Framing:** the node protocol's COBS envelope and CRC-32 with magic bytes `52 53` (`RS`), so a
  node decoder drops sensor frames and a sensor decoder drops node frames. Payloads are at most
  512 bytes.
- **Payload:** the same TLV encoding, from `packages/protocol/sensor-schema.json`, generated into
  TypeScript and C++ by the same generator, with frozen fixtures. The C++ codec shares the node
  codec's code (`firmware/components/reaper_protocol/`), and node firmware does not link the sensor
  half.
- **New field kinds:** `i32` (signal strength and coordinates are signed) and `bytes` (up to
  64 raw bytes; `hex` doubles the size). Node messages do not use them.
- **Messages:** `hello` and `welcome`; `planSet` and `planStatus` for the scan plan; `status`; and
  one report per frame: `wifiAp`, `wifiProbe`, `bleDevice` and `remoteId`. Reports summarize one
  transmitter each and are sent when it is first heard and as it changes.
- **Open code tables:** an app shows a code it does not know as unknown rather than rejecting the
  report, so a newer add-on keeps working with an older app.

### Sessions

- **Direct USB.** The app sends `hello`; after `welcome`, the add-on streams reports and `status`
  to that link until it closes. Web Serial on a native USB port is fast enough not to need flow
  control. The newest `hello` takes over, as on a node.
- **Through a node.** There is no sensor `hello`. The node's [link messages](#link-messages)
  establish presence, the add-on streams to the node, and the app sends `planSet` through
  `accessorySend`. The add-on's identity comes from the node's `accessoryStatus`.

## Sensor firmware

A new ESP-IDF project, `firmware/xiao-esp32c5-sensor/`, on the pinned ESP-IDF (ESP32-C5 support
began in v5.5; Phase 0 confirms the pinned v5.5.4 builds it). It links the sensor codec
(`sensor_protocol.cpp`). Portable parsing and table logic go in a new
`firmware/components/reaper_sensor/` with host tests, as the mesh core does.

- **Scheduler.** One radio, shared by taking turns. The plan sets bands, channels, dwell time per
  channel and whether Bluetooth windows are interleaved. Phase 0 measured why this matters: with
  Bluetooth scanning all the time, Wi-Fi listening on the same radio heard nothing (0 frames in
  5 seconds against 133 alone), while Bluetooth lost nothing. So the scheduler gives each its own
  windows and never runs a full-duty Bluetooth scan alongside Wi-Fi.
- **Profiles.** `drones` weights the Remote ID channels and Bluetooth legacy and long-range
  scanning; `wifi` surveys both bands; `bluetooth` scans Bluetooth only; `balanced` mixes them.
  `balanced` is the default.
- **Parsers.** Wi-Fi management frames (beacon, probe request and response, NAN action frames for
  Remote ID), Bluetooth advertisements (legacy and extended, including long range), and ASTM F3411
  Remote ID messages (Basic ID, Location, System, Operator ID, and message packs). Data frames are
  discarded unread.
- **Tables.** Bounded tables in PSRAM, one per signal type, keyed by address or drone ID. A full
  table evicts the entry heard least recently and counts it. Sizes are set in Phase 0 from measured
  memory.
- **Output budget.** Drones are sent at once. Other new entries are sent within a second, and
  changed entries are coalesced to their latest state every few seconds. On the UART the add-on
  keeps to a byte budget (proposed 1.5 KB/s) so a node's Bluetooth link can keep up, sending drones
  first, then new entries, then updates.
- **Links.** USB Serial/JTAG and UART1 at the same time. UART1 runs at 460,800 baud (proposed;
  checked on the bench for errors over short wires).
- **Own traffic.** The node's own Bluetooth advertisements are reported like any other device; the
  app can hide them.

A Remote ID decoder may be written from the standard or vendored from `opendroneid-core-c`
(Apache-2.0), with its notices, an `upstream.json` and an entry in `tools/check-vendor.ts`.
ArduRemoteID is GPL-2.0 and is not a source of code; it may be used as a separate test transmitter.

## Accessory port on the node

The node's part is small and does not read sensor data. It lives in shared ESP32 code
(`firmware/app/accessory_port.*`), with the ring buffer and detection state machine in
`firmware/components/reaper_device/` so host tests cover them. A board enables it by naming its UART
and pins in its board profile; only the Heltec V3 does at first.

### Detection

| State | Meaning | Leaves when |
| --- | --- | --- |
| `absent` | Nothing heard. The node sends `accessoryProbe` every 2 seconds | A valid `accessoryAnnounce` arrives |
| `present` | The accessory announced a supported link version | No announce for 6 seconds, or a different session ID |
| `incompatible` | The accessory announced an unsupported link version. Its frames are dropped | A supported announce arrives, or 6 seconds of silence |

- The RX pin has a pull-up, so an empty port reads idle. Noise fails COBS or CRC and is dropped and
  counted.
- The accessory sends `accessoryAnnounce` as a heartbeat every 2 seconds while it hears probes. A
  restarted accessory announces a new session ID, which tells the app to start again.
- Hot-plugging works both ways. Nothing is stored, so there is no setting and no storage change.

### Link messages

These travel only on the node's UART, in the node protocol's `RM` envelope, and are part of the node
schema because the node implements them.

| Message | Direction | Fields (proposed) |
| --- | --- | --- |
| `accessoryProbe` | node → accessory | node, boot |
| `accessoryAnnounce` | accessory → node | kind, session, firmware, linkVersion, protocolVersion, maxFrame |
| `accessoryFrame` | either way | session, frame (`bytes`): one complete inner frame, exactly as it would appear on the accessory's own USB port |

### USB and Bluetooth messages

A new welcome feature bit says the node has an accessory port. The app reads by query, like the
inbox, so a lost reply is settled by asking again. These messages need an admitted session, and only
the owning link gets replies.

| Message | Fields (proposed) | Answer |
| --- | --- | --- |
| `accessoryQuery` | link, boot, request, after | `accessoryStatus` with the frames after sequence `after` |
| `accessorySend` | link, boot, request, frame | `accessoryStatus` saying whether the frame was handed to the UART |
| `accessoryStatus` | link, boot, request, state, kind?, session?, firmware?, protocolVersion?, first, next, dropped, frames (`bytes`) | |

- `frames` is the inner frames concatenated with their zero delimiters: the same byte stream the
  app would read from the add-on's own USB port, so it goes into the same decoder.
- `first` and `next` are the sequence numbers of the first frame returned and the next one to ask
  for. `dropped` counts frames the ring no longer holds after `after`, so the app shows a gap
  instead of pretending it saw everything.
- A reply carries at most 1,536 bytes of frames (proposed), inside the 2,048-byte envelope.
- `accessorySend` is never resent automatically. A scan plan is a whole replacement, so the app may
  send it again on purpose after a lost reply.

### Bounds

- A ring of 16 KB of frames with sequence numbers (proposed); the oldest frames are dropped first and
  counted.
- Inner frames over the announced `maxFrame`, or over 512 bytes, are dropped and counted.
- At most 1 KB of UART input is handled per pass of the main loop, so the radio and screen keep
  their timing. Phase 3 checks this with a relay run with the add-on attached.
- The app polls at most every 500 ms over USB and every second over Bluetooth (proposed).

## Apps

- **Agent core.** A `sensor` module in `packages/agent-core/` with the sensor decoder, a bounded
  store per signal type, and two sources: a direct serial connection to the add-on, or the
  accessory messages through the node session. Recovery follows the node rules: a new add-on
  session or boot clears the store's live state.
- **Portal.** A Signals view with Wi-Fi, Bluetooth and Drones lists, filters, and drones and their
  operators on the map from Remote ID positions. A direct add-on connects next to the radio, the
  way a USB GPS receiver does (D59), and needs no per-device journaling because it has no messages
  or settings to recover.
- **Desktop app.** Uses its existing serial bridge.
- **Mobile app.** Built in its own repository (D48). The contract goes in
  [Build a mobile app](../guides/mobile-apps.md) so the app can read the add-on through a node over
  Bluetooth.

## Sharing over the mesh (later)

A person can share a drone sighting with their team as an application payload, the way map items
are shared, using the opaque payloads firmware already carries. This needs no firmware change. It
is manual and off by default: nothing is broadcast automatically, and it counts against the airtime
budget like any message.

## Delivery order and acceptance

[D37](decisions.md#d37-field-qualification-before-new-portal-features) pauses new portal features
until field qualification passes. The owner approved the Signals view and the accessory port as an
exception (D60), as D49 and D59 were. Phases 0 to 2 do not touch the node.

### Phase 0: bench spike

On a real XIAO ESP32-C5, with throwaway code:

- Listening works on 2.4 GHz and 5 GHz channels with a dual-band antenna.
- Bluetooth extended scanning receives long-range (Coded PHY) advertisements.
- Remote ID is received over Wi-Fi beacon, Wi-Fi NAN, Bluetooth legacy and Bluetooth long range,
  from a test transmitter or a real drone.
- Scanning current is measured on USB and from the Heltec's 5V pin, and whether that pin is live on
  battery is checked with a meter.
- The pinned ESP-IDF builds the C5, and whether opening its USB port resets it is recorded.

The spike is [`firmware/spikes/xiao-c5-phase0/`](../../firmware/spikes/xiao-c5-phase0/). It only
listens, keeps management frames only, scans Bluetooth passively and prints counts, never
addresses or names.

**Results on November 23, 2026**, on the owner's XIAO ESP32-C5 (chip revision 1.0, 8 MB flash) over
three cycles indoors, with an antenna whose bands were not recorded:

| Check | Result |
| --- | --- |
| Pinned ESP-IDF v5.5.4 | Builds and runs; free heap steady at about 152 KB |
| Console | A USB-only console hangs every boot: UART0's clock stays off and a ROM routine waits forever for UART0 to be ready (`PCR_UART0_CONF`). USB and JTAG CPU resets do not clear it; download mode with the BOOT button or JTAG recovers it. The fix is UART0 as the primary console with USB as a secondary output, which causes the [pin conflict](#wiring-for-the-attached-mode) |
| Wi-Fi 2.4 GHz | Works: 8 to 10 access points a sweep; channels 1 to 11 all tuned |
| Wi-Fi 5 GHz | Works: all 25 US channels tuned, including the radar (DFS) band; beacons on 48 and 157 and other frames on 149, 2 access points a sweep. The count depends on the antenna |
| Bluetooth LE 1M | Works: 8 devices, about 17 advertisements a second, all legacy |
| Wi-Fi and Bluetooth together | A full-duty Bluetooth scan stops Wi-Fi listening entirely (0 frames against 133); Bluetooth is unaffected. See the scheduler |
| Opening the USB port | Resets the C5 (reset reason USB) when opened from Python on macOS. A browser has not been tried |
| Bluetooth long range (Coded PHY) | Not shown: no long-range advertiser was nearby, so zero reports is inconclusive |
| Remote ID | Not shown: no drone or test transmitter |
| Current draw; the Heltec's 5V pin on battery | Not measured yet; needs a meter |

Next for Phase 0: a long-range Bluetooth transmitter, a Remote ID source, the meter readings, and a
partial-duty Bluetooth scan to measure how the radio splits between Wi-Fi and Bluetooth.

### Phase 1: sensor protocol (built)

`sensor-schema.json`, the `RS` magic, the `i32` and `bytes` kinds, generated bindings, frozen
fixtures, and host tests for framing, wrong-magic rejection, every message and bounds, across the
TypeScript and C++ codecs. A simulated add-on (`packages/simulator/sensor-device.ts`); the portal's
Simulator mode uses it once the Signals view exists in Phase 2.

### Phase 2: add-on firmware and the portal over direct USB

Parsers and tables with host tests from captured frames and Remote ID vectors. On hardware: the
portal lists real access points and Bluetooth devices, and shows a Remote ID test drone on the map,
over direct USB. Probe capture stays off until turned on.

**Built (November 23, 2026):**

- **Portable core:** `firmware/components/reaper_sensor/` holds the parsers, tables, byte budget,
  scheduler and session. Host tests build 802.11, Bluetooth and F3411 frames byte by byte, and a
  cross-language test decodes the core's reports in the agent and checks them.
- **Firmware:** `firmware/xiao-esp32c5-sensor/` connects the radios and USB to that core. The image
  is `xiaoc5-reaper-sensor-v0.1.0`.
- **Agent:** `packages/agent-core/sensor.ts` and `sensor-serial.ts`.
- **Portal:** the Signals tab, a "Connect signals add-on" button on the connect screen, drones on
  the map, and a simulated add-on.

**Verified on the owner's C5:**

- A 60-second session from a scripted host using the agent's codec: one boot and a status every
  2 seconds without a gap.
- Real access points (including hidden networks, WPA2 and WPA3) and Bluetooth devices (including
  tracker hits); every frame passed `checkSensorMessage`, and nothing was dropped.

Three bench findings changed the firmware:

- A loop delay of `pdMS_TO_TICKS(5)` is zero ticks at 100 Hz, which starved the idle task.
- `usb_serial_jtag_is_connected()` flaps, so it is no longer used.
- Watchdog text printed on the USB link joined the next frame, so frames now start with a
  delimiter too.

**Not verified yet:**

- The portal with the real add-on, which needs the owner to choose the port in the browser.
- Remote ID and long-range Bluetooth from a real transmitter.
- The desktop app.

### Phase 3: accessory port on the Heltec V3

Link and USB messages with fixtures appended, not changed. Host tests: detection with an empty,
noisy and hot-plugged port; ring overflow and the `dropped` gap; a lost `accessoryStatus` settled by
asking again; an add-on restart changing the session; an oversized frame. On hardware: auto-detect
within one probe interval, the same portal view through the node over USB and Bluetooth, unplugging
the add-on mid-stream, and a desk relay run with the add-on attached that matches the run without
it.

### Phase 4: install and publish

An accessory category in `agents/boards.json`, an ESP32-C5 entry in the installer (after checking
that the pinned `esptool-js` supports the C5), a CI build, a page under `docs/boards/` and the
reference pages for both protocols.

### Phase 5: sharing sightings

The agent-side payload and portal flow for sharing a drone sighting on a channel.

## Open questions

| Question | Needed before |
| --- | --- |
| How the attached add-on is powered on battery: the Heltec's 5V pin, a LiPo on the XIAO, or a boost converter | Phase 0 results |
| Image name. D8's pattern is for nodes; the firmware uses `xiaoc5-reaper-sensor-v{semver}` for now so a sensor image can't be mistaken for a node image. Confirm or change it | Phase 4 |
| Whether the accessory port should have an off setting for people who wire other things to GPIO47 and GPIO48 | Phase 3 |
| Which XIAO pins carry the link, now that the UART0 console sits on D6 and D7 | Phase 2 |
| Which other nodes get an accessory port (T-Beam, Wireless Stick V3); the T1000-E has no header | After Phase 3 |

## Sources

- Seeed XIAO ESP32-C5: [getting started](https://wiki.seeedstudio.com/xiao_esp32c5_getting_started/),
  [pin multiplexing](https://wiki.seeedstudio.com/xiao_esp32c5_pin_multiplexing/),
  [product page](https://www.seeedstudio.com/Seeed-Studio-XIAO-ESP32C5-p-6609.html)
- Espressif: [ESP32-C5 datasheet](https://documentation.espressif.com/esp32-c5_datasheet_en.html),
  [Wi-Fi modes](https://docs.espressif.com/projects/esp-idf/en/latest/esp32c5/api-guides/wifi-driver/wifi-modes.html),
  [coexistence](https://docs.espressif.com/projects/esp-idf/en/latest/esp32c5/api-guides/coexist.html),
  [Bluetooth LE feature support](https://docs.espressif.com/projects/esp-idf/en/latest/esp32c5/api-guides/ble/ble-feature-support-status.html)
- Heltec V3: [V3.2 pin map](https://resource.heltec.cn/download/WiFi_LoRa_32_V3/Wi-Fi_LoRa32_V3.2_Pinmap.png),
  [pin guidance](https://wiki.heltec.org/docs/devices/open-source-hardware/esp32-series/lora-32/wifi-lora-32-v3/Pin-diagram-guidance)
- Remote ID transports: [RFC 9575](https://www.rfc-editor.org/rfc/rfc9575.html);
  [opendroneid-core-c](https://github.com/opendroneid/opendroneid-core-c) (Apache-2.0)
- Legal: [FCC Marriott notice](https://transition.fcc.gov/eb/Public_Notices/DA-15-113A1.html);
  *Joffe v. Google*, 729 F.3d 1262 (9th Cir. 2013)
