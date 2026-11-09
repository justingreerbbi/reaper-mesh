# Web portal

The web portal is the Reaper Mesh app that runs in your browser. It connects to one board over
USB or Bluetooth and gives you messaging, a map, the list of nodes heard and every device
setting. It looks and works like the Reaper Mesh mobile app, and either can read the other's
QR codes.

Open it at **<https://reapermesh.com/>**, published from the latest `main` (D54). Use
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

## The four tabs

| Tab | What's there |
| --- | --- |
| **Comms** | Channels and direct messages with real delivery states, and two-tap brevity phrases |
| **Map** | Nodes, your position, points and areas, measuring, shared items, MGRS or decimal readout |
| **Nodes** | Everyone heard, when, how far away, and discovery |
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

- **Left column:** drop a point at the crosshair, measure, draw an area, layers, saved items.
  **Right column:** zoom, show my position, fit everything, full screen (Escape leaves).
- **Readout:** the crosshair's coordinate in MGRS or decimal degrees. Select it to switch.
- **Right-click or long-press** the map to add a point or start an area there.
- **Markers:** a node not heard for 15 minutes is dimmed (which does not mean it is offline).
  Select one for its last report, range and bearing.
- **Items** have Share, Edit and Details. Saving is local and works without a connection.
- **Share** always asks which conversation to send to. Received items appear as cards in the
  conversation with **Add to map** and **Dismiss**; nothing changes your map until you accept.

"Show my position" asks for your location only when pressed, and keeps it in this browser
unless you choose **This browser** in **Device → Position**. Plugins can add new item types; see
[Plugins](plugins.md). The sharing format is in [Shared map items](../reference/map-sharing.md).

## Nodes

Every node this board has heard, with name, ID, how long ago, and distance and bearing when it
reports a position. **Discover** asks nearby nodes to identify themselves (they answer only if
they have replies turned on). **Message** opens a direct conversation. The trash button forgets
a node until it is heard again; its messages stay.

## Device settings

The Device tab shows the board's link state, radio, power, nodes heard, packet counts and
memory, then its settings:

| Page | What it sets |
| --- | --- |
| **General** | Device name and region. Only US is implemented; any other region turns the radio off |
| **Radio** | Mode (Off, Listen, Mesh), transmit power, boost (T-Beam) and relay |
| **Radio network** | Open mode or a team, adding this radio as a member or relay, and key rotation. See [Security and privacy](security.md#team-networks) |
| **Channels** | See [Channels](#channels) |
| **Position** | Off, a fixed point, or this browser's location, and whether to share it |
| **Discovery** | Automatic announcements and replies, each off by default, every 1, 5 or 15 minutes or hourly |
| **Screen** | Screen timeout, wake on message, and the status light |
| **Bluetooth** | Start pairing over USB, see the passkey, pair this browser |
| **Diagnostics, Plugins, Storage** | Technical status, JSON plugins, history export and recovery tools |
| **This app** | Theme, units, coordinate format, Rejoin on load, your devices, PIN lock and erasing local data |
| **Install or update firmware** | Opens the [firmware installer](flashing-firmware.md#install-from-your-browser) in this tab. Flashing needs the USB port, so the portal disconnects |

**Position → This browser** saves your browser's location to the board as its fixed position.
To spare the board's flash, it updates only after you move 25 m, no more often than once per
beacon interval, and ignores fixes worse than 100 m. Positions are sent unencrypted, even on
encrypted channels.

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
