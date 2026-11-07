# Introduction

Reaper Mesh is a focused, long-range text messaging system that works without the
internet, cell towers, or any cloud service. It runs on inexpensive LoRa radio boards
and is controlled from an ordinary web browser over a USB cable or Bluetooth.

The goal is simple and deliberately narrow: **dependable messaging between a small number
of devices, with small firmware and careful compatibility across releases.**

## What it is

- **Custom firmware** for hobbyist LoRa boards — currently the Heltec WiFi LoRa 32 V3 and
  the LILYGO T-Beam V1.2.
- **A browser agent** (the "field portal") that connects to a board with the
  [Web Serial API](https://developer.chrome.com/docs/capabilities/serial) over USB, or Web
  Bluetooth, with no app to install. Mobile apps speak the same protocol and are built outside
  this repository.
- **An independent, documented protocol.** Reaper Mesh does not interoperate with other
  mesh networks; [Meshtastic](https://meshtastic.org/) is used only as a functional
  reference for terminology and expectations.

## What you can do with it today

| Capability | State |
| --- | --- |
| Connect a board over USB and configure it from the browser | Works, verified on hardware |
| Public and named channels, transmit power, and radio mode | Works, verified on hardware |
| Send text messages up to 1,024 bytes, with fragmentation | Works, verified on hardware |
| Direct radio delivery between two boards, with acknowledgment | Works, verified on two boards |
| Local inbox, delivery states, and recovery after disconnects | Works, verified on hardware |
| Discover nearby nodes and share a fixed position | Works, verified on two boards |
| Agent-side channel encryption | First implementation; verified on two boards, not audited |
| Team radio networks with automatic key rotation | First implementation; verified on two boards, not audited |
| Bluetooth link with physical-access pairing | Works from the portal, owner-reported |
| On-device screen, buttons and battery display | Works, confirmed by the owner on hardware |
| Three-node relaying, field range, and power-loss durability | **Not yet qualified** |

See the [status tracker](status.md) for the precise evidence behind each line, and the
[roadmap](roadmap.md) for what is planned next.

## Who it is for

- **Someone who just wants to use it** should read [Getting started](../guides/getting-started.md)
  (try it with no hardware), then [Hardware](../guides/hardware.md) and
  [Flashing firmware](../guides/flashing-firmware.md).
- **A developer who wants to understand or extend it** should read the
  [Reference](../README.md#reference--how-it-works-in-detail) section, starting with the
  [Protocol](../reference/protocol.md), and the [Development plan](../contributing/plan.md).

## How the pieces fit together

```text
 Browser (field portal)                      LoRa board (firmware)
┌───────────────────────────┐ USB or Blue-  ┌──────────────────────────┐
│  UI: messages, assets,     │    tooth      │  Protocol engine          │
│  settings, recovery        │ ◀──────────▶ │  Config authority + NVS   │
│                            │   framed      │  Message queue + inbox    │
│  agent-core:              │   binary      │  Independent mesh core    │
│  connection + state        │   frames      │  SX126x / SX1276 radio    │
└───────────────────────────┘               └──────────┬───────────────┘
                                                        │ LoRa RF
                                                        ▼
                                              other Reaper Mesh nodes
```

- The **board** is always authoritative for its own saved configuration. The browser holds
  a copy and may only change it through revision-checked, atomic writes.
- The **browser never talks to the radio directly.** It hands the firmware a message; the
  firmware decides whether and how to transmit based on confirmed region, antenna, and mode.
- **Transport is kept independent**, so USB and Bluetooth share the same protocol and state
  machine.

## Design principles

1. **Be honest about delivery.** "Queued", "transmitted", "acknowledged", "failed", and
   "unknown" are tracked as distinct states. The system never fabricates an acknowledgment
   or claims a result it cannot prove.
2. **Bound everything.** Memory, queues, retries, message size, fragment count, reassembly
   lifetime, and airtime all have explicit limits. There is no unbounded flooding.
3. **Stay compatible.** USB, radio, configuration, and firmware versions are negotiated
   independently. A firmware build-string change never forces an agent upgrade. Full
   compatibility rules start at core v1 (D42).
4. **Don't overclaim.** Host tests qualify logic, not radios. Hardware limitations are
   stated plainly and untested cases are recorded rather than assumed.

## What it is *not*

Reaper Mesh is not a production or certified product. It does not provide telemetry, cloud
accounts, MQTT, Wi-Fi networking, or remote administration. Channel encryption is a
simple shared group-key design — it is **not** pairwise-private, forward-secure, or
independently audited. Team networks limit who can read and send over the radio, and they have
not been audited either. Regional transmission is confined to the US until EU hardware and
settings are separately verified. Reaper Mesh is open source under the Apache License 2.0.
