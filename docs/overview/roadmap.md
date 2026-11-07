# Roadmap

Last updated: November 7, 2026. This is the list of what comes next, in order. Finished work
is removed from this page; see [Status](status.md) for what works today and the
[changelog](changelog.md) for when it shipped.

## Current focus: prove it in the field

Before adding features, Reaper Mesh has to prove its radio core works with more than two
boards and outside the lab. Results from these tests could still change the radio protocol,
which is cheaper to do now than after more features depend on it.

Until relay and range testing pass, new web portal features are paused. Portal work is limited
to bug fixes, testing on real devices, and keeping the portal in step with the mobile app
(D49), including team setup (D51) and key rotation controls (D52).

## Next, in order

1. **Get a third board** (a second US/915 Heltec V3 is simplest) and build the three-board
   relay test tool. Phase 4 device work continues while waiting.
2. **Three-node relay test.**
3. **Outdoor range test.**
4. **Power-loss, interrupted-flash and 24-hour soak tests.**
5. **Rekey and relay status** (security step 2b), with portal controls. The protocol freeze
   depends on it. See the [rotation and rekey design](../contributing/rotation-design.md).
6. **Core v1 protocol review.** Use the test results to decide what to freeze: the content
   types carried in opaque payloads (Q5), fragment and message size (Q3), and which prototype
   compatibility layers to remove. With owner approval, reflash the boards, reset the fixtures
   to the new baseline and declare core v1 (D41, D42).
7. **Resume feature work** on top of core v1, in agents and plugins (below).

## Planned after core v1

### Messaging and map portal (Phase 2.3)

- Per-channel **auto-add** for shared map items, and an explicit channel choice when sharing
  (D43).
- One coherent pass over the map tools, which still feel unfinished end to end, including
  touch drawing.
- Choosing between several connected boards (needs per-device journaling first).

### Security (D50 steps 3 to 7)

- Background delivery to the mobile app.
- Device identity and private direct messages.
- Channel key rotation.
- Full team flows in the portal, including removing a member.
- Host key and release hardening, then an independent security review.

### Device (Phase 4)

- Check the Heltec's page gestures on hardware.
- Processor sleep modes that save real battery without missing radio traffic.
- Battery measurement accuracy checked against a meter.

### Platform

- **Code plugins** that run in sandboxed iframes, for integrations such as weather radar,
  ADS-B and APRS. These wait for an approved design of the plugin message API and permissions
  (D40).
- **GPS** on the T-Beam, when the owner reopens it. Fixed positions cover location until then.
- **Releases:** signed firmware, automatic rollback, a guided browser installer and a published
  support policy.
- **More regions and boards:** EU support needs verified hardware, countries and settings
  before any transmission.

## Phases

The owner set four product phases on November 1, 2026. Phase completion records a milestone;
it never waives a security, hardware or release gate.

| Phase | Outcome | What is left |
| --- | --- | --- |
| 1 — Working communications | Supported boards communicate reliably through the Reaper protocol | Relay, range, power-cut and field qualification (above) |
| 2 — Discovery and field portal | Know who has been heard, where they report being, and message them | GPS (deferred) and the portal work above, after qualification |
| 3 — Encrypted channels | Apps encrypt; boards route ciphertext without keys. D50 extends this to trusted devices | Channel rotation, the remaining D50 steps and a security review |
| 4 — Device presentation and power | Useful on-device status | Sleep modes and hardware checks |

## Rules that apply to every phase

- **Build at the edges.** New features go in apps and plugins. A firmware or protocol change
  needs a stated reason why an app or plugin cannot do it (D41). Board-only features such as
  screen layout must not change the radio protocol.
- **Build each feature top to bottom:** contract and tests, firmware, shared agent core, then
  the interface. A feature is not done when only its interface or the simulator works.
- **Out of scope** without a new decision: broad telemetry, MQTT, cloud accounts, Wi-Fi
  networking, voice and remote administration.
- **Privacy defaults off.** Beacons, discovery replies and location sharing start off, and GPS
  hardware alone never authorizes broadcasting a position.
- **Battery levels come from real measurements.** Never invent a percentage on hardware that
  cannot measure one.
