# Web portal

The web portal is the Reaper Mesh app that runs in your browser. It connects to one board over
USB or Bluetooth and gives you messaging, a map, the list of nodes heard and every device
setting. It looks and works like the Reaper Mesh mobile app, and either can read the other's
QR codes.

Open it at **<https://reapermesh.com/web/>**, published from the latest `main` (D54). Use
Chrome, Edge or Brave: USB needs Web Serial and Bluetooth needs Web Bluetooth, which Safari and
Firefox do not have. Your messages, keys and settings stay in your browser; the site only serves
the app.

To run it from source:

```sh
npm ci --ignore-scripts
npm run dev:web
```

Open the address it prints (normally <http://127.0.0.1:5173/>). `npm run build:web` builds a
static copy into `dist/web/`.

## The tabs

| Tab | What's there |
| --- | --- |
| **Comms** | Channels and direct messages with real delivery states, and two-tap brevity phrases |
| **Map** | Nodes, your position, points and areas, measuring, shared items, MGRS or decimal readout |
| **Nodes** | Everyone heard, when, how far away, and discovery |
| **Signals** | A radar and history of what the signals add-on hears: drones, Wi-Fi, Bluetooth and devices searching for networks, with notes |
| **Device** | Live status and every device setting |

The tabs sit on a rail down the left side, or along the bottom on a narrow screen. Night (dark)
is the default theme; switch to Day in **Device → This app**.

## Connecting

- **Connect over USB** or **Connect over Bluetooth** opens the browser's device chooser.
  Bluetooth needs the board paired first (see [Bluetooth](#bluetooth)).
- **Your devices** lists boards you have used before. Select one to reconnect without the
  chooser. The trash button forgets it.
- **Use simulated device** needs no hardware. **Open without a device** shows saved messages
  and the map.
- **Rejoin on load** (on by default) reconnects to the last board when the page opens. Opening
  a USB port restarts some boards (the Heltec's CP2102 does), so turn this off if that matters.

If the link drops, you stay in the app. A banner shows while the portal retries after 2, 4, 8,
15 and 30 seconds, or at once when you plug the cable back in. **Nothing is resent**: messages
and saves with an unknown result are only *checked*. **Disconnect** returns to the connect
screen.

## Comms

- **Channels** come first, then **direct** conversations. A lock marks a channel that requires
  encryption. Search and the All, Channels and Direct filters narrow the list.
- **Sent messages** show a delivery icon; select one to see its state in words. *Transmitted*
  is not delivery, and *delivered* means the destination board received it, not that a person
  read it.
- A message with an **unknown** outcome has a **Check** button, and is checked once on each
  connection. Checking never sends it again.
- **Brevity phrases** (Copy, Moving, Holding, At rally, Need assist, All clear) sit above the
  message box. Press once to arm and again to send. An armed phrase disarms after 3 seconds.
- **Enter** sends; **Shift+Enter** adds a line. The byte counter appears within 200 bytes of the
  limit (1,024 bytes, less on an encrypted channel). Drafts are kept per conversation until you
  reload.
- **Deleting** a message or conversation removes it from this browser only; a message already
  queued may still go out. Deleting a *channel* conversation removes the channel from the board
  too. Public cannot be deleted.
- A direct message uses Public (channel 0) and its key. You can only message a node that has
  been heard.
- An encrypted message that cannot be read says why, and is never shown unless it
  authenticated. If a channel carries encrypted traffic and you have no key, sending is turned
  off so nothing goes out in the clear.

## Channels

Open **Device → Channels**.

- **New channel** takes a name of up to 8 letters, digits, `-` or `_`, and gets a random channel
  ID. **Encrypt this channel** is on by default.
- **Share** shows the channel's QR code (always dark on white), with **Download QR code**,
  **Copy as text** and, where supported, **Share QR code**. If the code includes the key, the
  page warns you: anyone with the code can read the channel.
- **Scan a channel QR code** reads a code with the camera, from an image file, or pasted as
  text, and tells you whether it is encrypted before anything changes.
- A channel's page has **Require encryption**, **Rotate key**, **Create a key** or **Remove key
  from this browser**, and **Remove channel from device**. Removing keeps its history and key
  in this browser, so rejoining restores them.
- **Public** is permanent. You can only share its key, or **Reset Public** to delete its chat,
  keys and encryption requirement from this browser.

Codes are `RMCH1` invites and `RMKEY1` key bundles. See [Security and privacy](security.md).

## Map

The map fills the tab with tools floating over it. Tiles load from Esri's Dark, Topo and
Satellite services; if they fail offline, nodes and messages keep working.

- **Left column:** drop a point at the crosshair, measure, draw an area, layers, saved items,
  track. **Right column:** zoom, follow my position, fit everything, full screen (Escape leaves).
- **Readout:** the crosshair's coordinate in MGRS or decimal degrees. Select it to switch. While
  following, it also shows heading, speed and elevation.
- **Right-click or long-press** the map to add a point or start an area there.
- **Markers:** a node not heard for 15 minutes is dimmed (which does not mean it is offline).
  Select one for its last report, range and bearing.
- **Items** have Share, Edit and Details. Saving is local and works without a connection.
- **Share** always asks which conversation to send to. Received items appear as cards in the
  conversation with **Add to map** and **Dismiss**; nothing changes your map until you accept.

Your location is asked for only when you follow your position, record a track or choose **This
browser** in **Device → Position**, and stays on this computer otherwise. Plugins can add new item types; see
[Plugins](plugins.md). The sharing format is in [Shared map items](../reference/map-sharing.md).

### Following, trails and tracks

These match the mobile app (D59), adapted for a browser and for a laptop in a vehicle.

- **Follow my position** keeps the map centred on you; select it again or drag the map to stop.
  The map stays north up, and your dot shows an arrow for the way you face or travel. The readout
  shows heading, speed and elevation. On a laptop the heading comes from your direction of travel
  while moving; on a phone or tablet, from its compass. A heading in amber needs the compass
  calibrated. Elevation shows only with a USB GPS, because browsers report a height that can be
  tens of metres off.
- **Trails.** Each node that reports positions leaves a trail of the last hour, fading with age.
  Hide them with the Devices layer.
- **Track** (footprints button) records where this computer goes: **Start**, **Stop**, save as GPX,
  and clear. One track is kept; starting a new one replaces it. It records only while the page is
  open. In a browser, keep the tab in front, because browsers may pause location in a hidden tab.
  A track left recording when the page closes is kept, stopped.
- **Keep screen on** (This app) keeps the screen, and in the desktop app the computer, awake while
  following or recording.

### USB GPS

Most laptops have no GPS, and their Wi-Fi location has no speed or heading. For a laptop in a
vehicle, plug in a USB GPS receiver that sends NMEA (nearly all do), then in **This app → Your
location** choose **USB GPS** and **Connect GPS receiver**. Pick the receiver's port, which is not
the radio's. The portal finds its speed (4800 to 115200 baud), remembers it, reconnects on the next
visit, and picks it up again if the cable is pulled and replugged. The GPS then feeds following,
tracks and **Device → Position → This browser**. It needs Chrome, Edge or the desktop app.

## Nodes

Every node this board has heard, with name, ID, how long ago, and distance and bearing when it
reports a position. **Discover** asks nearby nodes to identify themselves (they answer only if
they have replies turned on). **Message** opens a direct conversation. The trash button forgets
a node until it is heard again; its messages stay.

## Signals

The [signals add-on](../contributing/signals-design.md) is a Seeed Studio XIAO ESP32-C5 running the
[signals firmware](../../firmware/xiao-esp32c5-sensor/README.md). It listens to Wi-Fi on 2.4 and
5 GHz, Bluetooth LE and drone Remote ID, and only ever listens. Plug it into this computer's USB,
open **Signals** and choose **Connect**. With no radio, use **Connect signals add-on** on the connect
screen. It needs Chrome, Edge or the desktop app. With nothing connected, **Try a simulated add-on**
shows the same screen with no hardware.

The add-on listens to everything, and the screen decides what to show. It is laid out for a phone
first, and from top to bottom it has:

1. **The status line**, with **Monitor** and **Connect**.
2. **One row of chips** that pick what to show: **All**, **Drones**, **Flock**, **Ring**,
   **Cameras**, **Trackers**, **Wi-Fi**, **Bluetooth**, **Searching** (devices looking for a
   network) and **Watched**. Each shows how many it has.
3. **Search**, **Live**, **Filters** and **Radar** or **List**.
4. **The radar or the list**, and a panel for the signal you select.

**Live** is on at first, and keeps the screen to what is being heard now: a signal fades 15 seconds
after it was last heard and drops off after 30. That allows two missed rounds, because the add-on
takes about 11 seconds to go round every channel. The selected and hunted signals stay. With **Live**
off, the screen shows history: the 300 signals heard most recently on the radar, 200 in the list.

**List** shows the same signals as rows: name and what it is on the left, strength on the right. It
is made to be watched:

- Rows keep their place. A signal heard again doesn't move.
- A new signal arrives at the top, marked for a few seconds. One that goes quiet fades, shows how
  long ago it was heard, then leaves.
- Watched signals stay first.
- The strength shown is steadied. It changes only after a real move of 3 dB or more, and the radar's
  points use the same value.

**Filters → List order** can sort by **Strongest** (re-sorted every 10 seconds, still between times)
or **Name** instead of **Newest**.

The add-on is remembered. It reconnects on the next load and when plugged back in, without asking.
**Disconnect** stops that. It never picks a port on its own when a radio you have used has the same
kind of USB port, or when more than one port could be the add-on.

### The radar

Every shown signal is drawn around you, with its name under the strongest few. The rings show
distance, and north is up. The add-on has one antenna and can't tell direction, so each point's
colour says how it was placed:

- **Red: reported position.** A drone's Remote ID position, measured from yours.
- **Blue: estimated.** Heard from at least three of your positions spread over 30 m or more, or
  placed by a WiGLE lookup. The selected point shows its error circle.
- **Hollow: distance only.** A rough distance from signal strength (out by a factor of two or
  three), at a fixed angle so the point stays put. Its direction is unknown.

The shape is the kind: ▲ drone, ■ Wi-Fi, ● Bluetooth, ◆ searching device. Faded points have gone
quiet, a ring marks watched ones, and a dashed ring the one you are hunting.
Without your position (allow location, or use a USB GPS), every point is distance only.

Zoom around yourself with **+** and **−**, the mouse wheel or a pinch. **Auto**, or a double-click,
fits what is shown again.

### Filters

**Filters** holds the ones used less often:

- **Signal:** any, medium or stronger, or strong only.
- **Hide changing addresses**, on at first: phones change their Bluetooth address about every
  15 minutes, so each phone would show up many times.
- **With my notes**, and **New today**.
- **Export shown** saves every shown signal as one CSV file, with what it most likely is, notes and
  places. Names from the air that a spreadsheet would run as a formula are saved as text.

Search covers names, addresses, makers, notes and tags.

### A signal's panel

Selecting a point or a row opens its panel: beside the radar on a wide screen, or as a sheet from the
bottom on a phone. It shows what the signal most likely is, where it is, its strength and when it was
last heard, with three buttons:

- **Hunt** finds it by sound (below).
- **Map** shows it, or where you last heard it, on the map.
- **Watch** marks it, for the **Watched** chip.

The rest is folded away:

- **Details:** its strength over the last hour, when it was first heard and how often, where you
  were, and everything it sends (network, security, Bluetooth services, every network a searching
  device has asked for, or a drone's telemetry and operator).
- **Why:** the reasons for the guess, and **Correct** to set it yourself, optionally for
  everything with that name.
- **Notes:** your own name for it, a note and tags, and **Forget this signal**.

### What a signal most likely is

Each signal gets a best guess: a kind of device (tracker, phone, router, camera, vehicle and so on)
and a maker, with a confidence. The guess uses the maker registered for its address, the company in
its Bluetooth data, its services, its name, and your corrections. The maker database ships with the
portal and is checked for a newer copy whenever the portal opens; a lookup in it sends nothing
anywhere. **This app → Signals** shows its date and sources, and can forget your corrections.

**Flock** and **Ring** have their own chips. Both are recognised from published signatures, and the
confidence says how sure each match is:

- **Flock Safety** (licence-plate cameras, Raven gunshot detectors, battery packs):
  - an address registered to Flock Safety (high);
  - a network named `Flock-XXXXXX`, or a Bluetooth name such as `Penguin-…` or `FS Ext Battery`
    (high, but reported mostly off the air since early 2026);
  - the Bluetooth company ID its battery packs use, or a Raven's services (medium);
  - a device searching for any network on 2.4 GHz from one of the Wi-Fi modules Flock cameras use
    (medium). This is how cameras are mostly seen today. Other products use the same modules, so it
    can be wrong.
- **Ring** (doorbells and cameras):
  - an address registered to Ring (high);
  - a `Ring-XXXXXX` or `Ring Setup XX` network, which appears only during setup (medium).

  An installed Ring device joins your Wi-Fi as a client and broadcasts no network of its own, so it
  is seen only when it searches for one. Ring devices built on another maker's Wi-Fi chip are missed.

A camera that is not transmitting, or one wired to the network, can't be heard at all.

**WiGLE lookups** are optional and off until you turn them on in **This app → Signals** with your
own WiGLE API name and token. A lookup sends that network's address to WiGLE, which answers where
the network has been seen. The radar then places it there (blue, about ±75 m). Watched networks are
looked up on their own, and others from **Why**. Lookups are limited to 20 a day.

### Hunt

**Hunt** finds a signal, like a fox hunt. The portal beeps faster and higher as the signal gets
stronger, from one slow low beep every 1.5 seconds when it is faint to a fast high one up close. A
low tick every 2 seconds means it hasn't been heard for a while. The card above the radar shows the
strength, **Warmer** or **Colder**, the peak and a rough distance. A phone also vibrates. **Mute**
silences it, and **Stop** ends the hunt.

The add-on reports a Wi-Fi network or Bluetooth device at most every 5 seconds (a drone every half
second), so move slowly and pause. Turn on the spot to find the direction: your body blocks the
signal from behind.

### Monitoring

**Monitor** records a log for mapping afterwards. Press it, then **Start monitoring**. While it runs,
every signal heard is logged with your position, the time and its strength: when it is first heard,
and again whenever you have moved 5 m, its strength has changed by 5 dB, or 30 seconds have passed.
The button shows the time recorded. Keep the page open and in front; the screen is kept awake where
the browser allows.

**Stop monitoring** saves the log. Each saved log can be exported two ways:

- **CSV:** one row per logged point, with the time (UTC), your position and its accuracy, the
  signal's strength, kind, name, address, channel, what it most likely is, and a drone's own
  reported position.
- **Map file:** GeoJSON points at the places where each signal was heard, for mapping tools such as
  QGIS or geojson.io. Points logged without your position are left out.

Without your position, points are still logged, with no place. A log holds up to 250,000 points, and
the 50 newest logs are kept.

### Alerts

An alert bar appears above the chips, with a short chirp, when:

- a signal you **Watch** comes back into range;
- a drone, or a Flock or Ring device, comes into range;
- something has been **moving with you**: the same device heard at three or more of your places, at
  least 150 m apart, over 500 m and 20 minutes. That finds a tracker in a bag or a car following
  you. It needs your position, and can't follow phones that change their address.

**Show** opens the signal and moves to the next alert; the cross clears them. "Into range" means new,
or heard again after 10 minutes of silence. The same signal alerts at most every 10 minutes, and
"moving with you" once an hour. With the portal out of sight, an alert is also a notification.
**Filters → Alert sound** turns the chirp off.

A **Moving with you** chip appears while anything qualifies. Your own phone, watch and car will
qualify too, so mark them known.

### Known signals

Mark what is yours or expected as **Known**, and it is hidden and never alerts. That leaves the
screen for what is new.

- One signal: **Notes → Known** in its panel.
- Everything on screen: **Filters → Mark shown as known**. Do this once at home or at work. Watched
  signals are left alone.
- **Filters → Hide known signals** (on at first) shows them again when turned off.

### What is kept

Every signal is kept in this browser (IndexedDB) with what it last sent, a sighting per minute with
where you were, and a drone's track. Nothing is deleted automatically (D61). Each signal's history
is bounded, and past 20,000 signals the one heard longest ago without a note, tag or watch goes
first. Logs are kept the same way. The local wipe in This app deletes all of it. Nothing is sent over
the mesh or anywhere else.

The **Signals** button shows how many drones were heard in the last two minutes. On the map, a
drone is drawn with its operator and the track it has flown.

## Device settings

The Device tab shows the board's link state, radio, power, nodes heard, packet counts and
memory, then its settings:

| Page | What it sets |
| --- | --- |
| **General** | Device name and region. Only US is implemented; any other region turns the radio off |
| **Radio** | Mode (Off, Listen, Mesh), transmit power, boost (on boards that have it) and relay |
| **Radio network** | Open mode or a team, adding this radio as a member or relay, and key rotation. See [Security and privacy](security.md#team-networks) |
| **Channels** | See [Channels](#channels) |
| **Position** | Off, a fixed point, or this browser's location, and whether to share it |
| **Discovery** | Automatic announcements and replies, each off by default, every 1, 5 or 15 minutes or hourly |
| **Screen** | Screen timeout, wake on message, and the status light |
| **Bluetooth** | Start pairing over USB, see the passkey, pair this browser |
| **Diagnostics, Plugins, Storage** | Technical status, JSON plugins, history export and recovery tools |
| **This app** | Theme, units, coordinate format, bearings in degrees or mils, true or magnetic heading, keeping the screen on, message notifications, your location source (this browser or a USB GPS), Rejoin on load, your devices, PIN lock and erasing local data |
| **Install or update firmware** | Opens the [firmware installer](flashing-firmware.md#install-from-your-browser) in this tab. Flashing needs the USB port, so the portal disconnects |

**Position → This browser** saves your browser's location to the board as its fixed position.
To spare the board's flash, it updates only after you move 25 m, no more often than once per
beacon interval, and ignores fixes worse than 100 m. Positions are sent unencrypted, even on
encrypted channels.

## Notifications

With **This app → Message notifications** set to **Sender only** (the default) or **Full text**,
a message that arrives while the portal is in the background shows a notification. The browser
asks permission the first time you choose a setting. Selecting a notification opens its
conversation. Nothing arrives while the page is closed, because there is no push service, and
nothing about notifications leaves this computer.

## Bluetooth

USB and Bluetooth reach the same board and share its history. To pair:

1. Connect over USB, open **Device → Bluetooth** and select **Start pairing**, or hold the
   board's main button for 5 seconds.
2. Select **Pair this browser** (or pair a phone from the phone), then enter the passkey shown
   on the board's screen.

Web Bluetooth needs HTTPS or localhost. Chrome and Edge include it; Brave may need it enabled in
`brave://flags`. Details: [Bluetooth link](../reference/bluetooth.md).

## Under the hood

For technical readers: how the portal keeps state correct.

- **Saves are revision-checked.** If the board's settings change while you are editing, saving
  is blocked until you discard your edits. A save is only confirmed once the board reports it
  committed. An unknown save is queried once per connection and never resubmitted.
- **Messages are journaled before they are sent.** The USB identity, request counters and
  bounded history are saved to browser storage before each command, so a reload restores
  unfinished work as unknown and never resumes a partial send.
- **History limits.** The browser keeps a rolling 160 sent messages. Up to 32 *unresolved*
  messages (unknown outcomes or unacknowledged direct messages) are protected; at that limit the
  composer asks you to check or delete one. It never drops uncertain work silently. The journal
  is capped at 1 MiB, and received history at 32 entries per device.
- **One writer at a time.** A Web Lock lets only one tab write; a second tab is read-only.
  Clearing browser data creates a new identity, which can use another of the board's owner
  slots.
- **Deletion is local.** Deleting removes messages from this browser and leaves small
  identity-only records so the board's inbox does not download them again. It never cancels
  radio work, erases the board's inbox or removes anyone else's copy.
- **Unread counts are local.** Reading sends no receipt. The browser title shows `(N) Reaper
  Mesh` for unread messages.
- **No invented data.** The board has no clock, so times are when this browser first saw a
  message. All content is shown as text, never HTML.
- **Storage keys** are namespaced `reaper-mesh.*` in local storage, for example
  `reaper-mesh.message-ui.v1` and `reaper-mesh.nodes.v1.*`.

The code lives in `agents/web/`: `main.ts` wires the UI modules and runs the render loop,
`app-state.ts` holds shared state, and each area has a `*-ui.ts` module. Protocol and recovery
logic is in `packages/agent-core/`, not the UI. The simulated device is
`packages/simulator/field-device.ts`.
