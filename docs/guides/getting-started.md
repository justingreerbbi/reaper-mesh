# Getting started

You can explore Reaper Mesh with **no hardware at all**. The repository ships a simulated
device and a full web console, so you can run the automated tests and click through the
portal before you ever flash a board.

## Prerequisites

| Tool | Version | Why |
| --- | --- | --- |
| [Node.js](https://nodejs.org/) | 24 (baseline) or 25 | Runs the host tests and builds the web agent |
| Python | 3.9+ | Required by the cross-language host tests |
| A C++17 compiler | `c++` on `PATH`, or set `CXX` | Compiles and runs the firmware codec tests |

Node 24 is the proposed baseline (see `.node-version`); local verification currently uses
Node 25.9.0 on macOS arm64.

## 1. Install dependencies

```sh
npm ci --ignore-scripts
```

Install scripts are intentionally skipped — nothing is downloaded or built behind your back.

## 2. Run the checks

```sh
npm run check
```

`check` runs strict TypeScript checking across every package, verifies the generated TS/C++
protocol descriptors, runs the compiler-backed host suite, and builds the web agent. This is
the one command to run before any change. For the full breakdown, see
[Development & CI](../contributing/development.md).

## 3. Open the web console

```sh
npm run dev:web
```

Open the printed localhost URL (normally `http://127.0.0.1:5173/`). The server binds to
loopback only; nothing is deployed or published.

## 4. Try it with the simulator

In the portal, select **Use simulated device**. It speaks the exact same framed, typed protocol
and serial adapter as a real board, with channels, messages, nodes and positions, but only models
protocol replies: no radio, no flash durability.

Walk through a recovery scenario to see the honesty guarantees in action:

1. Open **Device → General**, change the device name, and **Save**. The revision advances.
2. Under **Device → Storage**, set **Next save** to **Disconnect after commit**, change the name,
   and save. The link drops and the change's outcome becomes **unknown**.
3. The portal reconnects and queries the device for the outcome *without* resending the change.
4. Repeat step 2, then **Reboot simulated device**. The receipt is gone, so the app says the
   change may not have applied and shows the device's settings.
5. **Lose result and change event** suppresses all replies for the next command (including its
   retries); after the bounded retry window it becomes **unknown**, and the app queries it.
6. **Read-only on next connect** demonstrates capability-based mutation blocking.

A page reload resets the simulator and agent history. A simulated reboot preserves config but
clears receipts and owner marks and changes the boot identity.

## Where to go next

- Ready for real hardware? Read [Hardware](hardware.md), then
  [Flashing firmware](flashing-firmware.md).
- Want to use the portal in depth? See the [Web portal guide](web-portal.md).
- Want to understand the protocol? Start with the [Protocol reference](../reference/protocol.md).

> [!NOTE]
> Passing host checks does **not** establish browser permission behavior, native serial-driver
> cleanup, firmware flash durability, or RF delivery. Those boundaries are covered in
> [Serial adapter](../reference/serial-adapter.md) and [Hardware](hardware.md).
