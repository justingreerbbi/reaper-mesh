"""Read-only, chunked backup for the verified ESP32-S3/8MB development board.

Uses the ESP-IDF-pinned esptool environment; never erases or writes flash.
The ROM loader temporarily resets the running application and uses a RAM stub.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal

from esptool.targets.esp32s3 import ESP32S3ROM
import serial


def timeout(_signal, _frame):
    raise TimeoutError("read-only backup operation exceeded 30 seconds")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--resume", action="store_true", help="revalidate and reuse a partial backup")
    args = parser.parse_args()
    output = args.output.resolve()
    if output.exists():
        raise FileExistsError("backup destination already exists")
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    partial = output.with_suffix(output.suffix + ".partial")
    flags = os.O_RDWR | (0 if args.resume else os.O_CREAT | os.O_EXCL)
    descriptor = os.open(partial, flags, 0o600)
    signal.signal(signal.SIGALRM, timeout)
    size = 0x800000
    erased = b"\xff" * 0x10000
    erased_md5 = hashlib.md5(erased).hexdigest()
    # Open at the verified baud without an intermediate baud configuration.
    port = serial.serial_for_url(args.port, baudrate=115200, exclusive=True, do_not_open=True)
    with os.fdopen(descriptor, "r+b") as destination, port:
        rom = ESP32S3ROM(port, 115200)
        signal.alarm(30)
        rom.connect()
        stub = rom.run_stub()
        stub.flash_spi_attach(0)
        flash_id = stub.flash_id()
        if 1 << ((flash_id >> 16) & 0xff) != size:
            raise ValueError("device flash size differs from verified 8MB target")
        stub.flash_set_parameters(size)
        device_mac = ":".join(f"{value:02x}" for value in stub.read_mac())
        try:
            for offset in range(0, size, 0x10000):
                signal.alarm(30)
                digest = stub.flash_md5sum(offset, 0x10000).lower()
                destination.seek(offset)
                previous = destination.read(0x10000)
                if len(previous) == 0x10000 and hashlib.md5(previous).hexdigest() == digest:
                    block = previous
                elif digest == erased_md5:
                    block = erased
                else:
                    block = stub.read_flash(offset, 0x10000)
                if len(block) != 0x10000:
                    raise ValueError(f"short flash read at 0x{offset:x}")
                if hashlib.md5(block).hexdigest() != digest:
                    raise ValueError(f"chunk digest differs from device at 0x{offset:x}; partial backup is invalid")
                destination.seek(offset)
                destination.write(block)
                destination.flush()
                print(f"Read {offset + len(block)} / {size} bytes", flush=True)
            destination.flush()
            os.fsync(destination.fileno())
            signal.alarm(30)
            destination.seek(0)
            complete = destination.read()
            if len(complete) != size or stub.flash_md5sum(0, size).lower() != hashlib.md5(complete).hexdigest():
                raise ValueError("complete device digest differs from backup")
        finally:
            signal.alarm(10)
            try:
                stub.hard_reset()
            finally:
                signal.alarm(0)
    os.link(partial, output)  # Exclusive finalization: never replace an existing backup.
    partial.unlink()
    metadata = {"size": size, "sha256": hashlib.sha256(complete).hexdigest(), "device_md5_verified": True,
                "chip": "esp32s3", "device_mac": device_mac, "baud": 115200, "chunk_size": 65536}
    meta_fd = os.open(output.with_suffix(".json"), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(meta_fd, "w") as record:
        json.dump(metadata, record, indent=2)
        record.write("\n")
    print("Complete backup verified and saved privately.")


if __name__ == "__main__":
    main()
