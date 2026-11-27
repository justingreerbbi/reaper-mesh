# Signals intelligence design

**Status: approved (D61, November 23, 2026); steps 1 and 2 built.** This builds on the
[signals add-on](signals-design.md) (D60). It turns the Signals tab from a live list into a tool for
tracking and identifying the transmitters around the user. The tool should run in the portal first,
and later in the mobile app.

## What the owner asked for

- A radar screen centred on the user, with each signal drawn as a point at an estimated direction
  and distance, and its name under it.
- A panel on the right that shows one selected signal in full.
- History for every signal: first and last seen, where the user was, and so on. The user can add a
  note to a signal.
- Filters to narrow down which signals are shown.
- When online, the system works out what each signal most likely is, and keeps its reference
  database up to date.
- Signals that carry telemetry are tracked.
- A simple layout, so it can move to the mobile app.

## What can be measured

The add-on has one omnidirectional antenna. It measures signal strength (RSSI) and nothing about
direction. The radar must not invent precision, so every point carries how its position was found,
and the radar draws each kind differently:

| Position | How it is found | How it is drawn |
| --- | --- | --- |
| **Reported** | The signal states its own position: Remote ID drones, and any future telemetry that has a position. Distance and bearing are computed from the user's fix | Solid red point, true direction and distance |
| **Estimated from movement** | While the user moves with a location fix, each report is stored with the user's position and RSSI. A weighted centroid of the strongest reports estimates where the transmitter is. This needs a spread of positions, about 30 m or more, and is shown with an error radius | Solid blue point, with an error ring when selected |
| **Distance only** | RSSI converted to a distance with a log-distance path-loss model (reference power per kind, exponent 2.7). The error is a factor of 2 to 3 | Hollow grey point on its distance ring, at a fixed angle taken from its address, so it doesn't move around. The legend says "direction unknown" |

The **Hunt** mode in the panel helps the user find one signal (built: the meter, warmer or colder,
and beeps that get faster and higher with signal strength):

- **Warmer or colder.** A large live signal meter with a short trend line, for walking towards a
  transmitter.
- **Sweep**, on a phone or a tablet with a compass. The user turns slowly through a full circle, and
  their body blocks the signal from behind. The bearing with the strongest signal is marked on the
  radar as a rough direction. A laptop has no compass, so it gets the meter only.

The **centre** is the user's position, from the browser's location or a USB GPS (D59). Without a
position, the radar still works: the centre is "you", every point is distance only, and history
records no places. The radar is north-up when a compass heading is known; otherwise it is north-up
with the direction of travel shown.

## History and notes

Signals are stored on this computer in IndexedDB, because there are too many for `localStorage`.
The core is transport-independent and lives in `packages/agent-core/signals-intel/` with a storage
interface. The portal uses IndexedDB, the tests use an in-memory store, and the mobile app can supply
its own.

- **Signal record**, keyed by kind and address (or UAS ID). It holds:
  - first and last seen, and the number of sessions it was heard in;
  - the strongest RSSI, and where the user was when it was heard at that strength;
  - the last place the user was when it was heard;
  - the estimated position and its error;
  - the identification (below);
  - the user's own name, note, tags and watch flag.
- **Sightings.** One row per signal per minute: time, the user's position if known, best RSSI and
  count. Bounded to 500 rows per signal; older rows are thinned to one per hour.
- **Tracks** for signals that report positions (drones): bounded, thinned like sightings.
- **Retention.** The owner chose to keep everything: no record is deleted automatically. Each
  record's sightings and track stay bounded, and the store as a whole is capped at 20,000 records.
  Past the cap, the least recently seen record with no note, tag or watch flag goes first. A phone
  changes its private Bluetooth address about every 15 minutes, so the **Hide private addresses**
  filter keeps those out of the way.
- **Wipe.** "Delete signal history" in This app, and the existing wipe clears it too.
- **Nothing is sent over the mesh** or to any server. Sharing a sighting stays Phase 5, and is
  manual.

## Identification

Each signal gets a **best guess**: a category (phone, laptop, access point, router, camera, drone,
tracker, wearable, sensor, vehicle, printer, TV or media, unknown), a likely maker, a confidence, and
the reasons, which the panel shows ("maker from address prefix", "name matches HP printers"). The
user can correct it, and a correction teaches a local rule ("this network name is my truck").

The guess comes from rules run on this computer:

- The address prefix (OUI) gives the maker. This doesn't work for locally administered addresses,
  which most phones use, and those are labelled "private address, most likely a phone or laptop".
- The Bluetooth company ID, advertised services and tracker type.
- Patterns in network and device names (`DIRECT-…` printers, drone and camera hotspots, car
  systems), and the security type and band.
- The local rules the user has taught it.

**Keeping the database current (the "when online" part).** The reference data is one versioned file,
`signals-reference.v1.json`, built by a tool from public sources:

- the IEEE OUI registry;
- the Bluetooth SIG company identifiers and service UUIDs, through Nordic's
  `bluetooth-numbers-database` (BSD-3-Clause; its notice travels in the file).

The name, service and maker rules are code (`packages/agent-core/signals-identify.ts`), so they are
tested and ship with the portal.

The file is published with the portal, on the same origin. When online, the portal checks it on load
and at most daily, downloads a newer version, and keeps it in IndexedDB, so identification keeps
working offline. Updating the pack sends no address or name.

**Online lookups (the owner's choice).** On top of the pack, the setting **Look up Wi-Fi networks on
WiGLE** in This app asks WiGLE where a network has been seen, and what it was called. It uses the
user's own WiGLE API name and token.

- A lookup sends the network's address to WiGLE, and the setting says so.
- Lookups are spaced 15 s apart, limited to 20 a day from this browser, and cached in the signal
  record.
- Watched networks are looked up on their own, and any network on demand from its panel.
- WiGLE's position counts as an estimate on the radar (±75 m), with "where WiGLE places it" shown.
- It is off until the user turns it on.

MAC-vendor web services were planned too, but they don't allow requests from a browser (no CORS).
The pack already carries the full IEEE registry, so they would add nothing.

## Telemetry

- **Remote ID** is telemetry already. Drones get a track, the operator's position, and history.
- **Bluetooth sensors and beacons** (BTHome, Ruuvi, Govee, Xiaomi, iBeacon, Eddystone) put their
  readings in manufacturer data or service data. The add-on currently sends only the manufacturer ID,
  services and tracker type, so decoding these needs the raw advertisement. That is a **sensor
  protocol change**: an optional `advert` field (up to 62 bytes of raw AD structures) on
  `bleDevice`, sent only when it changes and within the byte budget. It is appended, so existing
  fixtures stay the same. The firmware only passes the bytes through, and decoders run in the agent
  as small pure functions, or as plugins later (D41).
- Decoded readings are kept as a bounded series per signal, like sightings, and shown in the panel.
- Wi-Fi access points carry no telemetry worth decoding, and the add-on never reads Wi-Fi data
  frames.

## Alerts

- **Watched signal heard again.** The user marks a signal with **Watch**.
- **Seen moving with you.** The same stable address is heard at three or more of the user's places,
  each at least 150 m from the others, over at least 500 m and 20 minutes within a day. This is the
  useful counter-surveillance case, for a tracker hidden in a bag or a vehicle. Apple and Samsung
  trackers away from their owner keep an address for hours, so this works for them. It can't work
  for phones that change their address.
- **A drone, or a Flock or Ring device, coming into range.**

Built (`packages/agent-core/signals-alerts.ts`, `agents/web/signals-alerts-ui.ts`):

- "Coming into range" means new, or heard again after 10 minutes of silence.
- A signal alerts at most every 10 minutes; "moving with you" at most once an hour.
- Signals the user marked **Known** never alert. The user's own phone, watch and car will otherwise
  count as moving with them, so marking them known is the fix.
- An alert shows a bar with **Show** (most important first, with a count of the rest), plays a short
  chirp unless **Alert sound** is off, and raises a notification when the portal is out of sight.
- Low-confidence Flock and Ring matches don't alert.

## Layout

Simple enough to move to a phone. From top to bottom:

1. **Header:** add-on state and the connect controls (as now).
2. **Filter bar:** kind chips (All, Drones, Wi-Fi, Bluetooth, Searching), quick filters (Watched,
   Noted, New today, Now heard, Has telemetry), a search box, and a radius. **More filters** opens a
   sheet: category, minimum signal, maker, security, band, last seen within, and hiding private
   addresses.
3. **Body:** **Radar** or **List** (the current cards), and the **detail panel**. On a wide screen the
   panel is on the right. On a phone it is a bottom sheet over the radar.

The detail panel shows:

- name, category and maker guess;
- the position (with how it was found), signal, and first and last seen;
- "last seen from" with a map link;
- the RSSI history as a sparkline;
- telemetry, when the signal has it;
- the identification reasons, with **Correct**;
- the note, tags, **Watch**, **Hunt**, **Show on map** and **Export**.

## Delivery

Each step can be used on its own and is tested before the next one starts.

**Review additions (November 23, 2026).** The owner asked for a review of what a signals
intelligence tool was still missing. Added, with nothing permanent on screen:

- **Known signals.** A flag per signal, set in its panel or for everything shown at once (**Mark
  shown as known**). Known signals are hidden by default and never alert. This gives a baseline: at
  home or at work everything normal is marked once, and what is new stands out.
- **Alerts**, as described under [Alerts](#alerts), with a **Moving with you** chip that appears
  only while something qualifies.
- **Searched networks.** Every network name a searching device asks for is kept (16 per device),
  shown in its details, searchable and exported. The names say where a device has been.
- **Drone tracks.** The newest 300 positions of a drone's track are drawn on the map.
- **Radar names** no longer land on each other: the selected, hunted and watched are named first,
  then the strongest.
- The CSV export gains **Known** and **Searched for** columns.
- **Not verified:** "moving with you" with a real moving position (host tests only), and the chirp
  by ear.

**A list that can be watched (November 23, 2026).** The owner found the list changed too often to
follow: it re-sorted by last heard and rebuilt every row several times a second. Scanner apps and
live-list guidance agree on the fix (Simplicity Connect keeps discovery order, adds new devices
without reshuffling and pins favourites; airodump-ng refreshes once a second and holds a quiet device
for a fixed time; live-feed guidance says to mark new items, not reorder silently). So, in
`packages/agent-core/signals-steady.ts`:

- `StableOrder` keeps rows in place. A new signal goes on top and is marked for 8 s, a leaving one
  closes the gap, watched ones stay first, and only a change of filters or sort lays the list out
  again. Sorting by strength re-sorts every 10 s.
- `SteadyRssi` smooths each signal's strength (30% of each report) and changes the shown value only
  after a 3 dB move. The list, the panel and the radar's distance-only points all use it.
- The portal reuses each row's elements and updates text in place. "Ago" shows only once a signal
  has gone quiet.
- Verified in a browser with the simulated add-on: over 15 s of reports, no row moved and no row
  element was replaced.

**Revamp for phones, monitoring, and Flock and Ring (November 23, 2026).**

- **Screen.** Rebuilt phone-first, in smaller modules (`signals-ui.ts`, `signals-radar.ts`,
  `signals-panel.ts`, `signals-hunt-ui.ts`, `signals-monitor-ui.ts`, `signals-dom.ts`):
  - one row of chips picks what to show; the rarer filters are in a sheet;
  - the panel shows three actions and three facts, with the rest folded; on a phone it is a sheet
    from the bottom;
  - the list is plain rows;
  - on-screen explanations were cut, at the owner's request.
- **Live.** On by default. A signal fades 15 s after it was last heard and drops off after 30 s.
  A full round of channels takes about 11 s (38 Wi-Fi channels at 150 ms, plus Bluetooth slots), so
  30 s allows two missed rounds. Off shows history: the newest 300 on the radar.
- **Monitoring** (`packages/agent-core/signals-log.ts`, IndexedDB stores `log-sessions` and
  `log-rows`):
  - A session logs a row when a signal is first heard, and again after the user moves 5 m, its
    strength changes 5 dB, it is the strongest it has been with a position, or 30 s pass. The
    last rule means the closest approach on a drive is never missed.
  - Each row has the time, the user's position with its accuracy and, when older than 10 s, its age,
    strength, kind, name, address, channel, the guess, and a drone's reported position.
  - The user's route is logged in the same rows (`kind: 'route'`) after each 5 m moved, and every
    30 s standing still.
  - Exports place each signal row between the route points around it by time (`positioned`), when
    they are at most 3 minutes apart (`LOG_BETWEEN_MS`). A first drive on a laptop without GPS got a
    Wi-Fi position once a minute at ±40–120 m; holding the last one put rows up to a minute of
    travel behind. The sheet warns when the browser's position is rougher than 25 m or rarer than
    every 10 s.
  - The logger keeps its own latest position and uses it for up to 2 minutes (`LOG_FIX_MS`). A
    phone's browser sends a fix only when the position changes, and the app-wide 10 s staleness
    left rows without a place whenever the user stopped.
  - Limits: 250,000 rows a session and 50 sessions.
  - `summarize` gives one line per signal, placed at its strongest row with a position. The CSV and
    the GeoJSON use it; **All points** (`logPointsCsv`) exports every row.
  - **View on map**: the route and the summary's points, drawn on a canvas layer of the Map tab
    (`FieldMap.setLog`). It is never stored and is cleared when the Map tab is left.
- **Flock and Ring** are known devices in `signals-identify.ts`, each with its own chip. The
  signatures come from the flock-you project's lists, the IEEE registry and the Bluetooth SIG
  numbers:
  - Flock: its own prefix `B4:1E:52`; `Flock-XXXXXX` networks; `Penguin-` and `FS Ext Battery`
    Bluetooth names; company ID `0x09C8`; Raven services `0x3100` to `0x3500`; and a wildcard probe
    on 2.4 GHz from one of 24 Liteon and USI module prefixes. The last is medium confidence: the
    project's field test found 11 of 12 cameras, with 2 false positives.
  - Ring: its 13 registered prefixes, and the setup network name.
  - Left out as too broad: the Espressif, Samsung, Atheros and unregistered prefixes on the
    community list, matching a prefix alone on other frames, and the probe's element fingerprint,
    which the add-on doesn't report.
  - The simulated add-on now includes one of each.
- **Not verified:** any of this against a real Flock or Ring device; monitoring with a real moving
  position; the screen on a real phone.

**Owner changes (November 23, 2026).**

- **No scan plan.** The scan plan is gone from the portal. Once per add-on boot, the portal sends a
  plan to listen to everything (both bands, Bluetooth, and devices searching for networks), and the
  filters decide what is shown. This is the owner's call. It changes D60's default of probe capture
  off in the portal; the firmware's own default is still off.
- **Zoom.** The radar zooms around the user (buttons, wheel, trackpad and touch pinch), with rings
  at round distances.
- **Hunt** (`packages/agent-core/signals-hunt.ts`, `agents/web/signals-hunt-ui.ts`):
  - Each report's strength is smoothed (half of each new report).
  - Warmer or colder compares the last 4 s with the 8 s before, by at least 3 dB.
  - The beep runs from 1.5 s and 350 Hz at -95 dBm to 0.1 s and 1.6 kHz at -40 dBm, falling
    geometrically. A lost signal ticks at 220 Hz every 2 s.
  - Web Audio starts on the Hunt click, and a phone vibrates too.
  - The add-on reports a Wi-Fi or Bluetooth transmitter at most every 5 s (`kUpdateMs`), which
    makes a hunt slow. Faster reports for the hunted signal need a firmware and sensor protocol
    change, which is proposed, not built.
- The panel's buttons now stay in place while reports stream in, and radar points and list rows
  select on press, so a redraw can't swallow a click.

**Step 2 built (November 23, 2026).**

- `packages/agent-core/signals-identify.ts` holds the pack format and its check, lookups, and
  `identify()` with weighted evidence. The evidence comes from address prefixes, Bluetooth company
  IDs, services and tracker types, name patterns, and maker categories. The user's correction or a
  rule by name wins.
- `packages/agent-core/wigle.ts` does the WiGLE lookup and reads its answer defensively.
- `tools/build-signals-reference.ts` builds `agents/web/public/signals-reference.v1.json`
  (30,926 makers, 1.5 MB, about 580 KB compressed). `npm run check` checks that it is well formed.
- In the portal (`agents/web/signals-identity.ts`):
  - the saved pack is used first, then the served one is fetched and kept if it is newer;
  - corrections are saved per signal, and optionally for every signal of the kind with that name;
  - the WiGLE queue;
  - a **Signals** card in This app.
- The panel shows the guess with its confidence and reasons, **Correct**, and WiGLE's answer. The
  list shows the guess, a filter picks a category, search covers makers and categories, and the CSV
  has both.
- **Verified:** host tests; in a browser with the simulated add-on, guesses with reasons, a
  correction applied by name, and the WiGLE setting.
- **Not verified:** a real WiGLE lookup (needs the owner's key), the real add-on, the desktop app.

**Step 1 built (November 23, 2026).**

- The core is `packages/agent-core/signals-intel.ts`: records, minute sightings, drone tracks,
  visits, the total cap, distance from RSSI, the position estimate from movement (included now
  because it is small), placement and filters.
- The portal side: `agents/web/signals-db.ts` (IndexedDB, deleted by the local wipe),
  `signals-history.ts` (records each report with this computer's position, and writes every 5 s)
  and `signals-ui.ts` (radar, list, panel, filters and the history CSV).
- **Hide private addresses** applies to Bluetooth only. Phones' Wi-Fi probes almost always use a
  changing address, and hiding them would empty **Searching**.
- **Verified:** host tests; in a browser with the simulated add-on, the radar, the panel, a note and
  watch flag that survive a reload, and the filters.
- **Not verified:** the estimate with a real moving position, the real add-on, the desktop app, and
  the mobile layout on a phone.

1. **History, radar and panel (built).** The intel core with storage, the estimator and filters; the
   radar (SVG); the panel with notes and watch; the List view kept. No protocol change.
2. **Identification (built).** Local rules, the reference-pack tool and its file, checking for
   updates on load, corrections, and WiGLE lookups.
3. **Hunt (built, except the compass sweep).** The warmer-or-colder meter and the beeps. The
   movement estimate itself was
   built in step 1.
4. **Telemetry.** The `advert` field (owner approval), the firmware passing it through, decoders and
   series.
5. **Alerts (built).** Watched signals, drones, Flock and Ring devices, and "seen moving with you".

## Owner decisions (November 23, 2026)

| Question | Decision |
| --- | --- |
| Scope (AI.md requires one before adding telemetry or internet use) | D61 approved: local history, a radar, identification and telemetry decoding in the agent |
| Online identification | The reference pack, and per-signal online lookups behind a setting that is off by default (WiGLE; MAC-vendor services refuse browser requests) |
| Raw Bluetooth advertisements in the sensor protocol | Approved, as an appended optional field, in step 4 |
| Retention | Keep everything; bounded per record and capped in total |
