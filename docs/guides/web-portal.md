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
open **Signals** and choose **Connect add-on**. With no radio, use **Connect signals add-on** on the
connect screen. It needs Chrome, Edge or the desktop app. **Simulated** shows the same view with no
hardware.

**Radar** draws every signal around you, with its name under the strongest few. The rings show
distance, and north is up. The add-on has one antenna and can't tell direction, so each point's
colour says how it was placed:

- **Red: position reported.** A drone's Remote ID position, measured from yours.
- **Blue: estimated.** Heard from at least three of your positions spread over 30 m or more. The
  strongest reports pull hardest, and the selected point shows its error circle.
- **Hollow: distance only.** A rough distance from signal strength (out by a factor of two or
  three), at a fixed angle so the point stays put. Its direction is unknown.

The shape is the kind: ▲ drone, ■ Wi-Fi, ● Bluetooth, ◆ searching device. Faded points weren't heard
in the last two minutes, and a ring marks watched ones. Without your position (allow location, or use
a USB GPS), every point is distance only. **List** shows the same signals as cards.

The filters across the top:

- the kind (**All**, **Drones**, **Wi-Fi**, **Bluetooth**, **Searching**) and a search box for names,
  addresses, notes and tags;
- **Heard now**, **Watched**, **Noted**, **New today** and **Telemetry**;
- **Hide private addresses**, on at first: phones change their Bluetooth address about every
  15 minutes, so each phone would show up many times;
- a minimum signal, how recently it was heard, and the radar's radius (**Auto** fits most of what is
  shown).

**Selecting a signal** opens its panel, on the right (or above the radar on a narrow screen). It shows:

- where it is and how that was found;
- its signal now and at its strongest, with a line of the last hour;
- first and last heard, and how many separate times;
- where you were when you last heard it and when it was strongest, each with **Map**;
- what it sent: network, security and band, Bluetooth services, or a drone's telemetry (altitude,
  height, speed, heading, position and the operator's ID and position).

Below these you can give it your own **Name**, a **Note** and **Tags**, **Watch** it, or **Forget**
it.

**What it most likely is.** Each signal gets a best guess, which shows in the list, the panel, the
export, the **Is** filter and search. The guess is a kind of device (tracker, phone, router, camera,
vehicle and so on) and a maker, with a confidence and the reasons:

- the maker registered for its address;
- the company in its Bluetooth data;
- its Bluetooth services, or that it is a tracker;
- its name;
- your own corrections.

**Correct** sets it yourself, optionally for every signal of that kind with the same name, such as
your truck's hotspot everywhere. The maker database ships with the portal and is checked for a newer
copy whenever the portal opens. A lookup in it sends nothing anywhere. **This app → Signals** shows
its date and sources, and can forget your corrections.

**WiGLE lookups** are optional and off until you turn them on in **This app → Signals** with your
own WiGLE API name and token. A lookup sends that network's address to WiGLE. WiGLE answers where
the network has been seen and what it was called, and the radar then places it there (blue, about
±75 m). Watched networks are looked up on their own, and others with **Look up on WiGLE** in their
panel. Lookups are limited to 20 a day from this browser.

**History.** Every signal is kept in this browser (IndexedDB) with what it last sent, a sighting per
minute with where you were, and a drone's track. Nothing is deleted automatically (D61). Each signal's
history is bounded, and past 20,000 signals the one heard longest ago without a note, tag or watch
goes first. The local wipe in This app deletes it. Nothing is sent over the mesh or anywhere else.

**Scan plan** sets what the add-on listens to: a focus (**Balanced**, **Drones**, **Wi-Fi** or
**Bluetooth**), which Wi-Fi bands, Bluetooth, and searching devices. **Apply** sends the whole plan,
and the add-on says whether it took it.

- **Export** saves every signal the filters show as one CSV file, with notes, tags and places. Times
  are in UTC. Names from the air that a spreadsheet would run as a formula are saved as text.
- The **Signals** button shows how many drones were heard in the last two minutes. With
  notifications allowed in **This app** and the portal out of sight, a new drone also raises a
  notification, once per drone while the portal is open.
- The add-on is remembered. It reconnects on the next load, and after being unplugged it reconnects
  when plugged in again, without asking. **Disconnect** stops that. It never picks a port on its
  own when a radio you have used has the same kind of USB port, or when more than one port could be
  the add-on; choose **Connect add-on** then.

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
