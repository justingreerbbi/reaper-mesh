"""Opt-in physical USB smoke check; changes label/region and resets the board."""

import argparse
import serial, json, time, struct, zlib, sys
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--port", required=True)
parser.add_argument("--confirm-write", action="store_true", required=True)
args = parser.parse_args()
schema = json.loads(Path("packages/protocol/schema.json").read_text())


def cobs(raw):
    out = bytearray([0])
    start = 0
    code = 1
    for b in raw:
        if b == 0:
            out[start] = code
            start = len(out)
            out.append(0)
            code = 1
        else:
            out.append(b)
            code += 1
            if code == 255:
                out[start] = code
                start = len(out)
                out.append(0)
                code = 1
    out[start] = code
    return out + b"\0"


def decode(data):
    raw = bytearray()
    i = 0
    while i < len(data):
        n = data[i]
        i += 1
        if not n or i + n - 1 > len(data):
            raise ValueError("COBS")
        raw.extend(data[i : i + n - 1])
        i += n - 1
        if n < 255 and i < len(data):
            raw.append(0)
    if len(raw) < 12 or raw[:4] != b"RM\1\0":
        raise ValueError("header")
    if zlib.crc32(raw[:-4]) != struct.unpack("<I", raw[-4:])[0]:
        raise ValueError("CRC")
    p = raw[6:-4]
    if len(p) != struct.unpack("<H", raw[4:6])[0] or p[0] != 1:
        raise ValueError("length")
    kind = next(k for k, v in schema.items() if v["tag"] == p[1])
    fields = list(schema[kind]["fields"].items())
    msg = {"type": kind}
    i = 2
    while i < len(p):
        tag = p[i]
        n = struct.unpack("<H", p[i + 1 : i + 3])[0]
        i += 3
        value = p[i : i + n]
        i += n
        name, typ = fields[tag - 1]
        msg[name] = struct.unpack("<I", value)[0] if typ.rstrip("?") == "u32" else value.decode()
    return msg


def send(s, msg):
    d = schema[msg["type"]]
    p = bytearray([1, d["tag"]])
    for i, (name, typ) in enumerate(d["fields"].items(), 1):
        if name not in msg:
            continue
        b = struct.pack("<I", msg[name]) if typ.rstrip("?") == "u32" else msg[name].encode()
        p.extend(bytes([i]) + struct.pack("<H", len(b)) + b)
    raw = b"RM\1\0" + struct.pack("<H", len(p)) + p
    s.write(cobs(raw + struct.pack("<I", zlib.crc32(raw))))
    s.flush()


def receive(s):
    until = time.monotonic() + 5
    buf = bytearray()
    while time.monotonic() < until:
        b = s.read(1)
        if b == b"\0":
            if buf:
                try:
                    return decode(buf)
                except (ValueError, StopIteration, IndexError, struct.error):
                    buf.clear()
        elif b:
            buf.extend(b)
    raise TimeoutError("No valid device reply")


def openport():
    s = serial.Serial(port=None, baudrate=115200, timeout=0.1, exclusive=True)
    s.dtr = False
    s.rts = False
    s.port = args.port
    s.open()
    return s


owner = "smoke-" + str(time.time_ns())


def sync(s, link):
    s.write(b"\0")
    send(s, dict(type="hello", link=link, minVersion=1, maxVersion=1, owner=owner))
    w = receive(s)
    assert w["type"] == "welcome", w
    send(s, dict(type="sync", link=link, boot=w["boot"], request=1))
    v = receive(s)
    assert v["type"] == "snapshot", v
    return w, v


s = openport()
time.sleep(2)
w, v = sync(s, "smoke-A")
print("Handshake and snapshot passed", flush=True)
send(
    s,
    dict(
        type="configure",
        link="smoke-A",
        boot=w["boot"],
        id=owner + ":1",
        expectedRevision=v["revision"],
        region="US",
        label="Reaper hardware test",
    ),
)
r = receive(s)
assert r["type"] == "result" and r["outcome"] == "committed", r
print("NVS configuration commit passed", flush=True)
w2, v2 = sync(s, "smoke-B")
assert (
    w2["boot"] == w["boot"]
    and v2["label"] == "Reaper hardware test"
    and v2["revision"] == r["revision"]
)
send(s, dict(type="query", link="smoke-B", boot=w2["boot"], id=owner + ":1"))
q = receive(s)
assert q["outcome"] == "committed", q
print("Logical reconnect, snapshot and retained receipt query passed", flush=True)
s.close()
s = openport()
time.sleep(2)
w4, v4 = sync(s, "smoke-reopen")
assert v4["label"] == v2["label"] and v4["revision"] == v2["revision"]
print("Serial reopen passed; boot changed:", w4["boot"] != w2["boot"], flush=True)
s.rts = True
time.sleep(0.1)
s.rts = False
time.sleep(2)
s.reset_input_buffer()
w3, v3 = sync(s, "smoke-C")
assert w3["boot"] != w["boot"] and v3["label"] == v2["label"] and v3["revision"] == v2["revision"]
print("Hardware reset: fresh boot identity and persisted configuration passed", flush=True)
s.close()
Path("build/heltec-v3/hardware-smoke.json").write_text(
    json.dumps(
        {
            "handshake": True,
            "commit": True,
            "serial_reopen": True,
            "receipt_query": True,
            "reset_persistence": True,
            "revision": v3["revision"],
            "radio_tested": False,
            "browser_tested": False,
        },
        indent=2,
    )
    + "\n"
)
