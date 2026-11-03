# Changelog and hardware evidence

This is the chronological record of firmware builds and the hardware tests run against
them. It is the single source for dated evidence; the guides and reference specs link here
rather than repeating it.

> [!NOTE]
> All dates are in 2026. "Host tests" qualify logic on a development machine, not radios.
> A passing serial check does not verify visible OLED pixels or real RF behavior unless the
> entry says so. Local screenshots and reports referenced below live under ignored `build/`
> paths and are not committed.

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
