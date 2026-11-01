# Web Serial adapter

`packages/client-core/serial.ts` connects the existing `Connection` byte/state layer to a structurally compatible Web Serial port. It does not select ports, request permissions, toggle DTR/RTS, reset a device, reconnect automatically, or flash firmware. The local browser console is documented in docs/WEB.md.

The UI must feature-detect `navigator.serial`, request a port from a user gesture, and pass that port to `SerialAdapter.connect(port, crypto.randomUUID(), baudRate)`. Port selection is browser-managed and requires a supported secure context. See [Chrome's Web Serial documentation](https://developer.chrome.com/docs/capabilities/serial) for permission, stream locking, and close behavior. The default 115,200 baud is a proposed Reaper Mesh setting, now verified for the installed Reaper USB prototype.

## Behavior

- `connect()` resolves after opening the port and starting I/O; it does not mean the protocol is ready. Observe `connection.sync.state` for negotiation, synchronization, and readiness.
- Opening requests a 4,096-byte serial buffer with no hardware flow control. Input chunks above 65,536 bytes are rejected as an additional guard for custom adapters. The protocol decoder itself has a fixed-size frame buffer.
- The default scheduler ticks every 100 ms using integer `performance.now()` time. A supplied clock and scheduler make host race tests deterministic. Browser timer suspension or background throttling can cause timeout; explicit reopen/resync is the recovery path.
- One read loop and one serialized write loop run per connection. The writer awaits every write; at most one drained batch of up to eight frames is held outside the connection's bounded queue. There is no unbounded promise chain or parallel frame writing.
- Read errors, EOF, write errors, removal events, incompatible protocol, or connection timeout invalidate the generation immediately and start cleanup. Any already submitted write can have reached the device; cleanup does not prove cancellation of device work. No remaining old batch writes are submitted after invalidation.
- Explicit `disconnect()` is idempotent for a run and awaits cleanup. Cleanup first waits for any pending port open, cancels the reader and aborts the writer, waits for loops to finish, releases locks, and closes an acquired port. New `connect()` calls are rejected until this finishes.
- Web Serial provides no cancellation of a pending `open()`. An indefinitely stalled native open/write/cancel/close can leave cleanup pending. The adapter keeps ownership blocked in that case. It does not pretend a JavaScript timeout released native resources.
- A failed native close/lock release records `cleanupError` and keeps the adapter blocked. A stream-cancellation rejection is also reported even if the port subsequently closes. UI diagnostics and a manual browser/port recovery flow remain to be designed.
- The supplied `Connection` is owned exclusively by the adapter while active. Consumers may inspect it but must not call its lifecycle methods or drain writes themselves.

## Evidence and limits

Host tests use standard ReadableStream/WritableStream implementations with simulated serial ports. They exercise handshake/snapshot dispatch, pending-open cancellation, open failure, read failure, EOF/removal, write failure, stalled writes during close, timeout cleanup, missing streams, close failure, and reopen without old-frame replay. These establish host lifecycle semantics, not browser/USB driver or board behavior. A separately documented physical Python peer now passes USB/NVS smoke tests on the installed image; the actual browser adapter remains unqualified. Opening the observed CP2102 port reset the board, so initial hello loss during boot needs bounded negotiation recovery. The portable C++ protocol component is documented in firmware/README.md.

Configuration commands now use `adapter.configure(config)`; read their status through `adapter.connection.commands.status(id)`. After reconnecting and reaching readiness, use `adapter.recover(id)` for query-only recovery. `adapter.connection.forget(id)` explicitly releases non-pending client history. Results trigger snapshot reconciliation when appropriate; no mutation is automatically replayed into a new link.

Full-stack simulated USB tests cover lost events/results, duplicate-safe retries, query-only recovery, reboot ambiguity, device identity mismatch, revision conflicts, invalid config, receipt eviction, and continued sequential use past history capacity. Static checks/CI configuration and capability negotiation are implemented. The UI can inspect `connection.writeBlockReason` and `connection.capabilities` before enabling mutations. Next add owner-retirement/recovery UX, browser automation, target integration of the generated embedded codec, and page-reload history recovery. The web UI has been manually verified in simulation; see docs/WEB.md. Verify the actual hardware and firmware before physical protocol testing.

## USB reset during port open

USB startup recovery is implemented: repeat the same hello at most once per 500 ms while negotiating, without extending the five-second deadline. Retries do not accumulate behind queued writes; welcome retires any unsent hello. No configuration mutation is replayed. All 131 host tests and the web build pass. The actual TypeScript Connection reached ready on three consecutive physical serial opens in 647/646/650 ms using a Python byte bridge, with persisted revision 2 unchanged. This qualifies the client protocol startup path; browser permission/stream behavior remains unverified on hardware.

The physical check was also extended to the real SerialAdapter using standard Web Streams over the Python serial byte bridge. Three consecutive opens reached ready in 626/645/648 ms, with revision 2 unchanged. Native browser permission, chooser, and browser-specific stream behavior remain pending.

## Browser hardware evidence

November 1, 2026: native Brave Web Serial hardware QA passed against usb-prototype-0 on the Heltec V3. The browser chooser selected CP2102 cu.usbserial-0001; the console reached Connected · synchronized with revision 2. Saving label Reaper Mesh V3 returned Committed on device and revision 3. Explicit disconnect released the port and disabled editing; reconnect through the chooser returned the same label/revision and preserved the page-session command history. The radio remained disabled. Screenshot evidence is local/ignored at build/heltec-v3/browser-usb.png. Physical cable removal, browser reload during an uncertain command, real power loss, display, and RF remain unqualified.
