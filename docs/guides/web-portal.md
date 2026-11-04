# Field portal

The web agent lives in `agents/web/`. It uses TypeScript and Vite with native DOM controls plus Leaflet for the map. Protocol/state logic stays in `packages/agent-core/`; the form model only owns drafts and bounded command history. Firmware and wire contracts are unchanged by portal layout work.

```sh
npm ci --ignore-scripts
npm run dev:web
```

Open the printed localhost URL (normally `http://127.0.0.1:5173/`). The server binds to loopback only. `npm run build:web` creates the static agent in ignored `dist/web/`. `npm run check` includes the production build as well as type checks, schema checks, and host tests. Nothing is deployed or published.

## Layout

Dark technical workspace with Messages, Map and Settings navigation. On desktop, conversations have an inbox, a message thread and a compact map panel; at narrower sizes the map gets its own workspace. Mobile opens the inbox, then a conversation with a back action.

- Search channel and peer conversations by name or node ID. Open a channel or a heard device from the list, or a device selected on the map. There is no separate New message form, so direct messages use channel 0 (Public) and its key, and a node that has not been heard cannot be messaged.
- Incoming/outgoing messages share a thread as compact chat bubbles: received on the left (with the sender's name in channels), sent on the right. Under each bubble is the time this browser first saw it (sent: when it was sent) and, for sent messages, a delivery icon: an empty circle while sending, one checked circle once transmitted, two checked circles once delivered (destination ACK or local delivery), a red ! for failed or rejected and a ? for unknown. Hovering an icon gives the full status. Destination ACK means delivered, never read; unknown work is never automatically resent.
- Times are browser-side: the device has no clock, so a message downloaded from the device inbox after reconnecting shows when it reached this browser, not when it was heard on the radio. Messages saved before times were recorded show no time.
- A lock icon marks channels that require encryption, in the conversation list and the conversation header (direct messages show it when their channel requires encryption). Decrypted messages show a small lock; one that could not be read says why.
- Drafts are isolated by transport/device/conversation and retained in this tab across switching/disconnect. Enter sends when allowed; Shift+Enter adds a line. Drafts are not saved across page reload.
- Map shows heard nodes, last-heard age, fixed positions and local or shared map items (see [Map authoring and sharing](#map-authoring-and-sharing)). Selecting a marker selects the device; messaging is an explicit action. Missing/stale observations never imply online status.
- Settings tabs: device, radio, channels, position, discovery, screen, privacy, plugins, storage and diagnostics. There is no change-history page. No firmware changes are needed for this layout.
- The header has one connection button: it connects, cancels while the port chooser is open, and disconnects once connected.

Missing positions are never plotted. Map tiles load from Esri’s dark canvas service and may fail offline; node and message controls remain available. One USB device at a time remains the writer boundary until per-device journaling lands. Use the browser port chooser to pick Heltec or T-Beam.

## Try it without hardware

1. Select **Simulator** and connect, then open Settings → Device with label/region editing. Settings → Channels works too: the simulator stores radio and channel settings without simulating a radio. Messaging, discovery and position stay gated until USB firmware advertises them.
2. Change the device label, then **Save**. The revision advances.
3. Under Settings → Storage, set **Next save** to **Disconnect after commit**, edit the label, and save. The connection closes and the change's outcome becomes unknown.
4. Reconnect. The app queries the device for that outcome without resending the change, and the label shows what the device applied.
5. To see a lost outcome, repeat step 3, then **Reboot simulated device** before reconnecting. The receipt is gone, so the app says the change may not have applied and shows the device's settings.
6. **Lose result and change event** suppresses all replies for the next command, including its retries. After the bounded retry window it becomes unknown and the app queries it. **Read-only on next connect** demonstrates capability-based mutation blocking.

The simulator is shared with host tests under `packages/simulator/`. It uses the same framed/typed protocol and serial adapter as the USB path, but only models in-memory configuration and request retention. Reconnects preserve its state; a page reload resets the simulator and agent history. Reboot preserves simulated config but clears receipts/owner marks and changes boot identity. No flash durability or radio is simulated.

## USB and recovery boundaries

**USB device** uses an explicit browser port chooser. The browser must support Web Serial in a secure context such as localhost. Reaper Mesh firmware is required; the development Heltec and T-Beam are running it. Native Brave USB is physically qualified for the checks below. Firmware installation uses the manifest-validating CLI in flashing-firmware.md.

Device status/capabilities are readable even when writes are blocked. The UI displays the blocking reason, advertised byte limit, region availability, owner admission, receipt/owner capacities, and firmware/radio identifiers. The messaging UI exposes local delivery, bounded outgoing history and received messages; remote sends require live radio readiness.

Drafts are preserved while editing. If the boot, device identity, or revision changes, saving the old draft is blocked until **Load latest** is selected. Pending changes cannot be resubmitted. The portal keeps no visible change history: it releases each settings change from the agent's 32-entry history once its outcome is final, and shows a message if the device rejected it or a conflict loaded newer settings. A change with an unknown outcome is queried once per connection, never resent. It is released when the result arrives, or when the device has rebooted (the receipt is gone); the app then says the change may not have applied, and the settings shown are what the device reports. Changes made through another device stay held until that device reconnects.

Each connection source retains its own agent manager for this page session. Mode switching is disabled during an active connection/open/cleanup. Port-chooser results arriving after cancellation are ignored. Page exit requests disconnect cleanup, but browsers do not guarantee completion during page teardown. USB history/incarnation survives reload in plaintext local storage, with a Web Lock preventing simultaneous writers in this browser bucket. Other browsers/profiles have separate identities. Device owner marks are not silently evicted; exhausted admission is read-only until an explicit device reboot, which loses volatile receipts/queues. Export/query pending history first. The UI must not solve capacity exhaustion by resetting a real device or silently rotating IDs.

## Validation recorded

131 host/cross-language tests, strict TypeScript checks, generated declarations, and the production web build pass locally. Six tests cover the UI draft model and shared simulator, including stale edits, lost results, disconnect recovery, read-only behavior, and history release.

Manual in-app browser QA verified simulator connection, label save/revision update, disconnect-after-commit, reconnect/query recovery, read-only disabled editing, and return to writable mode. No browser console errors were observed. The default narrow viewport rendered the responsive single-column layout. Native USB connection/save/reconnect is now verified as recorded below; browser reload recovery and RF remain unverified.

## Message composer

The public-channel composer accepts up to 1024 UTF-8 bytes and a destination node ID or broadcast. It requires message capability v1 and displays upload/queue/transmit/ACK/failure/unknown separately. Status queries never resend text. Clearing uncertain or active queue history requires explicit abandonment; it does not cancel device work. Until radio integration, queues expire without transmission. The current in-memory config simulator does not advertise messaging, so its composer is disabled; native firmware wire tests cover the actual message engine.

## Inbox, local testing and diagnostics

The integrated firmware supports local delivery by selecting This device. An acknowledged local result explicitly says no radio transmission; the same text appears in Received messages. The agent reads the inbox with independent bounded cursors, displays retention gaps and keeps received history to 32 entries. Live radio probe/effective state and RX/TX counters appear in device details; memory/stack headroom is under Diagnostics. Remote submission is disabled while the radio reports a blocking reason. Configuration and inbox history counters remain independent.

## Reload recovery

USB identity, monotonic request counters and bounded command/message/inbox history are checkpointed before dispatch. Reload restores unfinished work as unknown and never resumes partial sends. Query status after reconnecting to the same device/boot. The recovery panel exports history, retries unavailable storage, or explicitly resets disconnected history. Reset/cleared browser data allocates a new identity and can consume another device owner slot. Invalid saved JSON remains exportable; it is not silently discarded. A second tab is read-only. Native Brave local delivery and both outgoing/inbox retention across reload passed on usb-prototype-4.

## Screen settings

Settings → Screen sets how long the device's own screen stays on (10 s, 30 s, 1 min, 5 min or
never) and whether a new message wakes it. The tab is enabled for firmware that advertises
`screenVersion` 1. Saving uses the same revision-checked configuration and recovery as other
settings; the values are stored on the device and apply with no browser connected. See
[device screen and buttons](../reference/device-display.md#screen-settings).

## Discovery controls

Firmware with discoveryVersion1/nodeCapacity32 exposes Discover on the map toolbar and discovery policy under Manage: independent opt-in beacons/responses, 60–3600-second interval, manual discovery and query-only recovery. Heard nodes show configured name, canonical ID and last-heard age, with Message and Locate actions when a shared fixed position exists. Missing positions are not fabricated. A node list is a bounded observation snapshot, not an online/offline guarantee. Settings use the existing CAS/atomic persistence and survive reconnect. Both firmware policies default off; a peer must have mesh radio mode and responding enabled to answer. The existing one-device browser writer lock remains until per-device portal journaling is implemented.

## Fixed-position controls

locationVersion1 plus the discovery capability exposes device source none/fixed, explicit decimal-degree coordinates and an independent Share position switch under Manage → Position. Coordinates are saved on the device; geographic 0,0 is valid. Saving uses revision-checked atomic configuration and the existing persisted command journal/query-only recovery. Dirty drafts become stale on device/boot/revision changes and require loading current settings. The local fixed position is plotted for the connected device; received shared peer coordinates appear as map markers. Sharing defaults off, stored positions alone never authorize transmission, and other receivers may retain old data. No browser geolocation is requested, and GPS source is not yet implemented. These controls compile and use the physically tested protocol/core; native browser interaction remains unchecked.

## Portal verification / data limits (November 2)

223 host tests and the production build pass. Browser checked at390px and1440px: settings, navigation, offline drafts and conversation switching; no horizontal overflow or observed console errors. No USB/RF regression was repeated for presentation-only changes. The inbox protocol supplies sender/channel but no original destination or timestamp. Channel views therefore show traffic received by this device, including potentially direct traffic; peer views group by sender. No fake sent time/read status is displayed. Cross-direction order after restoring history is reconstructed because the device does not provide a common timestamp/order. All content is rendered as text, including map names/tooltips. Basemap failure keeps local asset/message functions available. GPS remains deferred.

## Message management and unread indicators

The conversation header's three-dot options menu has **Clear chat history**, which removes the conversation's retained messages after confirmation and keeps the channel or direct message in the list; it is unavailable while the chat is empty or uploading. (The earlier Delete chat also hid the conversation, and the Locate device button was removed on November 3; use the map to find a device.) Removal is local to this browser, including other local views of the same received message. It does not cancel queued RF work, change device ACKs, erase a device inbox or remove another user's copy. Clearing also removes sent messages' delivery-query recovery records and frees local upload-history slots. A chat with an active upload cannot be cleared. Received bodies are removed from the local recovery journal; identity-only tombstones suppress device-inbox redownloads. Clearing browser storage removes these tombstones, so retained device messages may return.

Clearing captures the chat's message identities when confirmation opens; new arrivals during confirmation survive. Single-message delete was removed on November 3. Conversations hidden by the earlier Delete chat stay hidden until new traffic arrives or they are opened explicitly.

Unread UI state is separate from delivery state. Unique incoming identities increment inbox-row and navigation badges plus the browser title `(N) Reaper Mesh`. Channel/peer views may show the same incoming message, but the title counts it once. A visible, focused conversation at the bottom marks matching messages read locally; hidden tabs, settings/deletion dialogs, the mobile inbox and reading older messages do not. The new-messages button jumps to the latest messages. Reading sends no read receipt or ACK; there is no mark-all-read action. First installation baselines existing saved history as read; later reloads retain unread state and recognize new messages recovered after reload.

Metadata uses `reaper-mesh.message-ui.v1`, under the existing portal writer lock, separately from transport request counters. Storage failures/read-only tabs disable destructive actions without altering protocol state; malformed saved metadata is preserved. Each record may carry the time this browser first saw the message; records saved before that have none. Bounds are 4096 message identities (sent messages with a time count too)/1024 hidden conversation keys/2MiB; exhaustion fails closed rather than evicting deletions. Local deletion is published only after metadata storage succeeds, then the ordinary history checkpoint removes bodies. A crash between those steps is reconciled on the next render without replaying work.

Verification:232 host tests, generated/type checks and production build pass. An isolated5174 browser origin with synthetic messages verified title/badges, read-on-opening, individual received deletion, reload suppression, conversation removal, and a new arrival reopening the conversation with count1 while earlier deleted messages remain hidden. No user's history, radio settings, firmware or ACK logic was changed for QA. Temporary fixture pages/server were removed. Previews in ignored build/message-management-preview.png and message-unread-preview.png contain only labeled QA messages.
### Channel and direct-message separation

The message inbox has separate Channels and Direct Messages lists. Configured nonempty slots (including Public) always appear as channel rows. Peer conversations remain scoped to their channel ID. Received inbox items use the RF destination to distinguish broadcast traffic from messages addressed to the connected node. Inbox protocol version 2 carries this metadata; version-1 devices have no route field, so legacy received traffic stays in the channel view rather than being duplicated into a peer thread. This affects presentation only; ACKs and RF routing are unchanged.


Channel settings now have their own settings section, separate from radio controls. Channel names remain part of the revision-checked device radio configuration; message privacy and keys remain local to the browser. Password fields are hidden while keys are unlocked. This UI revision has not yet passed browser verification: Windows locked the installed bundler binary during npm ci, leaving dependencies incomplete.

Channels now lists configured channels by name, with capacity-gated **Join channel** and **Create channel** actions and a separate channel editor. A new channel gets a random channel ID; renaming keeps it. **Create invite** in the editor produces an `RMCH1` invite (with the key when the channel is encrypted), and **Join channel** takes one and puts the channel in any free slot with the same ID, refusing a different channel that already uses the name ([channel IDs](../reference/radio-configuration.md#channel-ids), D45). The editor shows the channel ID, not a slot number. **Remove channel** empties the channel's slot on the device after confirmation. Messages still waiting to send are cancelled (`radio-config-changed`), as with any radio change. The channel leaves the conversation list and unread counts while connected, and an open conversation on it moves to Public. Its chat history and key stay in this browser and return on rejoining, which needs an invite. Public is permanent and cannot be removed; **Reset Public** deletes its keys and encryption requirement from this browser, returning it to unencrypted, so encrypted messages saved on it can no longer be read. It leaves chat history alone and is unavailable when there is nothing to reset. Radio saves keep the device's channel table. Channel and radio changes need firmware with channel IDs (`v0.3.0`); earlier firmware stays readable. Naming saves the latest device radio configuration through the existing revision-checked command path; key controls become available once a channel is configured. Settings dialogs are anchored near the top and scroll within the available viewport. Browser verification remains pending.


### App access

PIN protection is optional, off by default, and configured in Settings → Privacy. Enable it with 4–6 digits, or remove it using the current PIN while retaining all channel keys. Without PIN protection, keys are stored locally without a password and connections require no unlock. When enabled, one app-wide PIN gates device connections, including unencrypted channels; previous key passwords are requested once to preserve and re-encrypt existing keys. Lock app clears key access and blocks interaction with the workspace. Disconnect/reconnect and reload require another unlock. Channel editors contain only per-channel privacy/key actions, with no vault controls. The lock is local to this browser origin, not a password on the radio device. See encryption.md for storage, cooldown and short-PIN limitations.

Spacing uses 8/12/16/24/32px tokens, larger form gaps and wrapping action groups. Dialog headers/navigation stay fixed while their bodies scroll at viewport limits. PIN setup and disconnected Settings were visually checked in the in-app browser; PIN cryptography, migration and cooldowns have automated tests. Full physical USB workflows have not been requalified for this change.


Privacy includes a confirmed Wipe local data action, also reachable from the lock screen without unlocking. It stops open app sessions, clears all namespaced local/session data, then replaces the live app with a static completion page. It does not erase connected device settings or inboxes. Messages still retained on the device may return after reconnect. Tests cover optional PIN transitions, preserved keys/replay state, storage failures, namespace deletion and checkpoint suppression during a wipe.

### Sent history and recovery capacity

Completed messages no longer use unresolved-delivery capacity. The browser retains a rolling 160 outgoing messages across devices/conversations; when full, the next valid send retires the oldest completed entry automatically. Acknowledged, failed, rejected and confirmed transmitted broadcasts are completed. Export history if you need a longer archive.

Up to 32 unresolved messages (including unknown outcomes and unacknowledged unicasts) remain protected from automatic retirement. At that safety limit the composer explicitly asks you to check delivery or intentionally delete an unresolved entry; it never resends or silently loses uncertain work. Request counters continue increasing across retirement and reload. Existing journals load without resetting identities. Journal size is bounded to 1 MiB of serialized characters; unavailable/quota-limited storage still blocks writes safely.

Settings use a single scrolling surface: Channels has horizontal channel links with Public selected on entry, and the selected channel’s name/privacy controls appear below. Creating a channel selects its unused slot inline. Coordinates are paired in a two-column form, and shared dropdown indicators, focus styles and help spacing apply throughout the portal.

### Task-first interface review (November 2)

Device setup follows region → name → save, with a content-sized region selector. Channels places Create channel beside its heading and opens the selected channel inline; Public omits the uneditable name field. Routine settings remain directly visible; storage and diagnostics are their own tabs (the Advanced group and change history were removed on November 3). Technical device metadata and key import use optional disclosure. Radio modes describe their effect, discovery explains announcements versus replies, and save/discard actions use consistent labels. Wipe/reset remain explicit and distinct from routine actions.

The review applies familiar navigation, progressive disclosure, clear feedback and form grouping from [NN/g’s Web UX study guide](https://www.nngroup.com/articles/web-ux-study-guide/), plus the supplied Mailchimp, ICS, Erik Kennedy, Codilar and Proteus references. These are design principles, not a claim of formal usability testing or complete accessibility conformance. Firmware/privacy defaults and protocol contracts are unchanged.

The conversation sidebar uses a single scrolling viewport instead of separate half-height channel/direct lists. All / Channels / Direct filters share the same search and show unread counts even for the other category. All groups both categories in the same scroll; filtering does not change the open thread. Selecting a conversation from an asset switches to its category when necessary. Direct rows separate the peer name from the channel/preview to avoid crowding; only unread counts use a trailing badge. Drafts, routing and delivery semantics are unchanged.

## Map authoring and sharing

Map replaces Assets. Click empty map space for Add point here / Draw area from here, or choose Add point / Draw area in the tools. Rectangle drawing uses two opposite corners; Cancel drawing or Escape abandons placement. The editor supports coordinates, type, color, name, note and plugin fields. Save is local and works disconnected. Select or right-click a map annotation for Edit, Share and Delete; the saved-item list exposes equivalent actions for touch/keyboard users. Accepted items can be removed locally or copied under a fresh ID.

Share chooses an existing numeric channel, broadcast or canonical node ID and an item/update or withdrawal operation. It shows actual payload budget and transport state; nothing implies recipient acceptance. Incoming items/updates/withdrawals appear as cards in the appropriate channel or direct message. Cards show name, type, color, note, coordinates and metadata, with Add to map, Update on map or Remove from map. Ignoring a card leaves the map unchanged. There is no map review sidebar, review badge or unapproved map preview. Existing accepted geometry stays until an update/removal is accepted. Use separate map-item/device layer toggles. Settings → Plugins manages definitions; see [plugins.md](plugins.md). Full protocol/limits/qualification are in [map-sharing.md](../reference/map-sharing.md).
