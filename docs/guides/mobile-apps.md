# Connect a mobile app

A mobile app is an agent: an app that talks to a Reaper device. This guide explains how one connects and what it must do. This repository contains no mobile app. Exact contracts are in [Bluetooth link](../reference/bluetooth.md) and [Protocol](../reference/protocol.md).

The mobile app is built and tested outside this repository (D48), so results from it are not recorded here. The evidence kept here for pairing, connecting and messaging comes from a desktop browser. Phone simulators have no Bluetooth, so test on real devices. The protocol can still change before core v1 (D42).

## What a phone can do

A paired phone uses the same protocol as USB, with the same access to messages, inbox, discovery and settings. It cannot open pairing or read a passkey, and the device refuses those requests over Bluetooth.

## Connecting

1. Tell the user to open pairing on the device: hold the main button for 5 seconds, or select Start pairing in the web portal over USB.
2. Scan for service `5d7e0001-8b3a-4f6c-9e21-3c1a7f42b9d0`. While pairing is open the device also advertises a name like `Reaper-1A2B`. Afterward it advertises the service with no name, so remember paired devices yourself.
3. Connect and request an MTU of 247.
4. Read the pairing check, `5d7e0004-8b3a-4f6c-9e21-3c1a7f42b9d0`. The operating system then asks for the passkey, which the user reads from the device's screen. Your app never sees the passkey.
5. Subscribe to device to host, `5d7e0003-8b3a-4f6c-9e21-3c1a7f42b9d0`.
6. Write protocol bytes to host to device, `5d7e0002-8b3a-4f6c-9e21-3c1a7f42b9d0`, with response. Wait for each response, and split writes to the connection's limit.
7. Start the session.

Later connections skip pairing. If the phone was forgotten on the device, the user must also forget the device in the phone's Bluetooth settings, then pair again.

Finish pairing before starting any session timers, because a person is typing a passkey and the session deadlines are 5 seconds.

## The session

The bytes are the same as USB: COBS frames separated by zero bytes, each with a header, a typed payload and a CRC-32. Frames do not line up with Bluetooth packets, so buffer until a zero byte. See [Protocol](../reference/protocol.md).

1. Send `hello` with a new link ID for this connection, repeating it at most every 500 ms until `welcome` arrives, for up to 5 seconds.
2. Read the capabilities in `welcome`. Check them before using a feature, and do not assume one from the firmware version.
3. Send `sync` and wait for `snapshot`, within 5 seconds.
4. Once ready, send `ping` 2 seconds after each `pong`. Treat a missing `pong` after 5 seconds as a lost connection.

## Rules that keep messages correct

- **Save before you send.** Store each outgoing request durably before writing it, so a lost connection can be resolved afterward. That storage must be synchronous, which on React Native rules out AsyncStorage.
- **Never resend after a lost connection.** The original may have gone out. Recover by query, and treat anything unresolved as unknown.
- **Show the real outcome.** Message state is `receiving`, `queued`, `transmitted`, `acknowledged`, `failed`, `rejected` or `unknown`. `transmitted` is not delivery, and `acknowledged` means the destination node received it, not that anyone read it.
- **Encryption stays in the app.** Devices carry ciphertext only and never see keys. See [Channel encryption](encryption.md).

`packages/agent-core` and `packages/protocol` are the TypeScript implementation the web portal uses, so read them for the exact behavior. `packages/protocol/fixtures/messages-v1.json` lists messages with their exact bytes, to check your own codec against.

## Permissions

- **iOS:** set `NSBluetoothAlwaysUsageDescription` in `Info.plist`.
- **Android 12 and later:** declare and request `BLUETOOTH_SCAN` and `BLUETOOTH_CONNECT`.
- **Android 11 and earlier:** declare `BLUETOOTH`, `BLUETOOTH_ADMIN` and `ACCESS_FINE_LOCATION`, with `android:maxSdkVersion="30"`.

## Behavior to design for

- **Choosing a network.** Since firmware `v0.8.0` a radio sends nothing until a network is chosen, and radio status reports `network-not-chosen`. Check feature bit 14, read `networkStatus`, and send `networkFill` with Open mode or team keys, which needs USB or the window opened with the button. A team radio also needs `teamLoad` after each reboot, and reports `team-key-needed` until then. See [Radio network](../reference/protocol.md#radio-network-d50). Never store these keys in a journal or a log.
- **Key rotation.** Since firmware `v0.10.0` a team's keys rotate (D52), and an app on a team has to keep up: `networkFill` needs the epoch proof, and teams are recognized by `proof` because fingerprints change every epoch. Team codes are now `RMTEAM2`. `packages/agent-core/rotation.ts` holds the logic, and the [web portal](web-portal.md#radio-network) shows it in use. See [Radio network](../reference/protocol.md#radio-network-d50).
- **Status LED.** Since firmware `v0.11.0` a device with feature bit 17 has an on/off setting, `ledEnabled`. An app can leave it out of a configure, which keeps the device's value. See [Status LED setting](../reference/protocol.md#status-led-setting-d53).
- One host at a time. The newest `hello` takes over, and opening the USB port resets the board, which drops your link.
- Expect lost connections. A connection that is not trusted within 5 seconds is dropped, or 60 seconds while pairing is open.
- A device holds four paired phones. A full list refuses new pairings until the user holds the button for 15 seconds, which forgets them all and changes the device's Bluetooth address.
- **Background delivery.** Firmware `v0.9.0` can alert an app that asked for it in `hello`, which is what lets iOS wake a background app. The app side has not been built or tested, and iOS and Android both limit Bluetooth in the background. See [Agent features, payloads and inbox alert](../reference/protocol.md#agent-features-payloads-and-inbox-alert-d50) and [Background delivery](../contributing/security-architecture.md#background-delivery-to-the-phone).
- **Unknown payloads.** Before declaring `agentFeatures` bit 1, make sure the app keeps reading its inbox past bytes it cannot read. Until then, the device sends such messages as the text `Unsupported message`.
