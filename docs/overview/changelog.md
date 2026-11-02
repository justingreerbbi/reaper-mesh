# Changelog and hardware evidence

This is the chronological record of firmware builds and the hardware tests run against
them. It is the single source for dated evidence; the guides and reference specs link here
rather than repeating it.

> [!NOTE]
> All dates are in 2026. "Host tests" qualify logic on a development machine, not radios.
> A passing serial check does not verify visible OLED pixels or real RF behavior unless the
> entry says so. Local screenshots and reports referenced below live under ignored `build/`
> paths and are not committed.

## Installed firmware at a glance

| Board | Latest image | Source commit | Notes |
| --- | --- | --- | --- |
| Heltec WiFi LoRa 32 V3 | `usb-prototype-8` | `4209679` | Fixed position; US/915 antenna confirmed |
| LILYGO T-Beam V1.2 | `tbeam-usb-prototype-3` | `4209679` | Fixed position; AXP2101 + SX1276 |

Encrypted direct messaging was additionally verified on both boards on November 2 from a
development tree using the updater's `--allow-dirty` option.

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

The client repeats the same `hello` at most once per 500 ms while negotiating, without
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
quiesce; a power change caused `radio-config-changed`, and the client preserved accepted
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
