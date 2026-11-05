# Changelog and hardware evidence

This is the chronological record of firmware builds and the hardware tests run against
them. It is the single source for dated evidence; the guides and reference specs link here
rather than repeating it.

> [!NOTE]
> All dates are in 2026. "Host tests" qualify logic on a development machine, not radios.
> A passing serial check does not verify visible OLED pixels or real RF behavior unless the
> entry says so. Local screenshots and reports referenced below live under ignored `build/`
> paths and are not committed.

## November 4: trusted-device security approved, radio version 2 codec

The owner approved the [security architecture](../contributing/security-architecture.md) (D50), accepting all six recommendations, and the affected decisions, specification, roadmap and guides now point to it. Existing behavior stands until each step ships.

This adds the first part of step 1: the [radio version 2 contract](../reference/radio-protocol.md#radio-version-2-draft), a `reaper_crypto` interface backed by mbedTLS on boards, and a portable frame codec with key derivation, the ratchet and Open mode. Nothing calls the codec yet, so radios still send version 1 frames and no firmware was installed.

Evidence: `npm run check` passes (332 tests, 9 of them new), the firmware CTest suite passes 97 tests, and `npm run format:check` passes. A separate Node implementation of the contract, using Node's own crypto, produced the frames in the new fixture `packages/protocol/fixtures/frame-v2.json`, and the C++ codec reproduces them. Tests cover a relay forwarding without the team key, team members rejecting a relay-key forgery, every changed bit being rejected except current hops within the limit, all truncations, and invalid fields publishing nothing. A one-off local run of the same scenarios and vectors against the mbedTLS source in the pinned ESP-IDF, built for the host, also passed; CI does not repeat this because it uses test-only host crypto. Both board targets build with the pinned ESP-IDF, with images the same size as before (Heltec 543,488 bytes, T-Beam 519,984 bytes).

Not tested: the codec on a real chip, including hardware AES and SHA and the time they take; any radio transmission; relay; or airtime. The design has had no independent security review.

## November 4: web portal catches up with the mobile app's quality-of-life changes

Keeping the portal in step with the mobile app (D49), this ports what the app gained after the portal's redesign, taken from its latest commit and its uncommitted working copy. A sent message, a direct conversation or a channel can now be deleted, Public excepted, and a heard node or a remembered device can be forgotten. A thread's menu links to channel settings and the map. Smaller changes: connection problems can be dismissed, the pairing steps show only when needed, the node count stops saying "of 32" once past it, the New channel field says when all slots are used, the message-gap notice moves from the thread to Diagnostics, and an old error clears on editing a setting or, for a failed send, on opening another conversation. There is no firmware, wire format or fixture change. New local storage is one key per device, `reaper-mesh.nodes-forgotten.v1.*`.

This also fixes two bugs the app had already fixed. A channel change waited for a lost link to return, so it could appear stuck indefinitely. It also finished before the device's new settings arrived, so anything that ran next read the old channel table.

It also fixes a portal bug from the redesign: a thread's three-dot menu closed on the same click that opened it, so it never appeared. The handler for clicks outside the menu still looked for the wrapper's old class name, `conversation-menu`.

Evidence: `npm run check` passes (323 tests, 7 of them new), including a check that classes the portal looks for around a click exist in the page, and saves against the simulated device over the real codec with the link lost at each point. In the in-app browser, against the simulated device only, at 1280 × 800 and 375 × 812 with no console errors: deleting a sent message; deleting a direct conversation, which stayed gone across a reload and returned holding only a new message; deleting a channel with a broadcast and a direct message on it; the device rejecting that, with the sheet staying open, nothing deleted and a retry working; the link dropping during it; the blocked sheet with no link; a rejoined channel with no old history; forgetting a node, which stayed gone across device reports and a reload and returned on a newer report; the thread menu with real mouse and keyboard input (opening it at both sizes, closing it with Esc, an outside click or the dots, and each item); forgetting a device and dismissing a problem on the connect screen; the pairing steps appearing while a stubbed Bluetooth chooser was open and leaving on cancel; and returning to the list on a narrow screen. The pane was hidden during this, so its timing was not assessed.

Not tested: any real board (USB, Bluetooth or radio), or the browser's real Bluetooth chooser. Nothing was compared side by side with a running copy of the app; the port follows its source code and tests.

## November 4: BLE output recovery and Heltec storage reset (`v0.6.2`)

At the owner's explicit request, addressed the remaining BLE findings and installed
`heltec-reaper-mesh-v0.6.2`, then wiped all device data partitions. Output now reserves space
for two maximum-sized replies before consuming each input byte, so queue congestion cannot
process a request and then silently discard its reply/reset the session. Locally paused input
does not trigger the partial-frame abandonment timer. Permanent notification errors close the
broken transport explicitly; transient allocation/resource errors have a five-second retry
limit. Disconnect, host-reset and notification reason codes are retained on Debug. The address
initialization flag shared between application and Bluetooth tasks is atomic.

Validation: `npm ci --ignore-scripts`, `npm run check` (316 passing tests), standalone CTest
(91 passing tests), and both firmware target builds pass. A recovery regression checks a
partially received frame surviving local output backpressure and completing afterward. Phone
BLE operation and injected physical controller errors remain unqualified; this is not a claim
that every possible disconnect or the earlier suspected reboot has been reproduced and solved.

The manifest-validating updater verified all three firmware image hashes. The subsequent
explicit data reset wrote and hash-verified erased bytes over `0x9000–0xffff` (configuration,
reserved gap and runtime PHY data) and `0x210000–0x217fff` (Bluetooth NVS). No whole-chip erase,
eFuse write or T-Beam install was performed. RAM messages cleared on reset. The firmware and
partition table were preserved. This was a local development build on `983a961` with uncommitted
changes; the manifest and `build/heltec-v3/flash-result.json` record provenance and image hashes.

After reboot, USB inspection confirms firmware `v0.6.2`, configuration revision 0, empty label,
region `UNSET`, radio off, only Public configured, discovery and message wake off, an empty inbox,
and pairing closed with zero bonds. Evidence: ignored
`build/heltec-v0.6.2-wipe-verification.json`. Device setup and BLE pairing must be done again.

## November 4: Heltec battery and BLE congestion fix (`v0.6.1`)

At the owner's direction, implemented and installed `heltec-reaper-mesh-v0.6.1`. The missing
battery indicator now shows calibrated battery-rail voltage and an outline battery icon;
the owner confirms both are visible. The ADC driver handles both V3 gate polarities, polls
at most every two seconds, and shows `?` on failed or implausible readings. Unlike the
T-Beam, Heltec hardware provides neither a fuel-gauge percentage nor a USB-present input.
The display reference documents this hardware difference rather than inventing those states.
Both board builds use the shared screen, settings, messaging, discovery and BLE implementations.
The Debug page adds the processor's reset reason to help distinguish panic, watchdog and power resets.

Fixed a concrete BLE disconnect path: a full input buffer previously set a flag that terminated
the connection as an authentication failure on the next tick. A rejected ATT write now leaves
the connection open and accepts no bytes from that write. Notifications drain between input
batches, and per-tick input work is bounded so a continuously writing client cannot starve the
radio or screen. Security requirements are unchanged. This fixes congestion handling; it does
not establish the cause of the owner's startup-logo reboot report.

Validation: `npm ci --ignore-scripts`, `npm run check` (316 tests), standalone CTest (91 tests),
and both ESP-IDF board builds pass. New host tests cover atomic rejection/retry after buffer
saturation, bounded work and reply draining under continuous input, both ADC polarities,
polling and read failures, unavailable calibration, invalid voltages and voltage/unknown icon
rendering. Host tests do not qualify the physical BLE controller or phone behavior.

Installed the local development build on base commit `68cb40e` with uncommitted changes using
the manifest-validating, NVS-preserving updater. ROM hashes verified all three images; application
SHA-256 is `85f97b1620338e0fca7e1d90b8747efa6c0db289fe128bcc354229a792195828`.
Receipt: ignored `build/heltec-v3/flash-result.json`. No settings, pairing records, partition
boundaries or fixtures were erased or changed. The T-Beam remains on installed `v0.6.0`.

After install, the Heltec reports `v0.6.1`, configuration revision 77, with its low-power mesh
policy and channels intact. Four alternating direct RF deliveries pass: 40 and 1,024 bytes
in each direction against the T-Beam, with destination ACK and exact inbox readback. Both boot
identities remain unchanged during messaging; Heltec free heap stays at 133,968 bytes and its
stack minimum is 15,540 unused bytes. Evidence: ignored
`build/heltec-receive-diagnostic-v0.6.1.json`. Phone BLE after install, meter accuracy,
battery-only power and extended soak remain unverified.

## November 4: Heltec BLE disconnect investigation

The owner reports BLE disconnecting on the Heltec after a send followed by a receive, with
the screen waking and a suspected reboot. The owner subsequently clarified that the logo
appeared on receipt. Code review confirms only screen initialization enters the startup logo
stage; normal incoming-message wake opens the main page. This supports a reboot, but does not
identify its cause. The T-Beam is reported unaffected. The connected
Heltec (`34:b7:da:62:2d:34`, `/dev/cu.usbserial-0001`) passed the pinned esptool's
`verify_flash` comparison of its application at `0x10000` against the recorded clean-commit
`0268691` `heltec-reaper-mesh-v0.6.0` binary (SHA-256
`824028d30ecdaff3669f549fb2265dd737ed489fad5511375b1ce8b3253ebdc7`). This verifies the actual
application bytes, independently of its reported version. No flash write or storage erase was
performed. The comparison resets the board.

Review confirms the Heltec deliberately returns unknown battery state and therefore shows no
battery indicator. Wake on incoming messages is implemented independently of reboot. Neither
observation alone proves a crash. Passive UART capture was started for an owner reproduction;
opening the port produced the expected ROM startup with `rst:0x1 (POWERON)`. That initial reset
is not evidence of the reported messaging failure. No cause or fix is established yet, and
phone BLE messaging remains unqualified. The T-Beam was not connected by USB for the initial
check. A subsequent ten-minute passive capture was started after another reported failure;
at inspection it contained only the reset caused by opening the port, not the reported event.

Validation: `npm ci --ignore-scripts` and `npm run check` pass (309 tests, strict TypeScript,
generated-schema/vendor checks, compiler-backed host tests and the web build). No firmware,
protocol or fixture changes were made.

USB inspection and a local-delivery stress check on the physical Heltec subsequently passed
20 messages (ten 40-byte and ten 1,024-byte bodies), each uploaded, locally delivered and read
back exactly. This replaces entries in the eight-message inbox more than twice and reuses
outgoing message records. The boot identity remained unchanged, free heap stayed at 134,892
bytes, and the task stack high-water mark ended at 15,276 unused bytes. Configuration revision
77 and the existing low-power mesh policy were unchanged. Evidence is in the ignored
`build/heltec-local-diagnostic.json`. This tests queue/inbox handling over USB, not BLE or radio
delivery. All 16 targeted inbox, message-queue and mesh host tests also pass with UBSan. The
two-board radio diagnostic initially could not start because Brave held the T-Beam serial
port; after reconnection and disconnecting the portal, ten alternating radio messages passed.
The eleventh, a Heltec-to-T-Beam 1,024-byte message, transmitted but expired without destination
ACK or inbox publication. Both boards remained responsive with unchanged boot identities and
free heap; no spontaneous reset or panic appeared in captured UART bytes. This is a separate
unresolved RF delivery failure, not evidence of a reboot or a successful 20-message RF test.
Evidence: ignored `build/heltec-receive-diagnostic.json` and `build/diagnostic-uart-*.bin`.

## November 4: web portal follows the mobile app

At the owner's request (D49), the portal now looks like the Reaper Mesh mobile app and supports what it does. It has the app's palette, rail navigation and Comms, Map, Nodes and Device tabs, a connect screen, rejoining on load and reconnecting after a lost link, and brevity phrases. Channels can be created encrypted, shared as a QR code, and joined by camera, image or pasted code. The map adds the crosshair, measuring, two-corner areas, MGRS readout, basemaps and browser location. A device's position can follow this browser. Heard nodes are kept across reconnects. There is no firmware, wire format or fixture change.

This also fixes a bug: the map store rejected saved shared items whose channel number was above 7, which channel IDs (D45) made common, so accepting an item on such a channel would have broken map storage on the next load.

Evidence: `npm run check` passes (309 tests, 13 of them new). Those include a channel code round-tripped through a QR image with the other side decrypting, and the new simulated device over the real codec. In the in-app browser, against that simulated device only, at 1280 × 800 and 375 × 812 with no console errors: connect, rejoin on reload, send and receive, delivery details, accept a shared map item, measure, draw and share an area, basemaps, discovery, settings saves, create a channel, show its QR code, remove the channel, rejoin it by reading that code from an image, rotate and remove keys, encrypted sending, sending blocked with no key, a dropped link reconnecting, PIN lock and unlock, Day theme, and disconnect.

Not tested: any real board with this interface (USB, Bluetooth or radio), the camera scanner, browser location, and scanning codes between a phone and a browser. The app and portal share code formats, but no code has been scanned from one to the other. The local wipe was not run.

## November 4: mobile app guide

[Connect a mobile app](../guides/mobile-apps.md) documents how a mobile app pairs with and talks to a device (D48). Documentation only. Nothing has run on a phone.

## November 4: Bluetooth in the web portal (`v0.6.0`, in development)

At the owner's request (D47), the portal can connect over Web Bluetooth (Device, then USB or Bluetooth
in the header) and Settings → Bluetooth can start pairing, show the passkey and pair this browser. USB
adds `pairingRequest` and `pairingStatus` (feature bit 13), which the firmware accepts only on the USB
link. Two message fixtures were appended deliberately; existing bytes did not change. The stack also
now starts at boot only for an actual stored peer key, because a board with leftover stack records
started it with nothing paired.

Evidence: `npm run check` (296 tests) and the firmware CTest suite (84 tests) pass, including Bluetooth
being refused pairing even as the session's owner, and the Web Bluetooth port against a fake device.
Both boards now run `v0.6.0` from clean commit `0268691`. On an earlier uncommitted build, over USB with the real agent code, each board
reported closed, then open with its name and 116 seconds left after the agent opened pairing, with
no pairings stored. With the Bluetooth stack running, the Heltec had 135 KB of heap free and the
T-Beam 73 KB. In the simulator, Settings → Bluetooth opened pairing, showed a passkey, kept it out of
browser storage and cleared it when closed.

The owner reported that pairing worked from the portal with Web Bluetooth turned on, after a first try
stopped because the browser had Web Bluetooth switched off, and that the portal then connected over
Bluetooth and exchanged messages. This is the owner's report; message size and delivery times were not
recorded.

Read over USB, the Heltec held one pairing before and after installing the clean build, with its
settings kept. The owner then reported the browser reconnecting to it over Bluetooth without a passkey. The owner also reported the Heltec refusing an unpaired phone with the window closed. The T-Beam holds none, so these results are from one board.

Not checked: a wrong passkey, and any effect on LoRa timing. The earlier failed run from
Terminal.app is unexplained.

## November 4: Bluetooth link (`v0.5.0`, in development)

At the owner's request (D47), the firmware gains a [Bluetooth link](../reference/bluetooth.md) for a
future mobile agent. A 5-second button hold opens pairing, a passkey shows on the device screen, and
only bonded, authenticated phones can reach the protocol. The radio protocol, USB schema and stored
settings are unchanged. Both partition tables add an `nvs` partition after the application for
Bluetooth keys, and the updater now expects it. The first T-Beam build hung at startup: Bluetooth
reserves about 56 KB of early memory, which left no block big enough for the 24 KB main stack. The
firmware now runs in its own task. Images are about 530 KB of the 2 MB partition.

During that diagnosis a temporary logging image was written with its bootloader at offset 0 instead
of `0x1000` on the T-Beam, so it did not boot until rewritten at the correct offset. Settings at
`0x9000` were not touched, and the board read back label `T-Beam` in mesh mode afterward.

Evidence: `npm run check` (290 tests) and the firmware CTest suite (83 tests) pass, covering link
routing, the pairing window, trust rules, passkey range, button holds and the pairing screen. The
T-Beam and Heltec run `v0.5.0` from an uncommitted build with USB working and settings kept. With
the Bluetooth stack not started, the T-Beam has 121 KB of heap free and the Heltec 213 KB, and each
has used about 9 KB of its 24 KB stack.

Not checked: Bluetooth has not worked end to end. One run of `tools/hardware-ble-smoke.ts` from
Terminal.app ended without a results file, and the cause is not known yet. Both boards still answered
over USB afterward. Host tests do not qualify pairing or radio coexistence.

## November 4: transmit power levels (`v0.4.0`)

At the owner's request (D46), transmit power is low, medium or high instead of a dBm number, with
medium the default. The Heltec uses −9, +7 and +22 dBm. The T-Beam uses +2, +10 and +17 dBm, and an
optional boost, off by default, raises those to +5, +13 and +20 dBm. Settings → Radio has the new
control, and shows boost only on a board that has it. USB replaces `txPower` with `txLevel` and adds
`txBoost` (feature bits 11 and 12), and storage adds record 7. Stored dBm values load as medium.
Existing message fixtures keep their exact bytes with the field renamed; two fixtures were appended.

Both boards run `v0.4.0` from clean commit `078f9fe`, installed with the ROM updater, and both moved
from their stored dBm value to medium without boost. `tools/hardware-power-smoke.ts` passed on the
bench: direct messages were acknowledged and read from the inbox in both directions at low, medium
and high, then again at each level with boost on the T-Beam (the Heltec stayed at high). The agent
refused boost for the Heltec; the device's own refusal is covered by host tests. Heltec low and T-Beam
high with boost survived a reset, and both boards were restored to medium afterward. `npm run check`
(289 tests) and the firmware CTest suite (78 tests) pass. In the simulator, the portal showed Low,
Medium and High, saved High and hid boost.

Not checked: output power was not measured, so these runs show the radios accept each setting and
still deliver, not that they reach the stated dBm. No range test, and at bench distance a message
getting through says little about the difference between levels. The boost checkbox has not been
clicked in a browser, because the simulator has no boost.

## November 4: map navigation and placement cleanup

Ordinary map clicks now clear device selection without opening the location dialog.
Add point and Draw area explicitly start placement; right-click retains the location
menu. Placement uses a crosshair over Leaflet layers and markers. Fit includes only
visible device and annotation layers. The web portal guide describes these interactions.

Follow-up work implements rectangle drag drawing with a live preview, SVG map symbols,
circular device badges and full-screen mode. Device refresh now preserves the saved-item
map state instead of restoring the empty overlay.

Review with real mouse input then found and fixed: placing a point or area on top of an
existing item opened that item instead (a drag inside an area opened two dialogs); a drag
released outside the map left its preview following the cursor; drawing selected nearby page
text; Escape in a dialog also left
full screen; and the full-screen pane kept its 20 px margin, which pushed the zoom control
past the window edge.

Verification: `npm run check` (289 host tests, none of which exercise map interactions) and
`npm run format:check` pass. In-app browser checks with mouse input cover each fix above,
drag and two-click drawing, and local save. Touch and physical-device workflows remain
unqualified.

## November 3: remove a channel and reset Public

At the owner's request, Settings → Channels can remove a channel from the device. Public is
permanent: it cannot be removed but can be reset, which deletes its chat, keys and encryption
requirement from this browser. Direct messages stay. A removed channel leaves the list and unread counts, an open conversation moves to Public,
and its history and key stay in the browser until it is rejoined by invite. The simulator now stores
radio and channel settings so these controls can be exercised without a board. No firmware,
protocol or storage changes.

Verification: `npm run check` (284 tests) and `npm run format:check` pass. In the in-app browser
against the simulator, clicking through created a channel, created an invite, removed the channel
with its conversation open, rejoined with the same ID, and encrypted then reset Public. With
synthetic messages on a separate empty origin (cleared afterwards), the reset emptied the Public
chat and kept direct messages, and that held after a reload. Between the
boards on `v0.3.0`, `tools/hardware-channel-smoke.ts` passed with a new removal step: after removal
the T-Beam's send on that channel was rejected, a Heltec broadcast on it did not reach the T-Beam's
inbox within 8 seconds, and a direct message on Public was acknowledged. Settings afterwards were
identical to before the run; only revisions advanced (Heltec 52, T-Beam 46). Not checked: these
buttons in a native browser over USB.

## November 3: channel IDs and invites (firmware `v0.3.0`)

At the owner's direction (D45, options 1 and 2, breaking change approved before core v1 under
D42), channels are identified on air by a 32-bit channel ID instead of a slot number, and the
portal shares them with invites.

- **Radio:** the header's existing 4-byte channel field now carries the ID, so the packet layout
  is unchanged. Public is 0; IDs 1–255 are reserved, with 1–7 used for channels converted from
  slot numbers; new channels get random IDs of 256 or more. Devices admit, relay and receive only
  channels in their table.
- **USB:** `channelIdVersion` 1 with feature bit 10 and a `channelIds` field in the radio group.
  The 31 earlier fixtures are unchanged; three are appended.
- **Storage:** record 6 adds the slot IDs; records 1–5 load with slot *k* as ID *k*.
- **Encryption:** the RME2 envelope carries the 4-byte channel ID; RME1 is no longer accepted, so
  encrypted messages saved by earlier builds show as unsupported. Keys belong to a channel ID.
- **Portal:** Settings → Channels has **Join channel** and **Create invite** (`RMCH1`, including
  the key for an encrypted channel). Conversations, the composer and map sharing use channel IDs.
  Radio saves keep the device's channel table; earlier firmware is readable but its channels and
  radio settings are not changed.
- The manifest now lists records 1–6, and the images are renamed `v0.3.0`.

Verification: `npm run check` (282 tests) and `npm run format:check` pass, and CTest passes 76.
New coverage: the channel table rules and record 6 round trip, conversion of earlier records,
rejected tables without writes, the `channelIds` wire field, mesh admission by ID (a node outside
the channel ignores it), RME2 framing on device and agent, invites with keys decrypting on another
agent, and a TypeScript-to-native USB test that joins a random-ID channel in slot 3, reads it back
and has the native session accept a message on that ID and refuse an unknown one.

Hardware: `v0.3.0` was installed on both boards from clean commit `f1ad4ed` with ROM-verified
hashes and NVS preserved (Heltec 287,296-byte app, T-Beam 258,000-byte app). Settings read back
identical at the same revisions (Heltec 46, T-Beam 40), with Camp, Vehicles and Secure converted
to IDs 1, 2 and 3. `tools/hardware-channel-smoke.ts` then passed all 14 checks between the boards
at 2 dBm on a bench, on a random channel ID (`16d55505`) held in slot 4 on the Heltec and slot 7 on
the T-Beam:

- Direct messages on Public and Camp in both directions were acknowledged and read from the inbox.
- A broadcast on a channel the T-Beam had not joined did not reach its inbox within 8 seconds, and
  the T-Beam's own send on it was rejected (`invalid-message`).
- After joining by parsed invite: plaintext direct messages both ways, a plaintext broadcast and
  RME2 encrypted direct messages both ways were delivered, and the encrypted ones decrypted with
  the invite's key. Stored inbox bytes did not contain the plaintext.
- The channel table survived a reset with a new boot identity on both boards, and a direct message
  was acknowledged afterwards.

The first run stopped at its reset step because of a bug in the tool, not the firmware, and left its
test channel on both boards. That also showed the channel persisting across resets on both. The
tool was fixed, the channel removed and the full run repeated. Afterwards both boards' settings
were identical to before the install; only the revisions advanced (Heltec 50, T-Beam 44). Not
checked: the Join channel and Create invite buttons in a native browser, relay through a third
board, range, and mixed firmware versions.

## November 3: chat layout

At the owner's request, the conversation view is more compact:

- Messages are chat bubbles (received left, sent right in the accent color) instead of cards.
- Each message shows the time this browser first saw it, or when it was sent. The device
  has no clock, so inbox messages downloaded later show when they reached the browser.
  Messages saved before this change show no time. Times are stored with the existing
  message-UI records, which still read the earlier three-field rows.
- Sent messages show delivery as circles: empty while sending, one checked circle when
  transmitted, two when delivered, red ! when failed and ? when unknown. The full status is
  in the icon's tooltip. "Received on this channel" and other routine status text are gone.
- A lock marks channels that require encryption, in the list and the header.
- The hints above and inside the message box show only something to act on or a problem
  (connect, unlock, radio unavailable, uploading, errors, messages no longer retained on the
  device). Explanations such as "Destination ACK confirms delivery, not reading" and "Device
  history · received does not mean read" are gone. The header subtitle is gone for channels; a
  direct message shows only the node ID, and only when its title is a name.
- Removed: single-message delete, mark all read, and the message-privacy banner. The header,
  thread padding and composer are smaller, so the thread gets more of a laptop screen.

Verification: `npm run check` and `npm run format:check` passed, including a new message-time
test. Browser QA used synthetic messages on a separate, empty origin (`localhost`, cleared
afterwards): bubbles, sender names, times, all five delivery icons, the lock in the list and
header with Public set to require encryption, and the phone layout with no horizontal scroll.
At 800 × 600 the thread is 452 px tall and the composer 104 px. Real radio traffic was not
used.

## November 3: portal cleanup

At the owner's request:

- Connect and Disconnect are one header button. It reads **Cancel** while the port chooser is
  open.
- Dropdowns and disclosures use one themed chevron instead of the browser's own arrows.
- The change-history page and the Advanced group are gone. Storage and Diagnostics are now
  ordinary Settings tabs. Because the history page held the only Clear button, the portal now
  releases settled settings changes by itself. It reports a rejection or conflict as a
  message. It queries an unknown outcome once per connection and releases it when the device's
  receipt is gone.
- The New message button, its form and the inbox's + button are gone; channels and heard
  devices open from the conversation list or the map. As a result, direct messages always use
  channel 0 (Public) and its key, and an unheard node ID cannot be messaged.
- The conversation header has a three-dot options menu in place of Locate device and Delete
  chat. Its **Clear chat history** removes the chat's messages from this browser but keeps the
  channel or direct message in the list, unlike Delete chat, which also hid it.
- The message box keeps focus after Enter sends a message. It is read-only rather than disabled
  while the device takes the message.
- Removed taglines and filler text: the sidebar "Local by design" block, "Local mesh · no cloud
  account", the overview subtitle and footnote, the page footer and the decorative section
  labels. The page title is now just "Reaper Mesh".

Verification: `npm run check` passed. Simulator QA covered the toggle, 35 consecutive label
saves (past the old 32-entry limit) without blocking, an unknown outcome resolved on reconnect,
an unknown outcome released after a simulated reboot, the settings tabs, both chevrons, the
phone layout, opening a channel from the list without the New message form, and the options
menu opening and closing on Escape or an outside click. Clearing a chat with messages was not
exercised (the simulator has no messaging); it uses the same confirmed local removal as deleting
a single message, without hiding the conversation. Message sending was not exercised (the simulator has no messaging); a browser
check confirmed a read-only box keeps focus while a disabled one loses it. No firmware,
protocol or storage changes.

## November 3: portal workspace redesign

At the owner's request, the portal now opens on a read-only network overview with connection,
selected-device message counts, discovery observations and recent send outcomes. Persistent
navigation separates the overview, conversations and map; settings uses a larger dialog with
section navigation. Connecting preserves the selected workspace.

The original portal stylesheet was replaced, and the interim override stylesheet was removed.
A shared theme defines colors, typography, fields, buttons, focus states and recovery pages.
The new component stylesheet covers message bubbles and delivery states, the composer,
recipient controls, map tools and overlays, all settings sections, plugins and dialogs.
Navigation and empty states use consistent SVG icons. Leaflet's vendor CSS loads before the
application stylesheet so map controls use the application theme.

Verification: `npm ci --ignore-scripts` and `npm run check` passed (276 tests, strict TypeScript,
generated-schema and vendor checks, compiler-backed host tests and the web build). Browser QA
at 1920 × 1080 covered the overview, messages, recipient controls, map, map-item editor,
all primary and advanced settings sections, standalone recovery-page styling (without a wipe),
and simulator connect/save/disconnect. A synthetic
visual fixture checked incoming/outgoing bubbles, delivery labels, shared-item cards and long
identifier wrapping without touching device history. Phone QA at 390 × 844 covered overview,
conversation/back navigation and all primary settings sections without horizontal overflow.
The web build retains its large-bundle warning. No firmware, protocol, storage or compatibility
fixtures changed. No USB or radio hardware tests were performed; populated hardware discovery
and delivery summaries still need device QA. Screenshots and the synthetic fixture are under
ignored `build/web-redesign/`.

## Installed firmware at a glance

| Board | Latest image | Source commit | Notes |
| --- | --- | --- | --- |
| Heltec WiFi LoRa 32 V3 | `usb-prototype-8` | `4209679` | Fixed position; US/915 antenna confirmed |
| LILYGO T-Beam V1.2 | `tbeam-reaper-mesh-v0.2.0` | `bafa382` | Screen settings, battery and plugged-in indicator |

On November 2 both boards were reinstalled from an uncommitted development tree (updater
`--allow-dirty`) for the encryption check, so the Heltec's installed bytes no longer correspond
exactly to commit `4209679`. On November 3 the T-Beam was reinstalled from clean commit
`074f299`, then from clean commits `adc8765` and `bafa382`.

## Heltec V3 firmware progression

| Build | Date | Headline change | Hardware evidence |
| --- | --- | --- | --- |
| `usb-prototype-0` | Nov 1 | First Reaper flash (commit `c41dc6e`) | USB handshake, NVS commit, reconnect, reset with fresh boot identity |
| `usb-prototype-1` | Nov 1 | Best-effort OLED status (commit `5a72fe6`) | Owner confirmed visible OLED; serial opens reached ready ~650 ms |
| `usb-prototype-2` | Nov 1 | Message acceptance (commit `443326d`) | Accepted a 1,024-byte message; expired with RF off; no transmission |
| `usb-prototype-3` | Nov 1 | Radio/channel config | Named-channel queue acceptance and radio-policy quiesce |
| `usb-prototype-4` | Nov 1 | Diagnostics + inbox (commit `6692d12`) | SX1262 probe, RX init, 1,024-byte local delivery/inbox |
| `usb-prototype-5` | Nov 1 | US transmit build | First RF attempt failed closed on the non-DMA 64-byte SPI limit |
| `usb-prototype-6` | Nov 1 | SPI DMA fix (commit `56c8cf0`) | Seven-fragment broadcast `TX_DONE`; unreachable unicast failed without false ACK |
| `usb-prototype-7` | Nov 1 | Discovery v1 (commit `a44319b`) | Two-board discovery; periodic beacon received |
| `usb-prototype-8` | Nov 1 | Fixed position (commit `4209679`) | Synthetic coordinate exchange; reboot persistence |

## T-Beam V1.2 firmware progression

| Build | Date | Headline change | Hardware evidence |
| --- | --- | --- | --- |
| `tbeam-usb-prototype-1` | Nov 1 | First T-Beam image (commit `594bb10`, 237,904-byte app) | AXP2101/SX1276 probe, local delivery, two-board direct RF with destination ACK |
| `tbeam-usb-prototype-2` | Nov 1 | Discovery v1 (commit `a44319b`) | Two-board discovery; periodic beacon sent |
| `tbeam-usb-prototype-3` | Nov 1 | Fixed position (commit `4209679`) | Synthetic coordinate exchange; reboot persistence |
| `tbeam-reaper-mesh-v0.1.0` | Nov 3 | Device screen pages and buttons; new naming (commit `074f299`) | Owner confirmed screen and buttons; USB sync and settings preserved |
| `tbeam-reaper-mesh-v0.2.0` | Nov 3 | Screen settings and battery indicator (commits `adc8765`, then `bafa382`) | Screen settings round trip and reboot persistence over USB; owner confirmed the battery percent and the plugged-in indicator; settings preserved |

## First flash — November 1

First flash used commit `c41dc6e`, USB app SHA-256
`bf2be8a9514df3f463d7edcfe76752d791ec7b871284f7e099d42bbb81cff523`. Esptool verified all
three written artifacts. Physical USB smoke checks passed: handshake/snapshot, NVS
configuration commit, logical reconnect, retained receipt query, serial reopen, and reset
with a fresh boot identity and persisted revision/settings. Opening the CP2102 port reset
the board; immediate negotiation timed out while waiting two seconds succeeded. This led to
the bounded startup-recovery behavior described in the [protocol](../reference/protocol.md).

No display, RF, physical cable-removal, power-cut, or long-duration qualification was claimed.
Full detail is in the [first-flash walkthrough](../guides/first-flash.md).

## USB startup recovery

The agent repeats the same `hello` at most once per 500 ms while negotiating, without
extending the five-second deadline. Retries do not accumulate behind queued writes, and no
configuration mutation is replayed. The TypeScript `Connection` reached ready on three
consecutive physical serial opens in 647/646/650 ms over a Python byte bridge, with
persisted revision 2 unchanged. Extended to the real `SerialAdapter` over Web Streams:
three opens in 626/645/648 ms.

## Browser hardware QA — November 1

Native Brave Web Serial QA passed against `usb-prototype-0`. The chooser selected CP2102
`cu.usbserial-0001`; the console reached *Connected · synchronized* at revision 2. Saving
label *Reaper Mesh V3* returned *Committed on device* and revision 3. Explicit disconnect
released the port and disabled editing; reconnect returned the same label/revision and
preserved page-session command history. The radio stayed disabled. Physical cable removal,
reload during an uncertain command, power loss, display, and RF remained unqualified.

## OLED status — November 1

OLED status is implemented for the Heltec V3 SSD1306 (SDA 17 / SCL 18, reset 21, active-low
Vext 36, address `0x3c`). A first-party driver and font use a fixed 1,025-byte transfer
buffer, 400 kHz I2C, a 40 ms per-transfer timeout, and redraw-on-change at most twice per
second. An init/transfer failure disables further display updates without blocking USB.
Rows show firmware ID, logical USB `READY`/`IDLE`, persisted revision or `UNKNOWN`,
`STORE OK`/`FAULT`, and `RADIO OFF`. `READY` requires synchronized state and a reply within
eight seconds; it is not physical cable detection. The owner confirmed OLED rendering works
on the installed hardware.

## Configuration recovery — November 1

Physical fault-injection passed: a lost committed reply recovered by query; a duplicate
replay did not produce a second revision; a reset preserved config with the previous boot's
outcome left uncertain. Reproduced by `tools/hardware-recovery-smoke.ts`.

## Message and mesh checkpoint — November 1

`usb-prototype-2` accepted an exactly 1,024-byte message, then reported *failed/expired*
after the RF-disabled queue lifetime. Native Brave queued a multiline message, queried it,
and showed *unknown* on disconnect without resending. The C++ radio codec and mesh core pass
host topology/fault tests. `usb-prototype-3` added named-channel acceptance and radio-policy
quiesce; a power change caused `radio-config-changed`, and the agent preserved accepted
messages during config resync. No RF transmission occurred in either.

## Integrated board and browser recovery — November 1

`usb-prototype-4` (commit `6692d12`, 267,632-byte app): three serial opens reached ready in
665/662/668 ms; the SX1262 probe succeeded; receive-only initialized then restored off;
three 1,024-byte local sends were acknowledged and retrieved from the inbox. TX stayed zero;
revision 14 persisted; free heap 274,496 bytes, minimum free main stack 17,260 bytes.

The browser now journals USB identity, counters, command outcomes, message bodies, and inbox
to `localStorage` before mutation dispatch, behind a Web Lock (one writer per storage
bucket). Reload converts unfinished work to *unknown* and never replays uploads. Native Brave
delivered a multiline local message, reloaded, and retained both acknowledged outgoing and
received entries.

## Updater qualification — November 1

The manifest-validating updater (`tools/update-firmware.py`) passed seven host test groups
and physically reinstalled `usb-prototype-4` from its clean build; ROM verified three images
and three reconnects reached ready in 649/648/643 ms with revision 14 preserved. The owner
confirmed the US/915 MHz antenna is attached, clearing the board antenna gate.

## First RF and the SPI correction — November 1

`usb-prototype-5` installed with verified hashes, but the first maximum-message TX attempt
failed closed with `radio-driver-fault`; off policy was restored. The pinned ESP-IDF source
confirmed non-DMA SPI is limited to 64 bytes even when `max_transfer_sz` requests more.
`usb-prototype-6` enables SPI DMA, aligns persistent transfer buffers, and checks the actual
host maximum at startup before claiming a probe.

## Single-board RF qualification — November 1

`usb-prototype-6` (commit `56c8cf0`): a 1,024-byte broadcast completed seven fragment
`TX_DONE` events; an unreachable unicast made three transmissions then failed, never claiming
acknowledgment (TX counter reached 10). Off policy was restored and three opens reached ready
in 648/644/647 ms at revision 20. The owner then selected mesh mode in the browser and sent
tests; final observed state was revision 21, probe OK, ready, TX 1, local delivery. A review
also fixed confirmed broadcasts degrading to *unknown* while waiting for a nonexistent ACK;
confirmed broadcast transmission is now terminal. Package SHA-256
`0a6dbc4121b3295f08d1f8ddfd8065feeb1f55f53091a9f0bed34a68c27327a6`.

> [!WARNING]
> `TX_DONE` and local inbox delivery do **not** prove a remote receiver or relay works.
> That required a second board.

## T-Beam V1.2 added — November 1

The owner added a US/915 T-Beam V1.2 (ESP32-D0WDQ6-V3 rev 3.1, Winbond 4 MB, MAC
`08:b6:1f:9f:e5:48`, port `/dev/cu.wchusbserial57700003341`). `tbeam-usb-prototype-1`
(commit `594bb10`) validated AXP2101 identification and the SX1276 register configuration.
Three local opens reached ready in 671/669/670 ms, each delivering/retrieving 1,024 bytes
with TX zero; free heap 201,748 bytes, minimum free main stack 17,484 bytes. An initial
first-write auxiliary-read interruption recovered on reconnect at committed revision 1 with
no replay — retained as a soak/interruption observation.

RF test: seven 1,024-byte broadcast fragments reached `TX_DONE`, then three unreachable
unicast transmissions failed with no false ACK. Node ID `node-000008b61f9fe548` is already
compatible with the installed Heltec protocol.

## Two-board direct delivery — November 1

`tools/hardware-pair-smoke.ts` operated both real adapters simultaneously: 1,024 bytes
Heltec → T-Beam and T-Beam → Heltec each received a **destination ACK** and the exact inbox
body, once per message identity. Original settings were restored afterward. Final read-only
check: Heltec `usb-prototype-6`/revision 21 stayed mesh/2 dBm; T-Beam
`tbeam-usb-prototype-1`/revision 7 restored off/2 dBm. T-Beam package SHA-256
`3a79222f814d1aebf8c5b4551f5f45d116b844e20c15ab7b299aef5f3ea57242`.

This is actual two-node RF evidence — not relay, range, or coexistence qualification.

## Discovery v1 — November 1

Both discovery builds from commit `a44319b` installed: Heltec `usb-prototype-7` (274,256-byte
app) and T-Beam `tbeam-usb-prototype-2` (244,416). Manual discovery verified zero replies when
disabled, one reply each direction when enabled, and matching configured node names. A
60-second periodic beacon was received without a manual query or any response TX. Bidirectional
1,024-byte text/ACK/inbox regression passed. No location was transmitted. Opt-in flags were
restored false, interval 300; final Heltec revision 28 mesh, T-Beam revision 17 off. 210 host
tests and 64 CTests pass. The T-Beam serial driver needed a USB reconnect before installation;
failed preflight attempts wrote nothing.

Resource headroom: Heltec free heap 260,592 / minimum free main stack 16,892 bytes; T-Beam
187,924 / 17,116 bytes. The frozen node snapshot trades a bounded RAM increase for paging that
cannot be starved by incoming reports. Reproduce with
`tools/hardware-discovery-smoke.ts PYTHON HELTEC_PORT TBEAM_PORT` (add `--beacon-only` for the
timed beacon test); it restores original settings. Local reports:
`build/tbeam-v12/discovery-smoke.json`, `beacon-smoke.json`, `discovery-final-state.json`. The
new browser controls were not manually desktop-tested.

## Fixed position — November 1

Heltec `usb-prototype-8` and T-Beam `tbeam-usb-prototype-3` from clean source
`420967909bb4693746620b76ca2d88ef7d0e4eb3` (app sizes 275,712 / 245,856 bytes). ROM verified
all images; NVS preserved. Heltec's first application write stopped responding at 70%;
re-running the exact validated updater completed successfully — one observed recovery, not
power-cut qualification.

Two-board tests received exact synthetic fixed coordinates in each direction (geographic 0,0
and −90,180), one response per request. Disabling sharing produced identity-only responses and
cleared the latest node position. `tools/hardware-position-persistence.ts` verified the saved
`record4` position across a different boot with sharing false throughout. Mixed old/new and
new/new firmware pairs retained 1,024-byte text/ACK/inbox behavior. Resource headroom: Heltec
free heap 259,064 / min stack 16,692 bytes; T-Beam 186,396 / 16,916 bytes. Final revisions
38/32. 220 host tests and 67 CTests pass. An extended run hit a T-Beam node-snapshot read
timeout before its reboot step; fresh sessions recovered, and a deterministic
reconnect-after-node-read-exhaustion regression was added.

Before the T-Beam was upgraded, the new Heltec 8 and older T-Beam 2 exchanged exact 1,024-byte
messages with destination ACKs in both directions; the regression passed again after both
upgrades. The test harness previously aborted settings restoration on an unrelated node-read
error; restoration now waits on configuration independently, and a repeated coordinate/privacy
run passed. Final owner policies: both boards mesh/2 dBm; Heltec beacon/respond off; T-Beam
beacon/respond on; interval 300 s; position source none and sharing off on both. Reproduce with
`tools/hardware-position-smoke.ts PYTHON HELTEC_PORT TBEAM_PORT`. Local reports:
`build/tbeam-v12/position-smoke.json`, `position-persistence.json`,
`position-mixed-pair-smoke.json`, `pair-smoke.json`.

## Field portal redesign — November 2

The owner replaced the earlier light/map-first portal with a dark, Signal-style messaging
workspace. GPS was explicitly deferred. The portal gained searchable channel/peer
conversations, unified delivery-state bubbles, per-transport/device/conversation drafts,
Enter/Shift+Enter composition, received-history filtering, and a separate asset workspace.
223 host tests and the production build pass; the browser was checked at 390 px and 1440 px
with no horizontal overflow or console errors. No USB/RF retest was part of this UI work.

## Message management and unread UX — November 2

Added local delete for sent/received messages, *Delete chat* with confirmation, persistent
deletion tombstones, conversation hide/reopen on new traffic, per-thread and navigation
unread counts, and a browser title `(N)`. Read state is local UX only; ACKs, firmware, and
wire schemas are unchanged. Metadata lives in `reaper-mesh.message-ui.v1`
(bounds 4,096 IDs / 1,024 conversations / 2 MiB). 232 host tests and the web build pass.

Inbox protocol v2 then added the original RF destination so broadcasts stay in channel
threads and addressed messages appear only in peer threads. Version-1 firmware remains
readable but, lacking route metadata, shows incoming messages in the channel only. 234 host
tests and the build pass; no hardware retest was part of this correction.

## Phase 3 encryption — November 2

Browser-side XChaCha20-Poly1305 channel envelopes, an Argon2id-wrapped local vault, `RMKEY1`
manual key transfer, a local require-encryption policy, ciphertext-only firmware transport,
and ciphertext RACE recovery are implemented. `npm run check` passes 240 tests and both
target builds pass. Live Heltec V3 ↔ T-Beam V1.2 encrypted direct messages passed in both
directions with ACK, exact ciphertext retention, matching-key decrypt, and unrelated-key
rejection. Both boards were installed from a development tree via `--allow-dirty`; the smoke
report is `build/tbeam-v12/encryption-smoke.json`.

> [!WARNING]
> Direct routes use the channel **group** key — this is not pairwise-private messaging. Any
> group member can forge messages, and there is no forward secrecy. Reconnect/reboot during
> an uncertain encrypted upload, key rotation over radio, and relay remain unqualified. See
> [Channel encryption](../guides/encryption.md).

## Browser PIN and local wipe — November 2

The per-key vault screen was replaced by an optional, browser-only, app-wide PIN (4–6 digits,
off by default). One unlock opens every channel key; *Lock app*, disconnect and reload clear
key access. Keys stay Argon2id-wrapped with a persisted failed-attempt cooldown; existing key
records migrate without losing key epochs or replay records. Settings → Privacy and the lock
screen offer a typed-`WIPE` local reset that coordinates with other tabs and the writer lock.
The PIN does not authenticate a device, and short PINs can be guessed offline. No firmware or
wire schema changed. Checked with type checks, 166 non-compiler agent tests and the web build
on a Windows host, where the full `npm run check` could not run (CRLF generated-file comparison,
no C++ compiler). No hardware retest.

## Agent terminology — November 2

Software connected to a node is now called an **agent** everywhere: `agents/web/`,
`packages/agent-core/`, `tools/hardware-agent-smoke.ts`. Wire fixtures, storage keys and
persisted identities are unchanged. `npm ci --ignore-scripts` and `npm run check` pass on macOS.

## Sent history separated from recovery admission — November 2

Completed outgoing messages no longer use up the 32-entry recovery admission budget. The
browser keeps a rolling 160-entry outgoing history and retires the oldest completed record when
a new send needs space; unknown or unacknowledged unicast outcomes are never retired. The
journal is bounded at 1 MiB of serialized characters, and older journals remain readable. A
regression exercises 500 completed sends with reload and counter continuity. No firmware or
wire change.

## Task-first settings layout — November 2

Settings were reordered for mixed technical experience: routine setup first, maintenance under
*Advanced*, short contextual explanations and primary actions next to their sections. No
protocol or hardware change.

## Map workspace, shared map items and JSON plugins — November 2–3

The Map workspace replaced Assets. Users can add, edit and delete local points and rectangles,
and share them as validated `RMAP1` JSON inside ordinary text messages (1,024 bytes plaintext,
950 bytes encrypted). Recipients review shared items on message cards (*Add/Update/Remove from
map*); accepted items live in separate storage with revision barriers, so deleting message
history does not remove them. Settings → Plugins installs declarative, browser-local JSON
definitions that add map item types and settings; no plugin code runs. No firmware or transport
change. Host, native-USB and isolated-browser checks only; no RF or remote-acceptance testing.
See [Shared map items](../reference/map-sharing.md) and [Plugins](../guides/plugins.md).

## Device screen and buttons — November 3

`tbeam-reaper-mesh-v0.1.0` from clean commit `074f299` (255,408-byte app, SHA-256
`20147f967851f2e488d75097a7b1e4fffa99d14d5f946245b27b491f59da1e04`). The updater validated
and installed it with ROM-verified hashes and NVS preserved. Three USB opens reached ready in
655/671/648 ms at configuration revision 35, unchanged from before the update, and the welcome
message reported the new firmware name. The owner confirmed on the device: startup icon and
title, main page (name, radio state, counts, version), nodes and debug pages, single, double and
long presses on the middle button, the PWR page shortcut and the 30-second screen timeout.

The screen code is shared, so `heltec-reaper-mesh-v0.1.0` also builds without warnings, but it
has not been installed or checked on the Heltec. Host checks: 267 tests and 72 CTests pass,
including new gesture, screen-state, unread-count and page-rendering tests. Firmware IDs now use
a `version` field kind that allows `.`; wire bytes and frozen fixtures are unchanged. See
[device screen and buttons](../reference/device-display.md).

## Screen settings and battery indicator — November 3

`tbeam-reaper-mesh-v0.2.0` from clean commit `adc8765` (256,640-byte app, SHA-256
`dca4200abb8420f6dadfa62686849d58e1ae34815e6608edc57436c2feab462f`). The updater validated
and installed it with ROM-verified hashes and NVS preserved. Three USB opens reached ready in
655/645/647 ms at configuration revision 35, read from the existing record 4, and the welcome
reported `screenVersion` 1. Over USB with the real TypeScript agent, screen settings were saved
(revision 36, 5 minutes with wake on), read back on a new connection with label, radio, position
and discovery settings unchanged, saved again (revision 38, 1 minute with wake on) and read back
after a reset with a new boot identity. The defaults (30 s, wake off) were then restored at
revision 39.

The owner then confirmed the battery percent shows with a battery fitted, and reported that the
corner was empty when plugged in with no battery. The plugged-in state must show even then, so
the bolt was changed to mean "plugged in" (AXP2101 VBUS good, read only) and the no-battery
state shows the bolt and `USB`. That image, still `tbeam-reaper-mesh-v0.2.0`, was installed
from clean commit `bafa382` (256,640-byte app, SHA-256
`1203aeecdac1baa9ebbd836f2469a3f980111f4fa9309653469c4347fa5b2f72`) with ROM-verified hashes
and NVS preserved. Three USB opens reached ready in 649/648/672 ms at revision 39 with the
screen settings unchanged. The owner confirmed the bolt and `USB` show when plugged in with no
battery. Not yet checked: a changed timeout and wake-on-message on the physical screen, and the
portal's Screen tab in a native browser.

`heltec-reaper-mesh-v0.2.0` was installed on the Heltec from clean commit `cc28285` (285,968-byte
app, SHA-256 `30ff5fd6c4c676e144670f9ae76d3a6f0f87c70add251f448b04dbfd1c330cee`) with
ROM-verified hashes and NVS preserved; it reported `screenVersion` 1 at revision 44. Screen
settings were saved (revision 45, 10 s with wake on) and read back after a reset with a new boot
identity, with other settings unchanged. The owner confirmed the screen turned off after 10 s and
woke on a message from the T-Beam. That commit also makes build manifests list config record 5,
which v0.2.0 reads and writes. Still not checked: the portal's Screen tab in a native browser,
and the Heltec's startup, pages and gestures. Host checks: 276
tests and 75 CTests pass, including record 5, screen-setting, TS-to-native USB, wake and
battery-drawing tests. The 28 earlier fixtures are unchanged; three are appended. See
[device screen and buttons](../reference/device-display.md).
