# Field portal

The web agent lives in `agents/web/`. It uses TypeScript and Vite with native DOM controls plus Leaflet for the map. Protocol/state logic stays in `packages/agent-core/`; the form model only owns drafts and bounded command history. Firmware and wire contracts are unchanged by portal layout work.

```sh
npm ci --ignore-scripts
npm run dev:web
```

Open the printed localhost URL (normally `http://127.0.0.1:5173/`). The server binds to loopback only. `npm run build:web` creates the static agent in ignored `dist/web/`. `npm run check` includes the production build as well as type checks, schema checks, and host tests. Nothing is deployed or published.

## Layout

The portal follows the Reaper Mesh mobile app in look and features (D49): the same near-black Night and light Day palettes, pill controls and icons, with four tabs on a floating navigation rail. The rail runs down the left side, and along the bottom on a narrow screen. Night is the default; change it in Device → This app.

| Tab | What's there |
| --- | --- |
| **Comms** | Channels and direct messages with real delivery states, and two-tap brevity phrases |
| **Map** | Nodes, your position, points and areas, measuring, shared items, MGRS or decimal readout |
| **Nodes** | Everyone heard, when, how far, and discovery |
| **Device** | Live status and every device setting, opened as pages with a Back button |

On a narrow screen, panes take turns: the conversation list, then a thread with a back button. Selecting the tab you are on returns it to its start.

## Connecting

The connect screen is the only page until a session is up. **Connect over USB** and **Connect over Bluetooth** open the browser's own chooser. **Your devices** lists devices used before, and selecting one reconnects without the chooser when the browser still has permission. **Use simulated device** needs no hardware, and **Open without a device** shows saved messages and the map.

Once a session has been up, a lost link keeps you in the app. A banner says the link is lost while the portal retries at 2, 4, 8, 15 and 30 seconds, using a new link each time. Plugging a USB adapter back in retries at once. Nothing is resent: unknown outcomes are only queried. **Disconnect** ends the session and returns to the connect screen.

**Rejoin on load** (Device → This app, on by default) connects to the last device when the page opens, if the browser still has permission. It never shows a prompt. Opening a USB port can restart a board (the Heltec's CP2102 does), so turn this off if that matters. Browsers only expose earlier Bluetooth devices with `navigator.bluetooth.getDevices`, which Chrome keeps behind a flag; without it, Bluetooth asks through the chooser instead.

## Comms

- Channels come first, then direct conversations. A lock marks a channel that requires encryption. Search and the All, Channels and Direct filters narrow the list.
- There is no separate New message form, so direct messages use channel 0 (Public) and its key, and a node that has not been heard cannot be messaged.
- Received messages are on the left, with the sender's name in channels, and sent messages on the right. Each shows the time this browser first saw it (the device has no clock) and, for sent messages, a delivery icon. Selecting a sent message shows its status in words. Transmitted is not delivery, and delivered means the destination device accepted it, not that anyone read it.
- A message with an unknown outcome has a **Check** button, and is also queried once per connection. Checking only reads; it never sends the message again.
- **Brevity phrases** (Copy, Moving, Holding, At rally, Need assist, All clear) sit above the message box. The first press arms one and the second sends it. An armed phrase disarms after 3 seconds.
- An encrypted message that cannot be read says why, and its text is never shown unless it authenticated. If a channel has encrypted traffic and this browser has no key, sending is off so nothing goes out in the clear.
- The byte count appears only within 200 bytes of the limit. Drafts are kept per conversation in this tab and are not saved across a reload. Enter sends; Shift+Enter adds a line.

## Channels

Device → Channels lists each channel with its encryption state.

- **New channel** takes a name of up to 8 letters, digits, `-` or `_`, and gets a random channel ID. **Encrypt this channel** is on by default and creates a key as soon as the device has saved the channel.
- **Scan a channel QR code** reads a code with the camera, from an image file, or pasted as text. The sheet says whether it is encrypted before anything changes. Joining puts the channel in any free slot with the same ID, and refuses a different channel that already uses the name. A key on its own (`RMKEY1`) is added to a channel the device already has, which is how Public's key is shared.
- A channel's page has **Require encryption**, **Rotate key**, **Remove key from this browser** or **Create a key**, and **Share**. Renaming keeps the channel and affects only this device.
- **Share** shows the QR code, always dark on white, with a warning when it contains the key. **Download QR code** saves a PNG, **Copy as text** copies the code, and **Share QR code** appears where the browser can share files. Leaving the page clears the code from the screen.
- **Remove channel from device** empties its slot after confirmation. Messages waiting to send are cancelled (`radio-config-changed`), as with any radio change. It leaves the conversation list and unread counts, and an open conversation on it moves to Public. Its chat history and key stay in this browser and return on rejoining.
- Public is permanent. Every device already has it, so it can only share a key. **Reset Public** deletes its chat and its keys and encryption requirement from this browser.

Codes are the same `RMCH1` invites and `RMKEY1` bundles the mobile app uses, so either can read the other's. See [channel IDs](../reference/radio-configuration.md#channel-ids) (D45) and [Channel encryption](encryption.md). Channel and radio changes need firmware with channel IDs (`v0.3.0`); earlier firmware stays readable.

## Map

The map fills the tab, with everything floating over it. It works without tiles: they load from Esri's Dark, Topo and Satellite services and may fail offline, and node and message functions keep working.

- **Left column:** drop a point at the crosshair, measure, draw an area, map layers, and saved items. **Right column:** zoom, show my position, fit everything, and full screen (Escape leaves).
- **Readout:** the crosshair's coordinate, in MGRS or decimal degrees. Select it to switch. MGRS falls back to decimal near the poles.
- **Measure:** click points, or use **Crosshair**, for total distance and the last leg's distance and bearing. **Undo** removes a point.
- **Draw an area:** drag with a mouse, click two corners, or use **Crosshair**, then **Save**. A third corner replaces the older one.
- **Right-click or long-press** the map to add a point or start an area there.
- **Markers** show labels. A node not heard for 15 minutes is dimmed, which does not mean it is offline. Selecting one shows when it reported and its range and bearing, measured from this browser if located, otherwise from the device's fixed position.
- **Items** open a panel with Share, Edit and Details, or Remove for a shared item. The editor takes a name, note and color, plus type and fields when a plugin adds them. Saving is local and works disconnected.
- **Share** always asks where to send, as a list of your conversations. **Ask to remove** sends a withdrawal instead. Nothing implies the recipient accepted it.
- **Received items** appear as cards in the conversation, with Add to map (or Update, or Remove) and Dismiss. Nothing is placed on the map until you accept it, and an older copy cannot bring back something replaced or removed.

Layers also has separate Map items and Devices toggles, and the saved-items panel has search and **Export map workspace**. Missing positions are never plotted. "Show my position" only asks for location when pressed, and the location stays in this browser unless you choose This browser in Device → Position. See [plugins.md](plugins.md) and [map-sharing.md](../reference/map-sharing.md).

## Device

The Device tab shows the device with its link state, Radio, Power, Nodes heard, TX · RX and Memory, then its settings.

- **General:** device name and region. Saving a region other than US turns the radio off, because only the US profile is implemented.
- **Radio:** mode, transmit power, boost where the board has it (currently the T-Beam), and relay. Power per board is in [radio configuration](../reference/radio-configuration.md#transmit-power). Firmware older than `v0.4.0` must be updated before radio settings can be changed.
- **Position:** Off, Fixed point or This browser. A fixed point has its own Share switch. **This browser** saves the browser's location to the device as its fixed position, which it then announces. Because each change restarts the device's beacon timer and writes to its flash, it updates only after 25 m of movement, no sooner than one beacon interval plus 10% and 5 seconds, and ignores fixes worse than 100 m. It stops when the page closes and keeps the last location. Locations go over the radio unencrypted, even on encrypted channels. Sharing defaults off, and a stored position alone never authorizes transmission.
- **Discovery:** independent opt-in announcements and replies, every 1, 5 or 15 minutes or 1 hour. A value set elsewhere stays selectable. Both default off in firmware. A peer must be in mesh mode with replies on to answer.
- **Screen:** how long the device's own screen stays on, and whether a message wakes it, for firmware that advertises `screenVersion` 1. See [device screen and buttons](../reference/device-display.md#screen-settings).
- **Bluetooth:** start pairing over USB, see the passkey, and pair this browser. See [below](#bluetooth).
- **Diagnostics, Plugins and Storage:** technical status, JSON plugins, and history export, retry and reset.
- **This app:** appearance, distance units, coordinate format, Rejoin on load, your devices, PIN protection and erasing local data.

Settings use revision-checked saves. If the device changes while you are editing, saving is blocked until you discard your edits. Nodes keep showing across reconnects, per device, in `reaper-mesh.nodes.v1.*`; a position is only as fresh as its last report.

## Try it without hardware

Select **Use simulated device** on the connect screen. It answers over the same framed, typed protocol and serial adapter as a real board, with channels, messages, three heard nodes, positions, a received map item and pairing replies. It models protocol replies, not a radio: nothing here shows how a radio behaves. A page reload resets it and the agent's history for it. The code is `packages/simulator/field-device.ts`; `SimulatedDevice` stays as the smaller reference for host recovery tests.

To try recovery, open Device → Storage while connected to it:

1. Set **Next save** to **Disconnect after commit**, change the name in Device → General, and save. The link drops and the change's outcome becomes unknown. The portal reconnects and queries it without resending.
2. To see a lost outcome, repeat step 1 and select **Reboot simulated device**. The receipt is gone, so the app says the change may not have applied and shows the device's settings.
3. **Lose result and change event** suppresses the reply for the next save, including retries. After the bounded retry window it becomes unknown and the app queries it.
4. **Drop the link** shows the lost-link banner and reconnecting. **Read-only on next connect** shows capability-based blocking.

## USB and recovery boundaries

USB uses the browser's port chooser the first time, and the permission the browser keeps after that. The browser must support Web Serial in a secure context such as localhost. Reaper Mesh firmware is required; the development Heltec and T-Beam are running it. Native Brave USB is physically qualified for the checks below. Firmware installation uses the manifest-validating CLI in flashing-firmware.md.

Device status/capabilities are readable even when writes are blocked. The UI displays the blocking reason, advertised byte limit, region availability, owner admission, receipt/owner capacities, and firmware/radio identifiers. The messaging UI exposes local delivery, bounded outgoing history and received messages; remote sends require live radio readiness.

Drafts are preserved while editing. If the boot, device identity, or revision changes, saving the old draft is blocked until it is discarded. Pending changes cannot be resubmitted. The portal keeps no visible change history: it releases each settings change from the agent's 32-entry history once its outcome is final, and shows a message if the device rejected it or a conflict loaded newer settings. A change with an unknown outcome is queried once per connection, never resent. It is released when the result arrives, or when the device has rebooted (the receipt is gone); the app then says the change may not have applied, and the settings shown are what the device reports. Changes made through another device stay held until that device reconnects.

Each connection source retains its own agent manager for this page session. Port-chooser results arriving after cancellation are ignored. Page exit requests disconnect cleanup, but browsers do not guarantee completion during page teardown. USB history/incarnation survives reload in plaintext local storage, with a Web Lock preventing simultaneous writers in this browser bucket. Other browsers/profiles have separate identities. Device owner marks are not silently evicted; exhausted admission is read-only until an explicit device reboot, which loses volatile receipts/queues. Export/query pending history first. The UI must not solve capacity exhaustion by resetting a real device or silently rotating IDs.

## Validation recorded

131 host/cross-language tests, strict TypeScript checks, generated declarations, and the production web build pass locally. Six tests cover the UI draft model and shared simulator, including stale edits, lost results, disconnect recovery, read-only behavior, and history release.

Manual in-app browser QA verified simulator connection, label save/revision update, disconnect-after-commit, reconnect/query recovery, read-only disabled editing, and return to writable mode. No browser console errors were observed. The default narrow viewport rendered the responsive single-column layout. Native USB connection/save/reconnect is now verified as recorded below; browser reload recovery and RF remain unverified.

## Message composer

The composer accepts up to 1024 UTF-8 bytes, less for an encrypted channel. It requires message capability v1 and displays upload/queue/transmit/ACK/failure/unknown separately. Status queries never resend text. Clearing uncertain or active queue history requires explicit abandonment; it does not cancel device work.

## Inbox, local testing and diagnostics

The integrated firmware supports local delivery by selecting This device. An acknowledged local result explicitly says no radio transmission; the same text appears in Received messages. The agent reads the inbox with independent bounded cursors, displays retention gaps and keeps received history to 32 entries. Live radio state and RX/TX counters appear on the Device tab; memory and stack headroom are under Diagnostics. Remote submission is disabled while the radio reports a blocking reason. Configuration and inbox history counters remain independent.

## Reload recovery

USB identity, monotonic request counters and bounded command/message/inbox history are checkpointed before dispatch. Reload restores unfinished work as unknown and never resumes partial sends. Query status after reconnecting to the same device/boot. The recovery panel exports history, retries unavailable storage, or explicitly resets disconnected history. Reset/cleared browser data allocates a new identity and can consume another device owner slot. Invalid saved JSON remains exportable; it is not silently discarded. A second tab is read-only. Native Brave local delivery and both outgoing/inbox retention across reload passed on usb-prototype-4.

## Portal verification / data limits (November 2)

223 host tests and the production build pass. Browser checked at390px and1440px: settings, navigation, offline drafts and conversation switching; no horizontal overflow or observed console errors. No USB/RF regression was repeated for presentation-only changes. The inbox protocol supplies sender/channel but no original destination or timestamp. Channel views therefore show traffic received by this device, including potentially direct traffic; peer views group by sender. No fake sent time/read status is displayed. Cross-direction order after restoring history is reconstructed because the device does not provide a common timestamp/order. All content is rendered as text, including map names/tooltips. Basemap failure keeps local asset/message functions available. GPS remains deferred.

## Message management and unread indicators

The conversation header's three-dot options menu has **Clear chat history**, which removes the conversation's retained messages after confirmation and keeps the channel or direct message in the list; it is unavailable while the chat is empty or uploading. (The earlier Delete chat also hid the conversation, and the Locate device button was removed on November 3; use the map to find a device.) Removal is local to this browser, including other local views of the same received message. It does not cancel queued RF work, change device ACKs, erase a device inbox or remove another user's copy. Clearing also removes sent messages' delivery-query recovery records and frees local upload-history slots. A chat with an active upload cannot be cleared. Received bodies are removed from the local recovery journal; identity-only tombstones suppress device-inbox redownloads. Clearing browser storage removes these tombstones, so retained device messages may return.

Clearing captures the chat's message identities when confirmation opens; new arrivals during confirmation survive. Single-message delete was removed on November 3. Conversations hidden by the earlier Delete chat stay hidden until new traffic arrives or they are opened explicitly.

Unread UI state is separate from delivery state. Unique incoming identities increment inbox-row and navigation badges plus the browser title `(N) Reaper Mesh`. Channel/peer views may show the same incoming message, but the title counts it once. A visible, focused conversation at the bottom marks matching messages read locally; hidden tabs, the deletion dialog, the mobile inbox and reading older messages do not. The new-messages button jumps to the latest messages. Reading sends no read receipt or ACK; there is no mark-all-read action. First installation baselines existing saved history as read; later reloads retain unread state and recognize new messages recovered after reload.

Metadata uses `reaper-mesh.message-ui.v1`, under the existing portal writer lock, separately from transport request counters. Storage failures/read-only tabs disable destructive actions without altering protocol state; malformed saved metadata is preserved. Each record may carry the time this browser first saw the message; records saved before that have none. Bounds are 4096 message identities (sent messages with a time count too)/1024 hidden conversation keys/2MiB; exhaustion fails closed rather than evicting deletions. Local deletion is published only after metadata storage succeeds, then the ordinary history checkpoint removes bodies. A crash between those steps is reconciled on the next render without replaying work.

Verification:232 host tests, generated/type checks and production build pass. An isolated5174 browser origin with synthetic messages verified title/badges, read-on-opening, individual received deletion, reload suppression, conversation removal, and a new arrival reopening the conversation with count1 while earlier deleted messages remain hidden. No user's history, radio settings, firmware or ACK logic was changed for QA. Temporary fixture pages/server were removed. Previews in ignored build/message-management-preview.png and message-unread-preview.png contain only labeled QA messages.
### Channel and direct-message separation

Configured channels always appear as channel rows. Peer conversations remain scoped to their channel ID. Received inbox items use the RF destination to distinguish broadcast traffic from messages addressed to the connected node. Inbox protocol version 2 carries this metadata; version-1 devices have no route field, so legacy received traffic stays in the channel view rather than being duplicated into a peer thread. This affects presentation only; ACKs and RF routing are unchanged.

### App access

PIN protection is optional, off by default, and configured in Device → This app. Enable it with 4–6 digits, or remove it using the current PIN while retaining all channel keys. Without PIN protection, keys are stored locally without a password and connections require no unlock. When enabled, one app-wide PIN gates device connections, including unencrypted channels; previous key passwords are requested once to preserve and re-encrypt existing keys. **Lock app** on the Device tab clears key access and blocks interaction with the workspace. Disconnect/reconnect and reload require another unlock. Channel editors contain only per-channel privacy/key actions, with no vault controls. The lock is local to this browser origin, not a password on the radio device. See encryption.md for storage, cooldown and short-PIN limitations.

This app includes a confirmed **Erase everything in this browser** action, also reachable from the lock screen without unlocking. It stops open app sessions, clears all namespaced local/session data, then replaces the live app with a static completion page. It does not erase connected device settings or inboxes. Messages still retained on the device may return after reconnect. Tests cover optional PIN transitions, preserved keys/replay state, storage failures, namespace deletion and checkpoint suppression during a wipe.

### Sent history and recovery capacity

Completed messages no longer use unresolved-delivery capacity. The browser retains a rolling 160 outgoing messages across devices/conversations; when full, the next valid send retires the oldest completed entry automatically. Acknowledged, failed, rejected and confirmed transmitted broadcasts are completed. Export history if you need a longer archive.

Up to 32 unresolved messages (including unknown outcomes and unacknowledged unicasts) remain protected from automatic retirement. At that safety limit the composer explicitly asks you to check delivery or intentionally delete an unresolved entry; it never resends or silently loses uncertain work. Request counters continue increasing across retirement and reload. Existing journals load without resetting identities. Journal size is bounded to 1 MiB of serialized characters; unavailable/quota-limited storage still blocks writes safely.

## Bluetooth

USB and Bluetooth reach the same device and share its history. A browser must be paired before **Connect over Bluetooth** works: connect over USB, open Device → Bluetooth and select **Start pairing**, or hold the device's main button for 5 seconds. Pair a phone from the phone, or select **Pair this browser**, then enter the passkey shown there and on the device. Web Bluetooth needs HTTPS or localhost. Chrome and Edge include it, Brave may need it turned on in `brave://flags`, and Safari does not support it. See [Bluetooth link](../reference/bluetooth.md).
