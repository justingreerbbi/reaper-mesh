# Getting started

You can try Reaper Mesh with **no radio hardware at all**. The web portal includes a simulated
device that speaks the real protocol, so it behaves just as it would with a board plugged in.

## Fastest: try it online

Open **<https://reapermesh.com/web/>** in Chrome, Edge or Brave and choose
**Use simulated device**, then skip to [step 3](#3-connect-the-simulated-device). Nothing is
installed, and your messages and settings stay in your browser.

The rest of this page runs the portal from source, which you need to change the code.

## What you need

| Tool | Version | Why |
| --- | --- | --- |
| [Node.js](https://nodejs.org/) | 24 or 25 | Runs the web portal and the tests |
| [Git](https://git-scm.com/) | Any recent | To download the code |
| A Chromium browser | Chrome, Edge or Brave | Needed later for USB (Web Serial) and Bluetooth. Any browser works with the simulator |

To run the full test suite you also need **Python 3.9+** and a **C++17 compiler** (`c++` on your
`PATH`, or set `CXX`). On macOS, `xcode-select --install` provides the compiler.

## 1. Download and install

```sh
git clone https://github.com/justingreerbbi/reaper-mesh.git
cd reaper-mesh
npm ci --ignore-scripts
```

`--ignore-scripts` is deliberate: installing never downloads or builds anything behind your back.

## 2. Start the web portal

```sh
npm run dev:web
```

Open the address it prints, normally <http://127.0.0.1:5173/>. The server listens on your own
computer only; nothing is published.

## 3. Connect the simulated device

On the connect screen, choose **Use simulated device**. You now have a board with two channels,
three nodes it has "heard", positions on the map and a few incoming messages. Try:

- **Comms:** open **Alpha 1** and reply. Watch the delivery icon change as the message moves
  from queued to transmitted to delivered.
- **Map:** see where nodes report being, drop a point, measure a distance, draw an area.
- **Nodes:** see who has been heard, when, and how far away.
- **Device:** browse every setting, from radio power to the team network.

The simulator models the protocol, not a radio. Nothing it shows tells you how a real radio
performs.

## 4. See recovery in action (optional)

Reaper Mesh is designed so a lost connection never sends something twice or pretends something
worked. The simulator can break things on purpose. Open **Device → Storage**:

1. Set **Next save** to **Disconnect after commit**, change the device name in
   **Device → General** and save. The link drops, and the save's outcome becomes **unknown**.
   The portal reconnects and *asks* the device what happened instead of saving again.
2. Repeat step 1, then select **Reboot simulated device**. The device's record of the save is
   gone, so the portal says the change may not have applied and shows what the device reports.
3. **Lose result and change event** drops every reply to the next save. After its retry window
   the outcome becomes unknown, and the portal queries it.
4. **Drop the link** shows the lost-link banner and automatic reconnect. **Read-only on next
   connect** shows how features are blocked when a device does not support them.

A page reload resets the simulator.

## 5. Run the checks (for contributors)

```sh
npm run check
```

This runs strict TypeScript checks, verifies the generated protocol code, runs the host test
suite (including the real C++ firmware code compiled for your computer) and builds the portal.
It is the one command to run before any change. See [Development and CI](../contributing/development.md).

## Next steps

- **Use real radios:** pick a board in [Hardware](hardware.md), then install the firmware with
  the [browser installer](https://reapermesh.com/flash/) ([Flashing firmware](flashing-firmware.md) has
  both ways).
- **Learn the portal:** [Web portal guide](web-portal.md).
- **Understand the system:** [How Reaper Mesh works](../overview/how-it-works.md).
- **Contribute:** [CONTRIBUTING.md](../../CONTRIBUTING.md).

> [!NOTE]
> Passing tests on a computer does not prove how a browser handles USB permissions, how the
> firmware survives power loss, or whether a radio message gets through. Those need real
> hardware; see [Status](../overview/status.md) for what has been tested.
