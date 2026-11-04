#!/usr/bin/env python3
"""Bluetooth test client for explicitly invoked physical checks; needs the bleak package.

--scan SECONDS prints each advertising Reaper device as a JSON line and exits. Otherwise this
connects to the first Reaper device (or --name), reads the protected characteristic so the
operating system pairs first, prints "ready" on stderr and then relays raw bytes between
stdin and stdout, like a serial port.
"""

import argparse
import asyncio
import json
import sys
import threading

from bleak import BleakClient, BleakScanner


def uuid(part):
    return f"5d7e00{part}-8b3a-4f6c-9e21-3c1a7f42b9d0"


SERVICE, INPUT, OUTPUT, PAIR = uuid("01"), uuid("02"), uuid("03"), uuid("04")


def status(message):
    sys.stderr.write(message + "\n")
    sys.stderr.flush()


async def scan(seconds):
    found = await BleakScanner.discover(timeout=seconds, service_uuids=[SERVICE], return_adv=True)
    for device, advert in found.values():
        print(
            json.dumps(
                {"address": device.address, "name": advert.local_name, "rssi": advert.rssi},
                sort_keys=True,
            )
        )


async def find(name, seconds):
    def matches(_device, advert):
        return SERVICE in advert.service_uuids and (not name or advert.local_name == name)

    device = await BleakScanner.find_device_by_filter(matches, timeout=seconds)
    if device is None:
        raise SystemExit("no Reaper device advertising")
    return device


async def relay(name, seconds):
    loop = asyncio.get_running_loop()
    outgoing = asyncio.Queue()
    lost = asyncio.Event()

    def read_stdin():
        while True:
            data = sys.stdin.buffer.read1(4096)
            loop.call_soon_threadsafe(outgoing.put_nowait, data)
            if not data:
                return

    device = await find(name, seconds)
    client = BleakClient(device, disconnected_callback=lambda _client: lost.set(), timeout=30)
    await client.connect()
    try:
        status(f"connected {device.address}")
        version = await client.read_gatt_char(PAIR)
        status(f"authenticated version {version[0]} mtu {client.mtu_size}")

        def received(_characteristic, data):
            sys.stdout.buffer.write(data)
            sys.stdout.buffer.flush()

        await client.start_notify(OUTPUT, received)
        threading.Thread(target=read_stdin, daemon=True).start()
        status("ready")
        chunk = max(20, client.mtu_size - 3)
        while not lost.is_set():
            waiter = asyncio.ensure_future(outgoing.get())
            done, _ = await asyncio.wait(
                [waiter, asyncio.ensure_future(lost.wait())], return_when=asyncio.FIRST_COMPLETED
            )
            if waiter not in done:
                waiter.cancel()
                break
            data = waiter.result()
            if not data:
                break
            for start in range(0, len(data), chunk):
                await client.write_gatt_char(INPUT, data[start : start + chunk], response=True)
    finally:
        if client.is_connected:
            await client.disconnect()
    status("closed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scan", type=float)
    parser.add_argument("--name")
    parser.add_argument("--find-seconds", type=float, default=30)
    options = parser.parse_args()
    if options.scan is not None:
        asyncio.run(scan(options.scan))
    else:
        asyncio.run(relay(options.name, options.find_seconds))


if __name__ == "__main__":
    main()
