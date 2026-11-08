# Field qualification plan

This plan supports parked question Q8 in [Decisions](decisions.md#parked-questions): how to verify
three-node relay, range, power loss and long-running behavior on real hardware. Until these
tests pass, new portal features are paused (decision D37). Detailed results go in the
pull request, a summary in the [Changelog](../overview/changelog.md), and [Status](../overview/status.md) is updated in place.

Every test here transmits. Use only the US/915 boards with their antennas attached, the
configured `US915_LAB1` preset and the configured power. Never transmit with no antenna or
load connected.

## What the radio settings mean for testing

`US915_LAB1` is a lab preset tuned for speed, not range: 915 MHz, 500 kHz bandwidth, spreading
factor 7, coding rate 4/5, at low, medium or high power ([levels per board](../reference/radio-configuration.md#transmit-power)). Range results
describe this preset only. A long-range preset would be a separate radio protocol decision.

The firmware's airtime budget refills at 1% per second with a one-second burst. Using the
firmware's airtime formula, a full 1,024-byte message (7 fragments) takes about 0.56 s of
airtime, so each node can send roughly one full-size message per minute after its first
burst. A relay spends its own budget on every fragment it forwards. Plan message counts and
test durations around this limit, or use short messages for delivery-rate runs.

## Hardware needed

- **A third board.** A second US/915 Heltec V3 is the simplest choice, because it runs the same
  image as a board that already passes the two-board tests. Any third supported board works. A new
  board needs a first install (see [Flashing firmware](../guides/flashing-firmware.md)), its region
  set and its antenna confirmed, and a network chosen, because a radio sends nothing until one is.
- An antenna for every board.
- One computer with three USB ports for the bench test. The browser agent handles one device
  at a time, so the tests use command-line tools, like `tools/hardware-pair-smoke.ts` does
  for two boards.
- Optional: inline RF attenuators or a shielded box, to separate nodes on a bench without
  long distances.

## 1. Three-node relay

**Goal:** prove that A delivers to C through B when A and C cannot hear each other.

On a bench, all three boards hear each other, so messages go direct and the relay path is
never exercised. The test therefore needs a topology where A and C are out of range of each
other but both are in range of B. Ways to get there, simplest first:

1. Low transmit power on all boards, with A and C in separate rooms or floors and B
   between them.
2. Attenuators on A and C, or A and C in shielded enclosures.
3. Outdoors, with A and C far enough apart (see the range test).

**On a desk:** the relay test build (D56) makes A and C ignore every frame heard straight from its
sender, so they can only hear each other through B. Build it for A and C, install it, leave B on
normal firmware, put all three in the same Open network, and run:

```sh
REAPER_RELAY_TEST=1 bash tools/build-firmware.sh tbeam-v12
.tools/espressif/python_env/idf5.5_py3.12_env/bin/python tools/update-firmware.py \
  --manifest build/tbeam-v12-relay-test/reaper-manifest.json --flash --port PORT_A
node tools/hardware-relay-smoke.ts .tools/espressif/python_env/idf5.5_py3.12_env/bin/python \
  PORT_A PORT_B PORT_C
```

The tool runs the control run, short and 1,024-byte direct messages both ways, and a broadcast
each way, records every result and the relay's transmit count in `build/relay-smoke.json`, and
restores each board's radio settings. Reinstall normal firmware on A and C afterwards. This tests
the relay logic over real radios; the separated-boards test below is still needed for range.

**Procedure**

1. Configure all three boards: same network, mesh mode, same channel, same power. B has relay
   enabled; A and C have relay disabled. Run this once in Open mode and once on a team, with B
   also tried holding only the relay key.
2. **Control run:** disable relay on B. Send 10 short unicast messages from A to C. Expected:
   no destination ACKs, which shows A and C cannot hear each other directly. If any message is
   acknowledged, the nodes are too close; increase separation and repeat.
3. **Relay run:** enable relay on B. Send 10 short unicast messages and 3 full 1,024-byte
   messages from A to C, spaced for the airtime budget.
4. Repeat steps 2–3 from C to A.
5. Send 3 broadcasts from A and confirm C receives them through B.

**Pass criteria**

- The control run gets no ACKs, and the relay run gets destination ACKs from C.
- C's inbox holds each message exactly once with the exact body and origin A.
- B's transmit counter rises by roughly the forwarded fragments plus ACKs, and does not keep
  rising after traffic stops (no relay loop).
- No message is reported acknowledged without arriving; failures are reported as failed or
  unknown.
- Record the delivery rate, ACK latency and any retries for each run.
- Rotate keys during a relay run (D52). Messages keep arriving through B, B forwards the epoch proof, and A and C both reach the new epoch. Leave B unpowered across a rotation, then confirm it catches up and forwards again.

**Results so far (Nov 8, desk, Open mode):** T-Beam V1.2 and Wireless Stick V3 as ends, WiFi LoRa
32 V3 as relay. The first run found that 1,024-byte messages never crossed the relay: the origin
sent each fragment as soon as the last finished, so the relay was still forwarding one when the
next arrived, and missed it the same way every round. Origins now wait after each fragment for
relays to forward it ([radio protocol](../reference/radio-protocol.md)). After the fix, two runs
passed every check: nothing passes with relaying off; one-frame and 1,024-byte direct messages are
acknowledged both ways through the relay, each delivered exactly once with the exact body, with
the relay sending exactly 8 frames per full message (7 fragments and the ACK) on the first round;
broadcasts arrive once both ways. Full-size messages are spaced 70 s apart for the airtime budget;
back to back, the relay's budget runs out partway through the second. Team mode, a
relay-key-only relay, key rotation through a relay, more than one relay, and the
separated-boards run are not done.

## 2. Outdoor range

**Goal:** measure direct delivery against distance for `US915_LAB1`, and find where relaying
becomes necessary.

**Procedure**

1. Pick an open, line-of-sight route. Note antenna height, weather and obstructions.
2. Keep one board fixed. Move the other in steps (for example 50 m, 100 m, 200 m, then
   further until delivery fails), recording each distance with a phone GPS or a map.
3. At each step send 10 short unicast messages and 1 full 1,024-byte message, and record ACKs,
   failures and latency.
4. Repeat at the lowest and highest configured power.
5. If a third board is available, place it at the edge distance and repeat a relay run.

**Record:** distance, power, delivery rate, ACK latency, retries, failure states, and the
environment. A missing ACK is not proof that the message was lost; check the receiver's inbox.

## 3. Power loss and interrupted flashing

- Cut power during a settings save, during a message upload and during reception. After
  power returns: settings match either the old or new committed revision, unfinished work
  shows as unknown, and nothing is resent automatically.
- Interrupt a firmware install at several points. The documented ROM recovery route must
  restore the board without erasing NVS.

## 4. Soak

Run two or three boards for at least 24 hours with periodic beacons and a message every few
minutes (within the airtime budget). Record heap and stack headroom at start and end, any
reconnects, timeouts or driver errors, and the delivery rate. Watch for the transient
observations already listed in [Status](../overview/status.md#known-hardware-quirks).

## After qualification

When the relay and range tests pass, update Status and the Changelog. Review whether any
result changes the radio protocol (fragment size, retries, airtime or presets) before new
features build on it. Then resume portal work on the roadmap.
