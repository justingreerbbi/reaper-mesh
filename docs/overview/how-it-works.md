# How Reaper Mesh works

Reaper Mesh lets a group of people send text messages to each other over radio, with no
internet, no cell towers and no accounts. Each person carries a small, inexpensive LoRa radio
board and uses an app on their phone or computer to read and write messages.

This page explains the system in plain language first, then adds the technical detail. You do
not need to read the reference documents to use Reaper Mesh, but every section links to them
if you want the exact rules.

## The three pieces

| Piece | What it is | What it does |
| --- | --- | --- |
| **Radio board** (a *node*) | A Heltec WiFi LoRa 32 V3 or LILYGO T-Beam V1.2 running Reaper Mesh firmware | Sends and receives radio packets, relays traffic for others, and stores its own settings and a small inbox |
| **App** (an *agent*) | The web portal in this repository, or the Reaper Mesh mobile app | Where you read and write messages, see the map and change settings. It talks to one board over USB or Bluetooth |
| **Protocol** | The documented rules both sides follow | Defines the bytes on the USB or Bluetooth link and the packets on the air, so every app and board understands each other |

```text
  Your phone or browser                 Your radio board                  Other people's boards
 ┌──────────────────────┐  USB or    ┌───────────────────────┐   LoRa    ┌────────────────────┐
 │  App (agent)          │ Bluetooth │  Firmware (node)       │  radio   │  Firmware (node)    │
 │  messages, map,       │ ◀───────▶ │  settings, inbox,      │ ◀──────▶ │  … and its own app  │
 │  keys, settings       │           │  mesh relay, radio     │          │                     │
 └──────────────────────┘            └───────────────────────┘           └────────────────────┘
```

The app never drives the radio directly. It hands the board a message, and the board decides
when and how to transmit it within its limits. The board is the source of truth for its own
settings: the app shows a copy and can only change them through checked, all-or-nothing saves.

## A message, start to finish

1. **You write a message** in the app. On an encrypted channel the app encrypts it first, so
   the board only ever sees scrambled bytes.
2. **The app uploads it** to the board over USB or Bluetooth, in small pieces with a request ID.
   If the link drops halfway, the app asks the board what happened instead of sending again.
3. **The board queues it** and sends it over the air, split into radio-sized fragments, while
   staying inside an airtime budget so one node cannot flood the channel.
4. **Other boards relay it** if relaying is on, a limited number of hops, ignoring copies they
   have already seen.
5. **The destination board receives it,** reassembles it and stores it in its inbox. For a
   direct message it sends back an acknowledgment.
6. **The other person's app reads the inbox,** decrypts the message if it has the key, and
   shows it.

Every message shows exactly how far it got. Reaper Mesh never guesses or rounds up:

| State | What it means |
| --- | --- |
| **Queued** | Your board accepted the message and is waiting to send it |
| **Transmitted** | Your board sent every fragment over the air. This is not delivery |
| **Delivered** (acknowledged) | The destination board received the whole message. It does not mean anyone has read it |
| **Failed** | It could not be sent or no acknowledgment arrived in time |
| **Unknown** | The link was lost before the result was known. The app checks later and never resends on its own |

Broadcasts on a channel have no acknowledgment, because a reply from every listener would
overwhelm the radio. A broadcast is complete once it is transmitted.

Details: [Messaging](../reference/messaging.md), [Protocol](../reference/protocol.md),
[Radio protocol](../reference/radio-protocol.md).

## Channels, teams and encryption

- **Channels** are like group chats. Every board has the permanent **Public** channel and can
  join up to seven more. You create a channel in the app and share it with a QR code.
- **Encrypted channels** keep message text private. The key lives only in the apps, never on
  the boards, and is shared with the channel's QR code.
- **Team networks** go further: radios outside your team cannot read, send or even relay your
  traffic, and the team's keys rotate automatically. **Open mode** is the simpler alternative,
  where any Reaper Mesh radio can join.

Who can read what, how to set each one up, and their honest limits are in
[Security and privacy](../guides/security.md).

## Finding people

- **Discovery** lets nodes announce themselves and answer a "who is listening?" request, so
  the app can list everyone it has heard, when and how far away.
- **Position sharing** lets a node include a fixed location (or the phone's location) in those
  announcements, so others can see it on the map.

Both are off until you turn them on. A node that does not answer is not necessarily offline;
it may be out of range or have replies turned off. Details:
[Discovery and position](../reference/discovery.md).

## Design principles

1. **Small, stable core.** The firmware and protocols stay small: messaging with
   acknowledgments, relay, discovery, positions, channels and a way to carry data the firmware
   does not understand. New features go in the apps and plugins, so boards rarely need a
   firmware update and older boards keep working with newer apps (decision D41).
2. **Honest delivery.** Queued, transmitted, delivered, failed and unknown are always kept
   apart. Nothing invents an acknowledgment, a timestamp or a read receipt.
3. **Recover, never repeat.** After a lost link, reboot or reload, the app asks the board what
   happened. A message or setting is never sent twice by accident.
4. **Everything has a limit.** Message size, queues, retries, fragments, memory and airtime
   are all bounded, so a busy network degrades gracefully instead of falling over.
5. **The board owns its settings.** Saves are revision-checked and atomic, so two apps cannot
   overwrite each other and a half-written save never takes effect.
6. **Say what was tested.** Computer tests check logic, not radios. Hardware results are
   stated exactly, and anything untested is called untested.

Before core v1 the protocol can still change, with the owner's approval, when that keeps the
core simple (decision D42). From core v1 on, the formats freeze and full compatibility rules
apply.

## Limits at a glance

| Property | Limit | Notes |
| --- | --- | --- |
| Message length | 1,024 bytes of UTF-8 text | About 947 bytes on an encrypted channel |
| Channels per board | 8, including Public | Channels share one radio frequency; they are groups, not separate radios |
| Radio preset | `US915_LAB1`: 915 MHz, 500 kHz bandwidth, spreading factor 7 | A fast, short-range preset. Range has not been measured yet |
| Transmit power | Low, medium (default) or high | Up to +22 dBm on the Heltec V3. See [Hardware](../guides/hardware.md#transmit-power) |
| Airtime budget | 1% average with a one-second burst | Roughly one full-length message per node per minute once the burst is used |
| Nodes remembered | 32 on the board | The app remembers more |
| Board inbox | 8 messages | The app keeps its own history |
| Paired Bluetooth devices | 4 per board | |
| Region | United States (915 MHz) only | EU and other regions need separate hardware and legal checks first |

## What Reaper Mesh is not

- **Not a certified or emergency service.** It is a prototype under active development. Do not
  rely on it for life-safety decisions.
- **Not guaranteed delivery.** Radio is lossy. Reaper Mesh tells you what happened; it cannot
  make every message arrive.
- **Not anonymous.** Even with encryption, radios can see that traffic exists.
- **Not compatible with Meshtastic** or other mesh networks. It uses its own protocol;
  Meshtastic was only a reference for terminology.
- **Not a cloud product.** There is no MQTT, telemetry, Wi-Fi networking or remote
  administration. Map tiles are the only thing the portal fetches from the internet, and
  messaging works without them.

## Words used in these docs

| Word | Meaning |
| --- | --- |
| **Node** | A radio board running Reaper Mesh firmware |
| **Agent** | Software connected to a node: the web portal or the mobile app |
| **Portal** | The web app in `agents/web/` |
| **Channel** | A named messaging group, identified on the air by a 32-bit channel ID |
| **Direct message** | A message addressed to one node. It is routed to that node, but on a shared channel key it is not private from other key holders |
| **Relay** | A node that forwards other nodes' packets |
| **Team** | A private radio network with its own keys. See [Security and privacy](../guides/security.md) |
| **Epoch** | One period of a team's keys. Keys move to a new epoch when they rotate |
| **RACE** | The project's name for designing and testing synchronization and recovery: lost links, reboots and overlapping operations. It is a practice, not a library (decision D5) |
| **Core v1** | The planned first stable version of the firmware and protocols |
