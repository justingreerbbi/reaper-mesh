# Bluetooth link v1

Since firmware `v0.5.0` (D47), a paired phone or computer can act as an agent over Bluetooth Low Energy. Bluetooth carries the same framed bytes as USB, so the [protocol](protocol.md), recovery rules and capability negotiation also apply here, and the radio protocol and stored settings did not change. What was tested is in [Status](../overview/status.md).

## Security rules

Creating a connection requires physical access to the device.

- **Off until first paired.** With nothing paired, the Bluetooth stack does not start and the device does not advertise.
- **Physical access opens pairing.** Holding the main button for 5 seconds opens a 2-minute window, and so does a USB host ([below](#pairing-over-usb)). Nothing over Bluetooth or radio can open it.
- **A passkey is always required.** The device shows a random 6-digit passkey on its screen for each attempt. It also reports the passkey to a USB host, and never sends it over Bluetooth or radio. Only LE Secure Connections is accepted, with a 16-byte key. Legacy pairing is compiled out. Just Works is rejected, and any bond it produced is deleted.
- **One attempt per window.** A pairing closes the window, and so does a failed attempt. Trying again takes another hold.
- **Everything else is refused.** Every protocol operation needs an encrypted, authenticated and bonded link. Outside the window a pairing attempt ends the connection. A connection that is not trusted within 5 seconds (60 seconds with the window open) is dropped, so it cannot keep the only connection slot.
- **Paired keys cannot be replaced remotely.** A repeat pairing from a known address is ignored unless the window is open, so an impostor using a paired phone's address cannot overwrite its keys.
- **At most 4 paired devices.** A full list refuses new pairings rather than dropping an existing phone. Holding the main button for 15 seconds forgets all of them and changes the device's Bluetooth address.

A paired phone has the same access as USB: messages, inbox, discovery and all settings. The exception is changing keys: replacing or erasing a [radio network](protocol.md#radio-network-d50) over Bluetooth also needs the window opened with the button, so a paired phone cannot move a radio to another network. Channel keys stay in agents, so devices still carry ciphertext only for channel messages (D33).

## What a nearby observer can see

After the first pairing, the device advertises once a second while no phone is connected, even with the window closed. The advertisement holds the Reaper service UUID and nothing about the device. The address is a random static address, not the chip's MAC, so it does not reveal the node ID. It stays the same until the paired list is forgotten, so someone could recognize the same device over time; rotating private addresses are not implemented yet. While the window is open the device also advertises a short name such as `Reaper-1A2B`, built from that random address.

## Pairing over USB

Since firmware `v0.6.0`, a USB host can open the window and read the state, using welcome feature bit 13 (8192). `pairingRequest` carries `link`, `boot`, `request` and `open` (1 opens the window, 0 only reads). `pairingStatus` answers with `link`, `boot`, `request`, `state`, `seconds` and `bonds`, plus `passkey` and `name` when there is one.

`state` is `closed`, `open`, `passkey`, `full`, `paired`, `failed`, `forgotten`, `unavailable` or `refused`. The firmware decides by the link a request arrived on, not by anything the request says: a request over Bluetooth always gets `refused`, with no passkey or name, even from the session's owner. The same answer goes to a USB host that was not admitted. So a paired phone cannot admit another device.

Agents keep this state in memory only and never journal it. The web portal polls once a second while Device → Bluetooth is showing, and forgets any passkey when the panel closes.

## GATT service

| Item | UUID | Properties | Use |
| --- | --- | --- | --- |
| Service | `5d7e0001-8b3a-4f6c-9e21-3c1a7f42b9d0` | | Advertised |
| Host to device | `5d7e0002-8b3a-4f6c-9e21-3c1a7f42b9d0` | Write with response, authenticated | Protocol bytes |
| Device to host | `5d7e0003-8b3a-4f6c-9e21-3c1a7f42b9d0` | Notify | Protocol bytes, sent only on a trusted link |
| Pairing check | `5d7e0004-8b3a-4f6c-9e21-3c1a7f42b9d0` | Read, authenticated | One byte: link version, currently 1 |

## Client sequence

1. Ask the user to open pairing, then scan for the service UUID and show the advertised name, which also appears on the device's screen.
2. Connect and read the pairing check. Reading it makes the operating system pair, and its prompt is where the user types the passkey. Finish this before starting any protocol timers, because the [connection deadlines](protocol.md#connection-manager-and-adapter-boundary) are 5 seconds and a person is slower.
3. Subscribe to device to host.
4. Run the normal protocol, starting with hello, using a new link ID for every connection.

Later connections skip pairing. The stream is the same as USB: COBS frames separated by zero bytes, with no relation between frames and Bluetooth packets. Split writes to the current ATT limit and wait for each write's response. The device requests an ATT MTU of 247 and follows whatever the phone negotiates.

The session is single-owner. The newest hello on either link takes over, and the previous host stops getting replies. Opening the USB port resets these boards, which also ends the Bluetooth connection. Never replay a send after a lost connection; recover by query, as over USB.

## Flow control

Since `v0.6.1`, a full receive buffer rejects the entire current ATT write with an
insufficient-resources error, without disconnecting the authenticated client or accepting part
of that write. A client may retry those same bytes once capacity is available; it must never
replay an ambiguously accepted message submission. The firmware drains queued notifications
between input batches and limits each tick to 4,096 input bytes so a busy client cannot starve
radio/display work.

Since `v0.6.2`, output has a bounded 8 KiB queue. The device consumes input one byte at a time
only while room remains for two maximum-sized reply frames. Congestion therefore pauses
request processing before a reply could be lost, and local backpressure does not expire a
partially received frame. Notification allocation/resource failures retry for at most five
seconds; permanent errors or persistent resource exhaustion explicitly close the broken BLE
transport rather than silently resetting its protocol session or retrying forever. Normal
reconnect starts fresh framing and queues. The Debug screen retains the last disconnect (`D`),
host reset (`S`) and notification (`N`) reason codes until device reboot. Bluetooth address
initialization state shared by the host callback and application task is atomic.

## Firmware layout

`firmware/components/reaper_device` holds the logic that host tests cover: `host_links` (one session over two links) and `pairing.hpp` (window, trust and passkey rules). `firmware/app/ble_link.cpp` connects those to NimBLE, on its own core away from the radio loop.

Keys are stored in a separate `nvs` partition at `0x210000` (32 KiB), added after the application so nothing moved. It holds only Bluetooth keys, the Bluetooth address and radio calibration. Device settings stay in `reaper_nvs`, and the firmware may reset only the Bluetooth partition if it is blank or unreadable; the cost is that phones must pair again.

## Boards without a screen

Both supported boards have screens, so nothing else is built yet. The rules do not depend on the screen: pairing needs some physical action and some private way to show the passkey. [Pairing over USB](#pairing-over-usb) already provides both, so a board without a screen can use it. A board with no way to show a passkey must refuse to pair, not fall back to Just Works.
