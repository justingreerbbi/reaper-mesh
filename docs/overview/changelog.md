# Changelog

What changed in each release, newest first. Firmware images are named
`{board}-reaper-mesh-v{version}`, for example `heltec-reaper-mesh-v0.11.1` (decision D8). Web
portal changes are listed with the firmware they shipped alongside.

Before core v1, a release can break compatibility with earlier builds when the owner approves
it (D42). Releases that need both boards updated together are marked **Breaking**.

> [!NOTE]
> Detailed hardware test logs for every entry up to November 7, 2026 (image hashes, timings,
> commands run and what was not tested) are kept in Git history:
> `git show a3c8a16:docs/overview/changelog.md`. New entries record a short summary here and
> put detailed evidence in the pull request.

## How to add an entry

Add a section at the top with the version and date, then three short parts: what changed,
what was verified on hardware, and what was not. Link the decision (`Dnn`) when there is one.

---

## Unreleased

- **Added:** signals intelligence, step 2 (D61). Each signal gets a best guess of what it is and who
  made it, with a confidence and the reasons. The guess uses:
  - a maker database built from the IEEE registries and Nordic's Bluetooth numbers, served with the
    portal and refreshed when online;
  - Bluetooth data, services and names;
  - the user's corrections, optionally applied by name.

  Optional WiGLE lookups with the user's own key place Wi-Fi networks on the radar. New:
  `tools/build-signals-reference.ts`, and a Signals card in This app. **Verified:** host tests; the
  tab in a browser with the simulated add-on. **Not verified:** a real WiGLE lookup, the real
  add-on, the desktop app.
- **Added:** signals intelligence, step 1 (D61). The Signals tab gains:
  - a radar around the user, where each point shows how it was placed (reported, estimated from
    the user's movement, or distance only);
  - a detail panel with history, places, telemetry, and the user's name, note, tags and watch flag;
  - filters, and a history of every signal kept in IndexedDB (deleted by the local wipe);
  - CSV export of the shown signals.

  **Verified:** host tests; the tab in a browser with the simulated add-on, with notes surviving a
  reload. **Not verified:** the movement estimate with a real moving position, the real add-on, the
  desktop app, a phone layout.
- **Added:** more of the Signals tab (D60): a remembered add-on reconnects on load and when plugged
  back in; **Details** on each row (first and last heard, signal range, Bluetooth services, a drone's
  positions); CSV **Export** of the list on screen; a count of recent drones on the **Signals**
  button and a notification for a new drone while the portal is out of sight. **Verified:** host
  tests; the tab in a browser with the simulated add-on. **Not verified:** reconnecting the real
  add-on, drone notifications from a real transmitter, the desktop app.
- **Added:** the signals add-on, phase 2 (D60):
  - firmware for the XIAO ESP32-C5 (`xiaoc5-reaper-sensor-v0.1.0`), with its parsers, tables,
    scheduler and session in a portable core (`firmware/components/reaper_sensor/`);
  - the agent's sensor session and store;
  - the portal's **Signals** tab (drones, Wi-Fi, Bluetooth and searching devices, a scan plan, and
    drones and their operators on the map), a "Connect signals add-on" button on the connect screen,
    and a simulated add-on.

  Frames now start with a delimiter as well as ending with one. **Verified:** host tests; the
  firmware on the owner's C5 over USB with a scripted host using the agent's codec (real Wi-Fi and
  Bluetooth reports, a 60-second session with no gaps or drops); the Signals tab in a browser with
  the simulated add-on. **Not verified:** the portal with the real add-on, Remote ID and long-range
  Bluetooth from a real transmitter, the desktop app. No node firmware change.
- **Added:** a listen-only Phase 0 bench spike for the XIAO ESP32-C5 signals add-on (D60), in
  `firmware/spikes/xiao-c5-phase0/`. **Verified on the owner's board:** the pinned ESP-IDF v5.5.4
  runs on the C5; Wi-Fi listening works on 2.4 and 5 GHz, including the radar band; Bluetooth LE 1M
  scanning works; a full-duty Bluetooth scan stops Wi-Fi listening entirely; opening the USB port
  resets the board; and a USB-only console hangs the boot, so the console stays on UART0, whose pins
  clash with the planned link pins. **Not verified:** long-range Bluetooth, Remote ID, current draw
  and the Heltec's 5V pin on battery. No node firmware or portal change.
- **Added:** the signals add-on's [sensor protocol](../reference/sensor-protocol.md) (D60, phase 1):
  `sensor-schema.json` with generated TypeScript and C++ bindings, the `RS` envelope with a
  512-byte payload, `i32` and `bytes` field kinds, frozen fixtures, and a simulated add-on. The C++
  codec is split so both protocols share its field and envelope code; node frames and fixtures are
  unchanged. **Verified:** host tests only, including byte-for-byte agreement between the
  TypeScript and C++ codecs. **Not verified:** anything on hardware; no add-on firmware exists yet,
  and no node firmware or portal change ships.
- **Added:** the mobile app's November map and notification features in the web portal and desktop
  app (D59): follow mode with a heading, speed and elevation readout, bearings in mils, true or
  magnetic heading, keeping the screen on, node trails, track recording with GPX export, Alpha 1
  walking in the demo, and message notifications. For a laptop in a vehicle, a USB GPS receiver
  (NMEA) can be the location source, and the desktop app keeps the computer awake.
- **Verified:** host tests for declination against NOAA's WMM2025 test values, NMEA parsing, trails,
  the track store and notification wording; the desktop app builds. **Not verified:** any of it in
  a browser or the desktop app, a real USB GPS receiver, notifications and keeping awake on Windows
  and Linux. No firmware change.

## v0.12.0 — November 18, 2026

- **Added:** a desktop app for macOS, Windows and Linux (D58), built with Tauri 2 in
  `agents/desktop/`. It shows the web portal and the firmware installer unchanged and gives them USB
  through a Rust serial bridge behind a Web Serial shim. Bluetooth is not in it yet. See
  [Desktop app](../guides/desktop-app.md).
- **Added:** tag-driven releases. `tools/release-version.ts` sets one version across the firmware,
  desktop app and package; pushing a `v` tag runs `.github/workflows/release.yml`, which builds
  everything and publishes the installers, one firmware zip per board and `SHA256SUMS` to GitHub
  Releases. The website has a [download page](https://reapermesh.com/download/) that links to the
  newest release. See [Releases](../contributing/releases.md).
- **Verified:** the macOS app on the owner's Mac lists the USB ports, connects the portal to the
  T1000-E and opens the installer. **Not verified:** installing firmware from the app, the Windows
  and Linux builds, and the release workflow, which has not run yet.
- **Changed (docs and website):** boards are listed from one place. `agents/boards.json` drives
  the website's board cards and supported-boards list and the installer's board menu. Each board
  has a page in [`docs/boards/`](../boards/README.md) from a shared template; the hardware guide
  keeps only what every board shares; transmit power is listed per radio chip; Status has a row per
  board. [Adding a board](../contributing/adding-a-board.md) lists everything a new board touches,
  and `tests/simulator/boards.test.ts` fails when one is missed. The website and support page now
  list the T1000-E, marked experimental.
- **Breaking (firmware, owner-approved under D42):** every board now names nodes `node-` and 16
  hex digits. Earlier firmware named any 48-bit node ID `heltec-` and 12 hex digits whatever the
  board, a leftover from when the Heltec was the only board, and the Heltec named itself that way
  too. After reflashing, the Heltec reports `node-0000…` like the T-Beam and T1000-E, so a browser
  treats it as a new radio: its earlier local history, discovered nodes and team-radio record stay
  under the old ID, and it has to be added to the team again. A `heltec-` destination is still
  accepted. The mobile app's handling of the new form is not checked here.
- **Fixed (portal):** a sender not yet discovered showed as `heltec-…` or "Node heltec-…". The
  portal now shows `Node` and the last four hex digits for both forms.
- **Added:** a Seeed SenseCAP T1000-E target, `t1000-e`, built with Zephyr (D57). It shares the
  portable components and mesh service with the ESP32 boards and adds an LR1110 radio driver over
  Semtech's pinned LR11xx driver, a PSA Crypto backend, and T1000-E USB, storage, Bluetooth, button,
  LED and battery adapters. `tools/bootstrap-zephyr.sh` pins Zephyr v4.5.0 and SDK 1.0.1;
  `tools/build-t1000e.sh` builds the image. The browser installer installs it through the board's
  bootloader over Web Serial (serial DFU), from Reaper or Meshtastic alike. No protocol or storage
  format change.
- **Verified:** on the owner's T1000-E, a first install over Meshtastic and an update over Reaper
  with the installer's DFU code, an update from the installer page in the owner's browser
  (owner-reported), USB sessions, the LR1110 probe, US receive mode, and settings kept
  across an update and a restart. Host tests for the LR1110 driver and the DFU protocol pass.
- **Fixed:** pairing a phone halted the T1000-E until it was reset. LE Secure Connections pairing
  runs P-256 and AES-CMAC on Zephyr's Bluetooth work queues, whose default stacks (1,200 and 1,400
  bytes) overflowed. They are now 6 KB each, and any fatal error restarts the board instead of
  halting it. With the larger stacks a phone paired and the app connected (owner-reported).
- **Fixed:** the T1000-E could stop answering over USB while a phone was connected, until the
  Bluetooth link dropped. Its main loop sent notifications, and Zephyr waits forever for a buffer
  there. Notifications now go out from the system work queue, where Zephyr never waits, as the ESP
  boards' NimBLE link never blocks. The board also restarts if its main loop stalls for 30 seconds.
  The stall was seen once and not reproduced. With the change, the phone app connected and sent
  messages through the T1000-E (owner-reported).
- **Not verified:** the installer page's first install over other firmware, transmitting, radio
  links with the other boards, the LED, button and battery
  voltage. Not built in CI yet.
- **Added:** the website at <https://reapermesh.com/>, published from `main` (D54). The root is
  a landing page for the project: features, screenshots, how it works, supported boards and
  where the mobile app will be available. The web portal moves to `/web/` and the installer stays
  at `/flash/`, and the site gains the pages the App Store and Google Play listings need: the
  mobile app (`/app/`), support (`/support/`) and a privacy policy (`/privacy/`) that also covers
  the website. These pages come from `agents/site/` and share one header and footer. Old
  `justingreerbbi.github.io/reaper-mesh/` links redirect, but browser storage stays with that old
  origin; moving the portal from the root to `/web/` kept it on the same origin.
- **Verified:** live on November 8: HTTPS, redirects from `www`, plain `http` and the old address,
  every page, and the installer listing `v0.11.1` for all three boards from a clean CI build.
  Locally, every internal link resolves and the pages fit a 375-pixel phone screen.
- **Not verified:** installing from the live installer onto a board.
- **Changed:** the iOS app is live on the App Store, so the website's App Store buttons (home page
  and `/app/`) link to its listing, <https://apps.apple.com/us/app/reaper-mesh/id6832375918>.
  Google Play still says "Coming soon".
- **Added:** a desk relay test build (D56), `tools/hardware-relay-smoke.ts` (Open mode) and
  `tools/hardware-relay-team-smoke.ts` (Team mode, a relay-key-only relay, key rotation), which
  test three boards on one desk by making the two ends ignore frames heard straight from their
  sender.
- **Fixed:** 1,024-byte messages never crossed a relay. The origin sent each fragment as soon as
  the last finished, so a relay, which can't listen while it forwards, missed every other
  fragment, the same way every round. Origins now wait after each fragment (about 0.5 s for a full
  one) so relays can forward it. A new host test models real airtime, half-duplex radios and
  collisions; it fails without the fix.
- **Verified:** on a desk in Open mode, with the WiFi LoRa 32 V3 relaying between a T-Beam V1.2
  and a Wireless Stick V3, three runs: nothing passes with relaying off; one-frame and 1,024-byte
  direct messages are acknowledged both ways and broadcasts arrive once both ways through the
  relay. Two-board 1,024-byte delivery (V3 and Stick each with the T-Beam) and the channel test
  still pass. In Team mode, the same messages cross both ways with the relay as a full member and
  with the relay holding only the relay key; the relay-key-only relay can't read the broadcasts
  it forwards. Key rotation crosses the relay: the far end follows an epoch proof it hears only
  through the relay, and after the relay's radio is off across two more rotations, the next proof
  brings the relay and the far end up to date. More than one relay and separated boards are not
  tested.
- **Changed:** the firmware installer picks the board from a dropdown, and **Download firmware
  instead** saves the chosen build as a zip with the images, an esptool command, hashes and
  license notices. The README's install button no longer names specific boards.
- **Added:** the Heltec Wireless Stick V3 as a supported board (D55), with its own
  `heltec-stick-v3` build, updater support, a CI build, and a choice in the browser installer. It
  reuses the WiFi LoRa 32 V3's board code, and its 0.49-inch 64 × 32 screen gets a compact version
  of each page. Each unit's radio gate opens only once the owner confirms its band and antenna.
  The target was first added as the screenless Wireless Stick Lite V3; the owner's board turned out
  to be the Wireless Stick V3, so it was renamed.
- **Verified:** installed with the updater on the owner's US/915 unit (antenna confirmed). With a
  T-Beam V1.2 over the air: 1,024-byte direct messages both ways with destination
  acknowledgment; Public and joined-channel broadcasts; joining by invite into different slots;
  encrypted messages both ways; channels surviving a reset; a removed channel going silent; and
  discovery both ways, with a board that has replies off staying silent. Over USB: its SX1262
  probe passes and settings save and read back.
  The owner confirmed the compact screen shows content, which confirms its I2C pins match the WiFi
  LoRa 32 V3's.
- **Not verified:** Bluetooth pairing; the LED, battery voltage and buttons.
- **Added:** the web portal and a browser firmware installer are published on GitHub Pages from
  every push to `main` (D54): <https://justingreerbbi.github.io/reaper-mesh/> and
  <https://justingreerbbi.github.io/reaper-mesh/flash/>. The installer serves the firmware CI
  built from that commit, checks it the same way as the USB updater, and keeps settings,
  pairings and keys. The portal links to it from **Device → Install or update firmware**.
- **Verified:** host tests for the installer's checks; both pages built and served under
  `/reaper-mesh/` locally, with every published image matching its hash.
- **Not verified:** installing through the browser on a real board, and the first deploy to
  GitHub Pages.

## v0.11.1 — November 7, 2026

- **Changed:** the status LED is now off by default, including its startup flash. Turn it on
  with **Status light** in the portal.
- **Portal:** scanning a later team code for the team you already have now keeps your radios
  and moves to the newer keys, instead of offering to replace the team.
- **Fixed:** a signed/unsigned comparison in the rotation code that broke the GCC build of the
  firmware unit tests.
- **Verified:** on both boards over USB, the setting reads off after install and saved on and off
  values survive a restart. 1,024-byte messages cross both ways with acknowledgment.

## v0.11.0 — November 7, 2026 · D53

- **Added:** a status LED that pulses on radio activity and blinks slowly while messages wait,
  with an on/off setting in the portal (`ledEnabled`, feature bit 17, storage record 8).
- **Verified:** the owner saw the LED on both boards. The portal toggle has only been clicked
  against the simulated device.

## v0.10.0 — November 5, 2026 · D52 · Breaking

- **Added:** automatic team key rotation with epoch proofs. The portal shows the keys' age,
  sets the interval from 6 hours to 7 days, and has **Rotate now**. Team codes become
  `RMTEAM2`.
- **Fixed:** serial input during a flash write could overflow and end the session (9 of 22
  stress runs on the Heltec). The same sequence then passed 20 of 20 on the Heltec and 12 of 12
  on the T-Beam.
- **Verified:** on two boards with a test tool and through the portal: radios follow a rotation,
  messages cross it, wrong proofs are refused and a radio that was away catches up.
- **Also tested:** interrupted encrypted uploads on two boards over radio. A message is never
  resent or duplicated, a partial upload is never delivered and no plaintext reaches USB.
- **Not verified:** the interval actually elapsing on hardware (only **Rotate now**), relay in
  this format, and a power cut during a key change.

## v0.9.0 — November 4, 2026 · D50 step 1 complete

- **Added:** firmware carries any 1–1,024-byte payload without needing to understand it, so new
  message formats need no firmware update. An app can ask to be alerted when the inbox changes,
  which lets a phone wake up in the background.
- **Portal:** a **Radio network** page to create or join a team by QR code, add a radio as a
  member or relay, and choose Open mode (D51). The owner ran team setup on two boards over USB.

## v0.8.0 — November 4, 2026 · Breaking

- **Added:** team keys. A radio stores a relay key, takes its team key from the app into memory,
  and sends nothing until a network is chosen. Changing keys needs USB or the button-opened
  window.
- **Changed:** a new partition layout with two application slots (one reserved for signed
  updates) and a `reaper_keys` partition.

## v0.7.0 — November 4, 2026 · Breaking

- **Changed:** radio format version 2 replaces version 1 (D50). Frames are sealed and opened in
  one place, relays forward a frame's bytes without decoding them, and a saved boot counter
  replaces the boot nonce. Boards on earlier firmware cannot share traffic with it.

## v0.6.2 — November 4, 2026

- **Fixed:** Bluetooth output now reserves room for its replies before reading each request, so
  a congested link cannot drop a reply or reset the session.

## v0.6.1 — November 4, 2026

- **Added:** the Heltec shows a calibrated battery voltage and battery icon. It has no fuel
  gauge, so it shows voltage rather than an invented percentage.
- **Fixed:** Bluetooth flow control under congestion.

## v0.6.0 — November 4, 2026 · D47

- **Added:** the portal connects over Web Bluetooth, and can start pairing, show the passkey and
  pair a browser over USB (`pairingRequest`, `pairingStatus`).
- **Portal:** redesigned to follow the mobile app (D49): Comms, Map, Nodes and Device tabs,
  Night and Day themes, a connect screen, automatic reconnect and brevity phrases.

## v0.5.0 — November 4, 2026 · D47

- **Added:** a Bluetooth link for mobile apps. Holding the main button for 5 seconds opens
  pairing, the passkey shows on the screen, and only bonded, authenticated devices can reach
  the protocol. Up to four devices can pair.

## v0.4.0 — November 4, 2026 · D46

- **Changed:** transmit power is low, medium or high instead of a dBm number, with an optional
  boost on the T-Beam (storage record 7). Stored dBm values load as medium.
- **Portal:** map cleanup with a placement crosshair, rectangle drawing and full-screen mode.

## v0.3.0 — November 3, 2026 · D45 · Breaking

- **Changed:** channels are identified on air by a 32-bit channel ID instead of a slot number,
  so two boards can share a channel in different slots. Channels are shared with `RMCH1` QR
  invites. Encrypted messages move to the `RME2` envelope.
- **Portal:** remove a channel and reset Public; a more compact chat layout.

## v0.2.0 — November 3, 2026

- **Added:** screen timeout and wake-on-message settings, set from the portal (storage
  record 5), and the T-Beam's battery percent and plugged-in indicator.

## v0.1.0 — November 3, 2026 · D44

- **Added:** device screen pages (main, nodes, debug), button gestures and the T-Beam power-key
  shortcut. Adopted the `{board}-reaper-mesh-v{version}` image names.

## Prototype builds — November 1–2, 2026

Before version numbers, the boards ran numbered prototype images (`usb-prototype-0` to `-8` on
the Heltec, `tbeam-usb-prototype-1` to `-3` on the T-Beam). In two days they went from a first
USB-only flash to:

- USB handshake, atomic settings storage and query-only recovery.
- Message upload, the inbox, radio diagnostics and the first transmission (after an SPI DMA
  fix).
- **Direct delivery with acknowledgment between a Heltec V3 and a T-Beam V1.2.**
- Discovery, fixed positions and the OLED status screen.
- In the portal: the messaging and map workspace, message deletion and unread counts, shared
  map items, JSON plugins, agent-side channel encryption, the optional PIN and local wipe.
