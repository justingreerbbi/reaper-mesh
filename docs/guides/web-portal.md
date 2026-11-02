# Field portal

The web client lives in `clients/web/`. It uses TypeScript and Vite with native DOM controls plus Leaflet for the map. Protocol/state logic stays in `packages/client-core/`; the form model only owns drafts and bounded command history. Firmware and wire contracts are unchanged by portal layout work.

```sh
npm ci --ignore-scripts
npm run dev:web
```

Open the printed localhost URL (normally `http://127.0.0.1:5173/`). The server binds to loopback only. `npm run build:web` creates the static client in ignored `dist/web/`. `npm run check` includes the production build as well as type checks, schema checks, and host tests. Nothing is deployed or published.

## Layout

Dark technical workspace with Messages and Assets navigation. On desktop, conversations have an inbox, a message thread and a compact asset tracker; at narrower sizes the tracker gets its own workspace. Mobile opens the inbox, then a conversation with a back action.

- Search channel and peer conversations by name or node ID; start a recipient from New message or an asset action.
- Incoming/outgoing messages share a thread. Destination ACK means delivered, never read; unknown work has query-only recovery in Message details.
- Drafts are isolated by transport/device/conversation and retained in this tab across switching/disconnect. Enter sends when allowed; Shift+Enter adds a line. Drafts are not saved across page reload.
- Assets shows the map, heard-node list, last-heard age and fixed positions. Selecting a marker selects the asset; messaging is an explicit action. Missing/stale observations never imply online status.
- Settings contains device, radio, position, discovery, command history, recovery and diagnostics. No firmware changes are needed for this layout.

Missing positions are never plotted. Map tiles load from Esri’s dark canvas service and may fail offline; node and message controls remain available. One USB device at a time remains the writer boundary until per-device journaling lands. Use the browser port chooser to pick Heltec or T-Beam.

## Try it without hardware

1. Select **Simulator** and connect, then open Settings → Device with label/region editing; messaging, radio, discovery, and position stay gated until USB firmware advertises them.
2. Change the device label, then **Save**. The revision advances and history shows device acceptance.
3. Set **Next save** under Recovery to **Disconnect after commit**, edit the label, and save. The connection closes and its command becomes unknown.
4. Reconnect and select **Query result** on that command. A retained receipt resolves it without resending the configuration change.
5. **Lose result and change event** suppresses all replies for the next command, including its retries. After the bounded retry window it becomes unknown; result queries still work. **Read-only on next connect** demonstrates capability-based mutation blocking.

The simulator is shared with host tests under `packages/simulator/`. It uses the same framed/typed protocol and serial adapter as the USB path, but only models in-memory configuration and request retention. Reconnects preserve its state; a page reload resets the simulator and client history. Reboot preserves simulated config but clears receipts/owner marks and changes boot identity. No flash durability or radio is simulated.

## USB and recovery boundaries

**USB device** uses an explicit browser port chooser. The browser must support Web Serial in a secure context such as localhost. Reaper Mesh firmware is required; the development Heltec and T-Beam are running it. Native Brave USB is physically qualified for the checks below. Firmware installation uses the manifest-validating CLI in flashing-firmware.md.

Device status/capabilities are readable even when writes are blocked. The UI displays the blocking reason, advertised byte limit, region availability, owner admission, receipt/owner capacities, and firmware/radio identifiers. The messaging UI exposes local delivery, bounded outgoing history and received messages; remote sends require live radio readiness.

Drafts are preserved while editing. If the boot, device identity, or revision changes, saving the old draft is blocked until **Load latest** is selected. Pending changes cannot be resubmitted or cleared. Unknown commands can be queried after synchronization; they are never automatically resent. **Forget uncertain command** explicitly confirms loss of result recovery and does not undo/cancel device work. Clear non-pending history to release the client's 32-entry limit.

Each connection source retains its own client manager for this page session. Mode switching is disabled during an active connection/open/cleanup. Port-chooser results arriving after cancellation are ignored. Page exit requests disconnect cleanup, but browsers do not guarantee completion during page teardown. USB history/incarnation survives reload in plaintext local storage, with a Web Lock preventing simultaneous writers in this browser bucket. Other browsers/profiles have separate identities. Device owner marks are not silently evicted; exhausted admission is read-only until an explicit device reboot, which loses volatile receipts/queues. Export/query pending history first. The UI must not solve capacity exhaustion by resetting a real device or silently rotating IDs.

## Validation recorded

131 host/cross-language tests, strict TypeScript checks, generated declarations, and the production web build pass locally. Six tests cover the UI draft model and shared simulator, including stale edits, lost results, disconnect recovery, read-only behavior, and history release.

Manual in-app browser QA verified simulator connection, label save/revision update, disconnect-after-commit, reconnect/query recovery, read-only disabled editing, and return to writable mode. No browser console errors were observed. The default narrow viewport rendered the responsive single-column layout. Native USB connection/save/reconnect is now verified as recorded below; browser reload recovery and RF remain unverified.

## Message composer

The public-channel composer accepts up to 1024 UTF-8 bytes and a destination node ID or broadcast. It requires message capability v1 and displays upload/queue/transmit/ACK/failure/unknown separately. Status queries never resend text. Clearing uncertain or active queue history requires explicit abandonment; it does not cancel device work. Until radio integration, queues expire without transmission. The current in-memory config simulator does not advertise messaging, so its composer is disabled; native firmware wire tests cover the actual message engine.

## Inbox, local testing and diagnostics

The integrated firmware supports local delivery by selecting This device. An acknowledged local result explicitly says no radio transmission; the same text appears in Received messages. The client reads the inbox with independent bounded cursors, displays retention gaps and keeps received history to 32 entries. Live radio probe/effective state and RX/TX counters appear in device details; memory/stack headroom is under Diagnostics. Remote submission is disabled while the radio reports a blocking reason. Configuration and inbox history counters remain independent.

## Reload recovery

USB identity, monotonic request counters and bounded command/message/inbox history are checkpointed before dispatch. Reload restores unfinished work as unknown and never resumes partial sends. Query status after reconnecting to the same device/boot. The recovery panel exports history, retries unavailable storage, or explicitly resets disconnected history. Reset/cleared browser data allocates a new identity and can consume another device owner slot. Invalid saved JSON remains exportable; it is not silently discarded. A second tab is read-only. Native Brave local delivery and both outgoing/inbox retention across reload passed on usb-prototype-4.

## Discovery controls

Firmware with discoveryVersion1/nodeCapacity32 exposes Discover on the map toolbar and discovery policy under Manage: independent opt-in beacons/responses, 60–3600-second interval, manual discovery and query-only recovery. Heard nodes show configured name, canonical ID and last-heard age, with Message and Locate actions when a shared fixed position exists. Missing positions are not fabricated. A node list is a bounded observation snapshot, not an online/offline guarantee. Settings use the existing CAS/atomic persistence and survive reconnect. Both firmware policies default off; a peer must have mesh radio mode and responding enabled to answer. The existing one-device browser writer lock remains until per-device portal journaling is implemented.

## Fixed-position controls

locationVersion1 plus the discovery capability exposes device source none/fixed, explicit decimal-degree coordinates and an independent Share position switch under Manage → Position. Coordinates are saved on the device; geographic 0,0 is valid. Saving uses revision-checked atomic configuration and the existing persisted command journal/query-only recovery. Dirty drafts become stale on device/boot/revision changes and require loading current settings. The local fixed position is plotted for the connected device; received shared peer coordinates appear as map markers. Sharing defaults off, stored positions alone never authorize transmission, and other receivers may retain old data. No browser geolocation is requested, and GPS source is not yet implemented. These controls compile and use the physically tested protocol/core; native browser interaction remains unchecked.

## Portal verification / data limits (November 2)

223 host tests and the production build pass. Browser checked at390px and1440px: settings, navigation, offline drafts and conversation switching; no horizontal overflow or observed console errors. No USB/RF regression was repeated for presentation-only changes. The inbox protocol supplies sender/channel but no original destination or timestamp. Channel views therefore show traffic received by this device, including potentially direct traffic; peer views group by sender. No fake sent time/read status is displayed. Cross-direction order after restoring history is reconstructed because the device does not provide a common timestamp/order. All content is rendered as text, including map names/tooltips. Basemap failure keeps local asset/message functions available. GPS remains deferred.

## Message management and unread indicators

Each sent/received bubble has a Delete action; Delete chat removes the selected conversation and its retained messages after confirmation. Removal is local to this browser, including other local views of the same received message. It does not cancel queued RF work, change device ACKs, erase a device inbox or remove another user's copy. Sent-message deletion also removes its delivery-query recovery record and frees a local upload-history slot. An active upload cannot be deleted. Received bodies are removed from the local recovery journal; identity-only tombstones suppress device-inbox redownloads. Clearing browser storage removes these tombstones, so retained device messages may return.

Conversation deletion captures the selected message identities when confirmation opens. New arrivals during confirmation survive; new traffic makes a deleted conversation visible again. Discovery alone does not recreate a deleted empty conversation. Starting that conversation explicitly also reopens it. Drafts for the removed conversation are cleared.

Unread UI state is separate from delivery state. Unique incoming identities increment inbox-row and navigation badges plus the browser title `(N) Reaper Mesh`. Channel/peer views may show the same incoming message, but the title counts it once. A visible, focused conversation at the bottom marks matching messages read locally; hidden tabs, settings/deletion dialogs, the mobile inbox and reading older messages do not. The new-message button jumps to the latest messages; the inbox checkmark marks received history read. These actions send no read receipt or ACK. First installation baselines existing saved history as read; later reloads retain unread state and recognize new messages recovered after reload.

Metadata uses `reaper-mesh.message-ui.v1`, under the existing portal writer lock, separately from transport request counters. Storage failures/read-only tabs disable destructive actions without altering protocol state; malformed saved metadata is preserved. Bounds are4096 message identities/1024 hidden conversation keys/2MiB; exhaustion fails closed rather than evicting deletions. Local deletion is published only after metadata storage succeeds, then the ordinary history checkpoint removes bodies. A crash between those steps is reconciled on the next render without replaying work.

Verification:232 host tests, generated/type checks and production build pass. An isolated5174 browser origin with synthetic messages verified title/badges, read-on-opening, individual received deletion, reload suppression, conversation removal, and a new arrival reopening the conversation with count1 while earlier deleted messages remain hidden. No user's history, radio settings, firmware or ACK logic was changed for QA. Temporary fixture pages/server were removed. Previews in ignored build/message-management-preview.png and message-unread-preview.png contain only labeled QA messages.
### Channel and direct-message separation

The message inbox has separate Channels and Direct Messages lists. Configured nonempty slots (including Public) always appear as channel rows. Peer conversations remain scoped to their numeric channel. Received inbox items use the RF destination to distinguish broadcast traffic from messages addressed to the connected node. Inbox protocol version 2 carries this metadata; version-1 devices have no route field, so legacy received traffic stays in the channel view rather than being duplicated into a peer thread. This affects presentation only; ACKs and RF routing are unchanged.
