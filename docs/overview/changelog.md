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

- **Added:** the Heltec Wireless Stick Lite V3 as a supported board (D55), with its own
  `heltec-wsl-v3` build, updater support, a CI build, and a choice in the browser installer. It
  reuses the WiFi LoRa 32 V3's board code and has no screen. Each unit's radio gate opens only once
  the owner confirms its band and antenna.
- **Verified:** installed on a Wireless Stick Lite V3 with the updater, with all four images
  verified by the ROM. Over USB the board reports `heltec-wsl-reaper-mesh-v0.11.1`, its SX1262
  probe passes (the factory demo's "Starting LoRa failed" was the demo, not the radio), a
  1,024-byte message is delivered locally to its inbox, and a setting saves, reads back on a new
  session and restores. Its partition table matches the V3's byte for byte.
- **Changed:** the owner confirmed the development unit is the US/915 MHz model with an antenna
  attached, so its radio gate is open. With it open, the radio starts in listen-only mode and
  returns to its mode with nothing transmitted.
- **Not verified:** delivery over the air to or from another board; Bluetooth pairing; the LED,
  battery voltage and buttons.
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
