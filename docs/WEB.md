# Local device console

The first web client lives in `clients/web/`. It uses TypeScript and Vite with native DOM controls, keeping this small console free of a runtime UI framework. Protocol/state logic stays in `packages/client-core/`; the form model only owns drafts and bounded command history.

```sh
npm ci --ignore-scripts
npm run dev:web
```

Open the printed localhost URL (normally `http://127.0.0.1:5173/`). The server binds to loopback only. `npm run build:web` creates the static client in ignored `dist/web/`. `npm run check` now includes the production build as well as type checks, schema checks, and host tests. Nothing is deployed or published.

## Try it without hardware

1. Keep **Simulated Heltec V3** selected and connect.
2. Change the device label, then **Save to device**. The revision advances and the history shows device acceptance.
3. Set **Next save** to **Disconnect after commit**, edit the label, and save. The connection closes and its command becomes unknown.
4. Reconnect and select **Query result** on that command. A retained receipt resolves it without resending the configuration change.
5. **Lose result and change event** suppresses all replies for the next command, including its retries. After the bounded retry window it becomes unknown; result queries still work. **Read-only on next connect** demonstrates capability-based mutation blocking.

The simulator is shared with host tests under `packages/simulator/`. It uses the same framed/typed protocol and serial adapter as the USB path, but only models in-memory configuration and request retention. Reconnects preserve its state; a page reload resets the simulator and client history. Reboot preserves simulated config but clears receipts/owner marks and changes boot identity. No flash durability or radio is simulated.

## USB and recovery boundaries

**USB device** uses an explicit browser port chooser. The browser must support Web Serial in a secure context such as localhost. Reaper Mesh firmware is required; the development Heltec is running it. Native Brave USB is physically qualified for the checks below. Firmware installation uses the manifest-validating CLI in UPDATES.md.

Device status/capabilities are readable even when writes are blocked. The UI displays the blocking reason, advertised byte limit, region availability, owner admission, receipt/owner capacities, and firmware/radio identifiers. The messaging UI exposes local delivery, bounded outgoing history and received messages; remote sends require live radio readiness.

Drafts are preserved while editing. If the boot, device identity, or revision changes, saving the old draft is blocked until **Load latest settings** is selected. Pending changes cannot be resubmitted or cleared. Unknown commands can be queried after synchronization; they are never automatically resent. **Forget uncertain command** explicitly confirms loss of result recovery and does not undo/cancel device work. Clear non-pending history to release the client's 32-entry limit.

Each connection source retains its own client manager for this page session. Mode switching is disabled during an active connection/open/cleanup. Port-chooser results arriving after cancellation are ignored. Page exit requests disconnect cleanup, but browsers do not guarantee completion during page teardown. USB history/incarnation survives reload in plaintext local storage, with a Web Lock preventing simultaneous writers in this browser bucket. Other browsers/profiles have separate identities. Device owner marks are not silently evicted; exhausted admission is read-only until an explicit device reboot, which loses volatile receipts/queues. Export/query pending history first. The UI must not solve capacity exhaustion by resetting a real device or silently rotating IDs.

## Validation recorded

131 host/cross-language tests, strict TypeScript checks, generated declarations, and the production web build pass locally. Six tests cover the UI draft model and shared simulator, including stale edits, lost results, disconnect recovery, read-only behavior, and history release.

Manual in-app browser QA verified simulator connection, label save/revision update, disconnect-after-commit, reconnect/query recovery, read-only disabled editing, and return to writable mode. No browser console errors were observed. The default narrow viewport rendered the responsive single-column layout. Native USB connection/save/reconnect is now verified as recorded below; browser reload recovery and RF remain unverified.

## Browser hardware evidence

November 1, 2026: native Brave Web Serial hardware QA passed against usb-prototype-0 on the Heltec V3. The browser chooser selected CP2102 cu.usbserial-0001; the console reached Connected · synchronized with revision 2. Saving label Reaper Mesh V3 returned Committed on device and revision 3. Explicit disconnect released the port and disabled editing; reconnect through the chooser returned the same label/revision and preserved the page-session command history. The radio remained disabled. Screenshot evidence is local/ignored at build/heltec-v3/browser-usb.png. Physical cable removal, browser reload during an uncertain command, real power loss, display, and RF remain unqualified.

## Message composer

The public-channel composer accepts up to 1024 UTF-8 bytes and a destination node ID or broadcast. It requires message capability v1 and displays upload/queue/transmit/ACK/failure/unknown separately. Status queries never resend text. Clearing uncertain or active queue history requires explicit abandonment; it does not cancel device work. Until radio integration, queues expire without transmission. The current in-memory config simulator does not advertise messaging, so its composer is disabled; native firmware wire tests cover the actual message engine.

## Hardware message acceptance evidence

usb-prototype-2 was installed from commit 443326d (230,960-byte application, SHA-256 5edcc60831f7ecdf2aa1873b3960001c72fe5a3050d8a10d97993a70323a5f87). Esptool verified all artifacts. Physical TS client/adapter testing accepted an exactly 1024-byte message, then observed failed/expired after the RF-disabled queue lifetime. Subsequent opens synchronized at persisted configuration revision 5. Native Brave also queued a multiline message, queried its status, and showed unknown on disconnect without resending it. Local screenshot: build/heltec-v3/browser-message.png. No RF transmission occurred.

## Inbox, local testing and diagnostics

The integrated firmware supports local delivery by selecting Use this device (local test). An acknowledged local result explicitly says no radio transmission; the same text appears in Received messages. The client reads the inbox with independent bounded cursors, displays retention gaps and keeps received history to 32 entries. Live radio probe/effective state and RX/TX counters appear in device details; memory/stack headroom is under Diagnostics. Remote submission is disabled while the radio reports a blocking reason. Configuration and inbox history counters remain independent.

## Reload recovery

USB identity, monotonic request counters and bounded command/message/inbox history are checkpointed before dispatch. Reload restores unfinished work as unknown and never resumes partial sends. Query status after reconnecting to the same device/boot. The recovery panel exports history, retries unavailable storage, or explicitly resets disconnected history. Reset/cleared browser data allocates a new identity and can consume another device owner slot. Invalid saved JSON remains exportable; it is not silently discarded. A second tab is read-only. Native Brave local delivery and both outgoing/inbox retention across reload passed on usb-prototype-4.

## Discovery controls

Firmware with discoveryVersion1/nodeCapacity32 exposes a Who’s listening panel: independent opt-in beacons/responses, 60–3600-second interval, manual discovery and query-only recovery. Heard nodes show configured name, canonical ID and last-heard age, with a Message action. Missing positions are not fabricated; this slice sends no location data. A node list is a bounded observation snapshot, not an online/offline guarantee. Settings use the existing CAS/atomic persistence and survive reconnect. Both firmware policies defaultoff; a peer must have mesh radio mode and responding enabled to answer. The existing one-device browser writer lock remains until per-device portal journaling is implemented.
