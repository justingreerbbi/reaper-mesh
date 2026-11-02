# Introduction

Reaper Mesh is a focused, long-range text messaging system that works without the
internet, cell towers, or any cloud service. It runs on inexpensive LoRa radio boards
and is controlled from an ordinary desktop web browser over a USB cable.

The goal is simple and deliberately narrow: **dependable messaging between a small number
of devices, with small firmware and careful compatibility across releases.**

## What it is

- **Custom firmware** for hobbyist LoRa boards — currently the Heltec WiFi LoRa 32 V3 and
  the LILYGO T-Beam V1.2.
- **A desktop browser agent** (the "field portal") that connects to a board over USB using
  the [Web Serial API](https://developer.chrome.com/docs/capabilities/serial), with no app
  to install.
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
┌───────────────────────────┐   USB / Web   ┌──────────────────────────┐
│  UI: messages, assets,     │    Serial     │  USB protocol engine      │
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
- **Transport is kept independent** so a future BLE or mobile agent can reuse the same
  protocol and state machine.

## Design principles

1. **Be honest about delivery.** "Queued", "transmitted", "acknowledged", "failed", and
   "unknown" are tracked as distinct states. The system never fabricates an acknowledgment
   or claims a result it cannot prove.
2. **Bound everything.** Memory, queues, retries, message size, fragment count, reassembly
   lifetime, and airtime all have explicit limits. There is no unbounded flooding.
3. **Stay compatible.** USB, radio, configuration, and firmware versions are negotiated
   independently. A firmware build-string change never forces a agent upgrade.
4. **Don't overclaim.** Host tests qualify logic, not radios. Hardware limitations are
   stated plainly and untested cases are recorded rather than assumed.

## What it is *not*

Reaper Mesh is not a production or certified product. It does not provide telemetry, cloud
accounts, MQTT, Wi-Fi networking, or remote administration. The current encryption is a
simple shared group-key design — it is **not** pairwise-private, forward-secure, or
independently audited. Regional transmission is confined to the US until EU hardware and
settings are separately verified. Licensing is deliberately deferred by the project owner.
