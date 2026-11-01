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

**USB device** uses an explicit browser port chooser. The browser must support Web Serial in a secure context such as localhost. Reaper Mesh firmware is required; the attached Heltec's existing firmware cannot yet speak this protocol. The prototype has no installer or flasher. No USB port was opened during development or browser QA.

Device status/capabilities are readable even when writes are blocked. The UI displays the blocking reason, advertised byte limit, region availability, owner admission, receipt/owner capacities, and firmware/radio identifiers. No messaging UI is presented because radio messaging is not implemented.

Drafts are preserved while editing. If the boot, device identity, or revision changes, saving the old draft is blocked until **Load latest settings** is selected. Pending changes cannot be resubmitted or cleared. Unknown commands can be queried after synchronization; they are never automatically resent. **Forget uncertain command** explicitly confirms loss of result recovery and does not undo/cancel device work. Clear non-pending history to release the client's 32-entry limit.

Each connection source retains its own client manager for this page session. Mode switching is disabled during an active connection/open/cleanup. Port-chooser results arriving after cancellation are ignored. Page exit requests disconnect cleanup, but browsers do not guarantee completion during page teardown. History/incarnation recovery across reload, safe owner retirement, and a complete owner-exhaustion recovery flow remain pending. The UI must not solve capacity exhaustion by resetting a real device or silently rotating IDs.

## Validation recorded

131 host/cross-language tests, strict TypeScript checks, generated declarations, and the production web build pass locally. Six tests cover the UI draft model and shared simulator, including stale edits, lost results, disconnect recovery, read-only behavior, and history release.

Manual in-app browser QA verified simulator connection, label save/revision update, disconnect-after-commit, reconnect/query recovery, read-only disabled editing, and return to writable mode. No browser console errors were observed. The default narrow viewport rendered the responsive single-column layout. Native USB connection/save/reconnect is now verified as recorded below; browser reload recovery and RF remain unverified.

## Browser hardware evidence

November 1, 2026: native Brave Web Serial hardware QA passed against usb-prototype-0 on the Heltec V3. The browser chooser selected CP2102 cu.usbserial-0001; the console reached Connected · synchronized with revision 2. Saving label Reaper Mesh V3 returned Committed on device and revision 3. Explicit disconnect released the port and disabled editing; reconnect through the chooser returned the same label/revision and preserved the page-session command history. The radio remained disabled. Screenshot evidence is local/ignored at build/heltec-v3/browser-usb.png. Physical cable removal, browser reload during an uncertain command, real power loss, display, and RF remain unqualified.

## Message composer

The public-channel composer accepts up to 1024 UTF-8 bytes and a destination node ID or broadcast. It requires message capability v1 and displays upload/queue/transmit/ACK/failure/unknown separately. Status queries never resend text. Clearing uncertain or active queue history requires explicit abandonment; it does not cancel device work. Until radio integration, queues expire without transmission. The current in-memory config simulator does not advertise messaging, so its composer is disabled; native firmware wire tests cover the actual message engine.
