# Security architecture

Status: **Confirmed** by the owner on November 4, 2026 (D50). This is the agreed direction. What is
built so far is in [Status](../overview/status.md), and until each step ships,
[Channel encryption](../guides/encryption.md) and the
[specification](../overview/project-specification.md#7-security-privacy-and-trust) describe how the
system behaves. This design has not had an independent security review, and no release may claim it
until it has. Byte counts are design estimates, and no timing or airtime has been measured. The
relay-only design and background delivery are the newest parts and have had the least scrutiny.

## Goal

Reaper Mesh is a network of trusted devices. A radio that was not set up by the team should not
be able to read, inject or relay traffic, or locate team members from their broadcasts. A team may
still choose to run openly, and the protection must not make everyday use harder than it has to be.

## Owner direction

These came from the owner on November 4 and shape the design.

- A radio with no app attached does not beacon. Most radios will be relays that report nothing.
- Encryption networking stays optional, and a team can keep using today's channel keys.
- Setup and daily use must stay simple in the web portal and the mobile app.
- A phone with the app closed or unfocused should still be able to receive messages from its radio.

## What is exposed today

These points come from the current code, not from a test against a live attacker.

| Exposure | Where | Consequence |
| --- | --- | --- |
| The 54-byte radio header is plaintext | [`radio_packet.cpp:89`](../../firmware/components/reaper_mesh/radio_packet.cpp) | Anyone can see who talks to whom, on which channel and how often, even when the message body is encrypted |
| Beacons and presence replies carry the name and position in plaintext | [`discovery.cpp:105`](../../firmware/components/reaper_device/discovery.cpp) | Anyone in range can read the position |
| A discovery request from anyone gets a reply | [`discovery.cpp:239`](../../firmware/components/reaper_device/discovery.cpp) | With respond and sharing on, an outsider can ask a radio where it is |
| Node reports are accepted without authentication | [`discovery.cpp:168`](../../firmware/components/reaper_device/discovery.cpp) | An outsider can add false nodes and positions, and push real nodes out of the 32-entry table |
| ACKs are accepted without authentication | [`mesh.cpp:134`](../../firmware/components/reaper_mesh/mesh.cpp) | An outsider can mark an undelivered message as delivered |
| The channel ID is the only admission check | [`mesh.cpp:130`](../../firmware/components/reaper_mesh/mesh.cpp) | The ID is visible on air, so an outsider can inject on a channel and use its relays |
| Direct messages use the channel key | [`encryption.md`](../guides/encryption.md#key-management-and-operation) | Every channel member can read and forge them |
| Rotation means a new random key, shared by hand | [`encryption.ts:305`](../../agents/web/encryption.ts) | Rotation is rare in practice, and old keys are kept forever, so there is no forward secrecy |
| Keys and settings are unencrypted in flash, and a USB host has full access | D12, D47 | A stolen radio gives up everything it stores |

## The core decision

D33 says devices never hold keys. That rule cannot deliver the goal, because firmware decides what
to relay and writes the radio header, and an agent cannot protect either of those. An agent-only
design leaves relays open to outsiders and headers readable.

A relay does not need to read traffic, though. It only has to check that a frame belongs to the
team, drop duplicates and forward it. So the network protection splits into two keys, and channel
and direct-message keys still never reach a radio.

| Layer | Key | Held by | Allows or protects | Keeps out |
| --- | --- | --- | --- | --- |
| Admission | Relay key | Every radio, in flash | Checking that a frame belongs to the team, and forwarding it. It reveals no traffic | Outsiders using the relays |
| Team | Team key | Agents, and loaded into the radio's memory by its agent | Headers, beacons, positions and ACKs | Anyone outside the team, including someone holding only a relay |
| Channel | Channel key (exists today) | Agents of channel members | Channel messages | Team members outside the channel, and the radios |
| Direct | Pairwise keys from each person's identity key | The two agents | Direct messages | Everyone else, including other team members |

Each radio also holds a unique **device key** in flash, so the authority can reach that one radio.

**A radio is a relay unless a person's agent has loaded the team key.** The team key lives in memory
only, is written by the agent over USB or a bonded Bluetooth link, and stays until the radio
reboots.

| A stolen radio that is | Gives up |
| --- | --- |
| Powered off, or an unattended relay | The relay key and its own device key. The thief can inject junk that relays forward until the team rekeys, but cannot read positions, headers or messages |
| Still running after its agent loaded the team key | Also the team key, which exposes team traffic details and beacons. Message bodies still need the phone or browser |

**The trade-off.** A radio that reboots while its phone is away acts as a relay. It forwards messages
addressed to it but cannot store them, so those messages are missed, and senders see no ACK.

Bluetooth Mesh separates network, application and device keys in a similar way, and it is a useful
reference for review.

## Open mode and setup

Encryption networking is optional. **Open mode** uses the same frame and code, with published
constants for the relay and team keys, so there is no plaintext branch to downgrade into.

- **Keeps today's keying.** Channels, `RMCH1` invites, channel keys and plaintext channels work as
  they do now.
- **Needs one reflash.** The radio format changes for everyone, once.
- **Adds no new protection.** Headers, beacons and ACKs stay readable and forgeable, and the
  interface labels this **Open: anyone can read this**. Direct messages stay on the channel key.

A radio out of the box stays silent until someone chooses a mode. Radios already stay off until
configured, so this adds one choice at the point where the region is set.

The authority, roster and rotation run out of sight in team mode, so the operator sees this:

| Action | What the operator does |
| --- | --- |
| First setup | Chooses **Create team**, **Join team** or **Open** |
| Create a team | Types a name. Their agent quietly becomes the authority |
| Add a person | The creator shows a QR code, the new person scans it and the creator taps approve |
| Add a relay | Connects it to the creator's agent and taps **Add as relay** |
| Channels | Same as today |
| Direct messages | Just send them. The roster verifies the other person automatically |
| Rotation | Nothing, it is automatic |
| Lost radio or phone | Taps **Remove** |

The complexity moves into the agents, and it does not disappear. The web portal and the separately
built mobile app (D48) both implement this. They must explain new failure states, such as a relay
that missed a rekey, or an Open radio and a team radio that cannot hear each other. Replacing a phone
means joining the team again, unless its keys were backed up.

## The root of trust

**No exchange over the radio alone can rule out a man in the middle.** Two strangers with only an
open channel have no way to tell whether the key they received came from the other person or from
an attacker. Trust has to start from something the attacker cannot touch, and the project already
has that: setting up radios in person.

- **Authority.** Each team has one signing key (Ed25519), held in the agent of the person who creates
  the team. This matches the role of a military key custodian with a fill device.
- **Fill.** The authority loads a radio in person, over USB or over Bluetooth during a window opened
  with the physical button. It writes the relay key and the unique device key. Keys are write-only:
  no USB or Bluetooth command can read them back, and agents see only the generation, epoch and a
  fingerprint.
- **Identity.** Each operator's agent generates a signing key and a Diffie-Hellman key (X25519).
  The private keys stay in the agent. A second agent for the same operator receives them through a
  protected local transfer.
- **Roster.** The authority signs a member record binding name, node ID and public keys. Members
  carry the authority's public key and their own signed copy of the roster, so any two members can
  verify each other without having met. Roster changes are small signed updates that may safely
  travel over the radio, because tampering breaks the signature.
- **Without an authority.** Two people can scan each other's QR codes, as with a Signal safety
  number. Both routes end in the same state: a verified public key. An unverified key is never used
  silently.

The firmware verifies no signatures and does no public-key cryptography. The device key lets the
authority address one radio using symmetric cryptography only.

### When the authority is unreachable

The authority is like a notary, not a server. Nothing asks it for permission during normal use, so
losing it freezes membership and does not stop communications.

| With the authority unreachable | Works? |
| --- | --- |
| Relaying, channel messages and direct messages | Yes |
| Automatic key rotation | Yes, no coordination is needed |
| Verifying existing members | Yes |
| Channel owners rekeying their own channels | Yes |
| Two people adding each other by QR scan | Yes, but only between those two |
| Adding someone to the team roster | No |
| Removing a lost radio or person from the team | No |

Two safeguards cover the last two rows:

- **Deputy, for when the authority is away.** The authority signs one or more named deputies into the
  roster, and they can add and remove members. The authority outranks a deputy, and generation numbers
  carry that rank, so two rekeys cannot leave the team permanently split. Each deputy holds copies of
  the radios' device keys, which makes a deputy's phone nearly as valuable as the authority's.
- **Sealed backup, for when the authority is destroyed.** An encrypted copy of the authority key, kept
  somewhere physically safe.

With no deputy and no backup, the team keeps running as it is, but changing membership means setting
up every radio again in person.

## Radio frames: version 2

This replaces radio version 1 outright, with no compatibility layer (D42).

| Part | Fields | Protected by | Estimated bytes |
| --- | --- | --- | --- |
| Clear | Version, rotating network hint, epoch, hops and hop limit, nonce | Relay tag, except current hops | 14 |
| Encrypted | Kind, channel, source, destination, boot counter, sequence, fragment fields, length | Team key | 32 |
| Team tag | AES-CCM authentication tag | Team key | 8 |
| Relay tag | Truncated HMAC-SHA-256 over everything but current hops | Relay key | 4 |

- **Size.** About 58 bytes against 54 today, because the 16-byte boot nonce and the CRC-32 are no
  longer needed. Shortening node IDs to 4 bytes would give about 50. Settle this together with Q3.
- **Relay behavior.** A radio with only the relay key checks the relay tag, suppresses duplicates on
  the nonce, decrements hops and forwards. It cannot tell a message from an ACK, so forwarding treats
  them the same.
- **Short relay tag.** Four bytes is a deliberate choice for review. A successful forgery only gets
  one junk frame forwarded, and an attacker pays airtime for each try. Team radios still reject that
  frame on the team tag.
- **Cipher.** Both chips accelerate AES and SHA, and `CONFIG_MBEDTLS_CCM_C` is already on. The exact
  construction is in the [radio protocol](../reference/radio-protocol.md#frame).
- **Hops** stay outside the relay tag because relays change them. The hop limit is covered by the
  tag, so an attacker cannot raise hops above what the sender allowed.
- **Nonces** come from a random generator seeded with true entropy at boot.
  [`main.cpp:94`](../../firmware/app/main.cpp) already enables that entropy source for the boot
  nonce. Confirm the details against the pinned ESP-IDF documentation.
- **Replay.** The persisted boot counter and the sequence give each sender an increasing identity,
  and a captured frame stops working when its epoch key is erased.
- **Relaying.** A radio relays any frame with a valid relay tag, including channels it has not joined,
  because channel content stays encrypted end to end. This changes D45, and it removes relay gaps
  caused by channel membership.
- **Public** is channel 0 inside a team, readable by the whole team. One team per radio in core v1;
  the hint leaves room for more later without changing the format.

### Beacons and relay health

- **Beacons** are normal frames under the team key, and only go out while an agent is attached. The
  off-by-default rule for beaconing and location sharing does not change. All team members can see a
  shared position. To share with a subset, an agent sends the position as a channel message instead.
- **Attached** means a trusted Bluetooth connection is up, or USB traffic arrived within the last 8
  seconds. After an agent attaches, the first beacon waits one configured interval, so a link that keeps
  dropping delays beacons.
  Focus does not matter, so a backgrounded phone that is still connected keeps its radio operating
  normally. The existing [`HostLinks::ready`](../../firmware/components/reaper_device/host_links.cpp)
  check cannot define this over Bluetooth, because it goes false after 8 seconds without a reply and
  a background app does not ping that often.
- **Discovery** also needs the team key, so relays never answer it. Only team members can ask.
- **Relay health.** Relays report nothing on their own. The authority or a deputy can ask one relay
  for its status with a small management frame under that radio's device key, with bounded replies.
  This matters most before a rekey.
- **Standalone trackers.** A GPS radio reporting with no phone does not work by default. If that is
  wanted later, it can be an explicit role with the team key stored on the radio, using the same frame
  format. GPS remains deferred (D26).

## Rotation: two separate mechanisms

A key fob uses a shared secret and a counter, and the receiver catches up if the fob has moved ahead.
That maps directly to a hash ratchet, and it is the right tool for automatic rotation. It has one
limit that matters: **whoever holds today's key can compute every future key**, so it cannot remove
anyone. Removal needs a second mechanism.

The [rotation and rekey design](rotation-design.md) is a draft for building this. It proposes changes
to the rules below, because a stolen relay key could use them to strand relays. Until the owner
decides ([Q13](decisions.md#open-questions)), this section stands.

| | Ratchet (the fob) | Rekey (over-the-air rekeying) |
| --- | --- | --- |
| Happens | Automatically on a schedule | When the authority, a deputy or a channel owner orders it |
| Radio traffic | None | One wrapped key per remaining member |
| Protects against | Someone who captures a key later reading older recordings, once old keys are erased | A lost, stolen or removed member reading anything from then on |
| Removes a member | No | Yes |
| Offline member | Catches up alone with no help | Must be reached again, or refilled in person |

### Ratchet

`key(generation, epoch + 1) = KDF(key(generation, epoch))`. The chain has one possible path, so
members cannot fork. The relay and team keys ratchet as separate chains that share one epoch number.
The rules are the same on every layer:

1. Agents advance on a schedule from their own clock. The boards have no battery-backed clock, so
   firmware never decides time. A connected agent tells its radio to advance.
2. The highest authenticated epoch wins. A radio that hears a valid frame from a newer epoch derives
   forward and follows it. This is how unattended relays keep up, and how separated groups converge
   when they meet again.
3. A frame moves a receiver forward only after its tag verifies. The look-ahead is bounded and rate
   limited, so junk frames cannot burn CPU, and it is large enough for a relay that was off for months.
4. Radios keep the current and previous epoch only. A sender that is further behind is dropped, then
   hears newer traffic, catches up and retries under the normal message rules.

### Rekey

The flow is the same for every key, and only the wrapping differs:

| Key | Issued by | Wrapped with | Estimated cost |
| --- | --- | --- | --- |
| Relay key | Authority or deputy | Each radio's device key | About 58 bytes each, so about 17 radios fit in one maximum-size message |
| Team key | Authority or deputy | Each member's identity key, handled by agents with no firmware involved | About one frame each |
| Channel key | Channel owner or authority | Each channel member's identity key | About one frame each |

1. **Distribute.** While the old key stays in use, send the new generation to each remaining member.
2. **Confirm.** Show each member's state as queued, sent, confirmed or unknown, in keeping with the
   project's rule on honest outcomes. The issuer sees who would be stranded before switching.
3. **Switch.** The issuer starts using the new generation, and holders switch when they hear it. A
   removed member never received it.
4. **Retire.** Erase the old generation. A member who missed the rekey is shown as locked out and
   needs a retry or an in-person fill.

Rekey messages are signed by the issuer. A rekey only reaches radios within radio range, so a relay
that misses one leaves a silent hole in the mesh until it is reached or visited. That is why the
Confirm step comes before the switch.

## Direct messages

Use **Noise pattern K** (`Noise_K_25519_ChaChaPoly_BLAKE2b`) from the
[Noise framework](https://noiseprotocol.org/noise.html): both static keys are known in advance, and
each message carries a fresh ephemeral key (`-> e, es, ss`).

- **No handshake on air.** This matters because the radio holds no direct-message keys and an agent
  may be offline for hours. An interactive handshake or a double ratchet would stall or lose sync,
  while this keeps no state between messages and needs no reply.
- **Fits the recovery rules.** The ciphertext is created once and retries reuse it byte for byte.
- **Smaller.** About 52 bytes of overhead against 77 for RME2, because a one-time key needs no nonce.
  The ephemeral key also serves as the duplicate-suppression ID.
- **Binding.** The source and destination node IDs go in the Noise prologue, so a message cannot be
  redirected.

Limits, as the Noise specification states for this pattern:

- Sender authentication is vulnerable to key-compromise impersonation. Someone who steals your
  private key can forge messages to you that appear to come from others.
- Forward secrecy covers sender compromise only. Stealing the recipient's key exposes recorded
  messages to that key.
- Messages can be replayed, so the agent must suppress duplicates.

The envelope carries a key generation number from the first version, so members can later rotate
their Diffie-Hellman key with a signed update. That extends forward secrecy to recipients without a
format change.

## Channels

Channels keep group keys and invites. They add:

- The ratchet and rekey above, using the epoch concept already in the envelope. Open-mode teams may
  keep rotating by hand as they do today.
- An optional per-channel **signed sender** setting, adding a 64-byte Ed25519 signature so a message
  proves which member sent it. This closes the caveat in D43.
- A required-encryption policy that comes with the invite and the signed roster, instead of each
  agent setting it alone. That closes today's downgrade gap.

## Background delivery to the phone

Messages already wait on the radio. It keeps receiving while the phone is away and stores them in an
8-message inbox in memory. A ninth overwrites the oldest, a reboot clears it, and the agent can show
when older messages were overwritten.

Instant delivery is blocked by two things. The mobile app disconnects when it is not focused, and the
radio never speaks first: firmware writes only replies and errors, as
[`host_links.cpp:21`](../../firmware/components/reaper_device/host_links.cpp) shows, so an app learns
of a new message only by asking. A sleeping phone has nothing to wake it.

| Where | Change |
| --- | --- |
| Firmware | A small **inbox changed** alert, built in `v0.9.0`, sent only to an agent that asks for it in `hello`, carrying only the latest sequence. An app cannot produce this itself, which is the reason D41 asks for |
| iOS app | Use the `bluetooth-central` background mode and Core Bluetooth state restoration, so iOS wakes the app when the alert arrives |
| Android app | Use a `connectedDevice` foreground service, which shows a permanent notification while running |
| Both apps | A quieter background session, because the 2-second ping cannot run in the background. Show the alert first, then fetch messages as time allows |

Rules and limits:

- **The alert is a hint.** A lost alert changes nothing: the agent still recovers by query, and no
  message state depends on it. Tests must cover lost, duplicated and delayed alerts, and an alert from
  an old boot.
- **Android route.** Android prefers `CompanionDeviceService` for long-lived notifications, but its
  documentation says the underlying companion API does not support random MAC addresses, and these
  radios use one. Start with the foreground service, and test whether the companion route works. Any
  later move to rotating Bluetooth addresses must check this again.
- **Time on iOS.** Apple's archived guide, from 2013, gives a woken app about 10 seconds. A full-size
  message takes 32 read requests, so a backlog may not finish in one wake. Larger read chunks may be
  worth considering in the core v1 review.
- **Being closed.** Android closes the connection if the process is killed. Apple's guide does not
  cover force-quit, and iOS is not expected to relaunch an app the user swiped away. Messages then
  wait on the radio until the app opens. Verify this on a phone.
- **Locked vault.** If the agent's PIN is locked, it can only say "new message", and the message stays
  encrypted until it is unlocked.
- **Disconnects.** When the phone goes out of range, beacons stop, but the radio keeps the team key
  and keeps collecting messages. After a reconnect the agent reads what waited.
- **The ACK.** It means the radio received the message, not that the phone or a person did. Agents
  must keep showing that distinction.
- **Inbox size.** Eight messages may be too few for a phone that is away for hours. Revisit this in
  the core v1 review, together with whether to keep it in memory only.

None of this has been run on a phone. The mobile app is built outside this repository (D48), so this
repository delivers the firmware alert and the contract in [Connect a mobile app](../guides/mobile-apps.md).

## Radio at rest

Without this section, a stolen radio gives up its relay and device keys to anyone with a flash reader.

- **Key storage.** Keep keys in a small dedicated partition that is explicitly erased on update. NVS
  is log-structured, so a key "deleted" from it may stay readable in flash, which would undermine
  forward secrecy and zeroize. Confirm this against the pinned ESP-IDF documentation.
- **USB and Bluetooth session.** A provisioned radio requires a host key before it serves its node
  table, inbox or send commands. Otherwise a thief can plug in and use a running radio.
- **Zeroize.** A deliberate way to erase keys from the radio and the portal. The physical gesture is
  an owner choice, because an accidental wipe in the field is also a failure.
- **Agent vault.** The PIN is required in team mode, with a longer option than 4–6 digits (changes
  D34). Keys must be readable while the app is in the background, or the locked-vault behavior above
  applies. Browser storage still cannot resist malware on an unlocked session.
- **Release hardening.** Flash encryption and Secure Boot V2 on release builds. Both chips qualify on
  paper: the T-Beam is ESP32-D0WDQ6-V3 revision 3.1 and the Heltec is ESP32-S3. D12 still applies:
  **no eFuse changes during development.** This decides Q10.

## What must not back us into a corner

Each of these is cheap before core v1 and expensive after it.

| Item | Why now |
| --- | --- |
| Frame version 2, with the relay and team split | It is the radio format every other feature rests on. Adding the split later would be another breaking change |
| Opaque typed payloads (Q5) | [`radio_packet.cpp:29`](../../firmware/components/reaper_mesh/radio_packet.cpp) accepts only envelope version 2, suite 1, so today each new envelope needs a firmware update. Firmware should carry bytes it does not understand. This is what lets direct messages, rekeying and future ciphers ship with no firmware change |
| Inbox changed alert | It is firmware, so it belongs in the same build, or background delivery forces another firmware update after the freeze |
| Partition table | It needs a dual-slot update layout and a key partition. A second slot fits: the T-Beam has about 1.9 MB free above the current layout and the images are about 540 KB. Release-mode flash encryption is expected to close the ROM download route that D16 relies on, so signed in-place updates must exist first. Verify this before relying on it |
| Algorithm identifiers | Suite and generation fields in every format, so ciphers can be replaced later |
| Crypto in `packages/agent-core` | It is in `agents/web/encryption.ts` today, but the mobile app is built separately (D48). Shared code with frozen test vectors keeps agents compatible |

## Changes to existing commitments

Each change takes effect when its step ships. Until then the existing commitment stands.

| Commitment | Change |
| --- | --- |
| D33, specification section 3 and encryption guide: no keys or primitives on devices | Radios store a relay key and device key and hold the team key in memory. Channel and direct keys still never reach a radio |
| Specification 5.3: keys never go over the radio | Allow it only when wrapped to a verified member by a deliberate rekey |
| Specification 5.3 and 5.4.1: keep old epochs and keep shared items as ciphertext at rest | Conflicts with forward secrecy. On receipt, agents re-encrypt history under the local vault key, and epoch keys are erased after a grace period |
| D24: firmware beacons and replies on its own settings | They also require an attached agent, and relays never send them |
| D45: channel IDs visible on air, relay only joined channels | IDs are encrypted, and radios relay all frames of their team |
| D47: a paired phone has the same access as USB | Still true for daily use, but a fill needs a cable or a button-opened window, and sessions need a host key |
| D34: PIN optional | Required in team mode, optional in Open mode |
| D16 and Q10: ROM updater, signing undecided | ROM updater stays for development, and signed dual-slot updates become the field route |
| D37: portal features paused | Stands. Step 1 comes before the field tests; steps 3 to 6 are agent features that follow them, unless the owner grants an exception like D49 |
| [Connect a mobile app](../guides/mobile-apps.md): background use not designed | Replaced by the contract here when the alert ships |
| Radio protocol fixtures | Replaced deliberately with owner approval (D42), never silently |

## Delivery order

Firmware changes happen only in steps 1, 2 and 7. Steps 3 to 6 are agent-only, which is what D41 asks
for. The project can stop after any step without leaving anything half-working. Users see no change
after step 1 beyond one reflash.

| Step | Work | Touches | Done when |
| --- | --- | --- | --- |
| 0 | Owner decisions below, then an independent look at this design | Docs | Owner decisions done on November 4, with specification, D33 and roadmap updated. The independent look is still open |
| 1 | Frame version 2, relay and team keys, opaque payloads, partition table, key store, fill, Open mode, beacons only while attached, inbox changed alert | Firmware, protocol, agent | Host tests and two boards: a radio not set up is silent, an outsider radio can neither read nor inject, a radio with no agent relays and sends nothing of its own |
| 2 | Relay key ratchet and rekey, relay status | Firmware, agent | A radio that was off catches up alone; a removed radio is locked out; separated groups converge |
| 3 | Background delivery in the mobile app, against the alert from step 1 | Mobile app (outside this repository), guide | Tested on real iPhones and Android phones, with the actual limits recorded |
| 4 | Identity, roster, deputies, verification, team key rekey, direct messages | Agent | Noise test vectors pass; another member cannot read a direct message; an unverified key is refused visibly |
| 5 | Channel ratchet, rekey and signed senders | Agent | A removed member cannot read new messages; forgeries are rejected; old history stays readable from the vault |
| 6 | Create team, Join team and Add relay flows, no-downgrade policy | Agent | The setup table above works in the portal and the mobile app; plaintext cannot be sent by accident; the interface states the real protection level |
| 7 | Host key, zeroize, signed updates, flash encryption and Secure Boot | Firmware, tools | Hardened release test boards only, with owner approval for each eFuse step; independent security review complete |

**Recommended timing.** Build step 1 now, in the slot held for screen work while waiting on the third
board, then run field qualification on frame version 2. The relay test tool does not exist yet, so
nothing is lost, and the range results will then describe the frames that ship. Otherwise the tests
must be repeated after the frame changes. Steps 2 onward can follow qualification. Core v1 freezes
only after step 2.

## Tests to add

These follow the project's verification standard, using deterministic race and fault tests in
addition to two- and three-board checks.

- Outsider radio: injected, replayed and tampered frames, forged ACKs, false beacons, and discovery
  requests that must get no reply.
- Relay-only radio: forwards with no team key, stores nothing, sends nothing of its own, and exposes
  no team key after a reboot or in a flash dump.
- Attached state: beacons stop and start correctly across Bluetooth loss, USB removal and backgrounding.
- Epochs: boundary races, bounded look-ahead against junk, reboot and power loss during an advance,
  and proof that old keys are gone from flash.
- Rekey: lost wraps, lost confirmations, a member offline throughout, competing authority and deputy
  rekeys, and interrupted uploads with no replay.
- Direct messages: official Noise vectors, a wrong recipient, redirected messages and duplicates.
- Downgrade: a sender stripping encryption or claiming Open mode on a team network.
- Inbox alert: lost, duplicated, delayed and old-boot alerts never change a message outcome.
- Hardware: airtime and CPU cost measured on both boards, three-node relay with the relay key, and
  background behavior on real phones.

## What this cannot do

- It cannot hide that a radio is transmitting. Direction finding, timing and traffic volume remain
  visible, and LoRa can be jammed.
- It cannot protect against a trusted member who turns hostile until they are removed, and they keep
  whatever they already received.
- It cannot protect a compromised unlocked phone or browser, or malicious portal code.
- A radio stolen before release hardening gives up the relay key to anyone with a flash reader, so
  the team must rekey it. A running operator radio also gives up the team key.
- A stolen authority or deputy agent compromises every device key it holds, and the team must set up
  its radios again.
- It cannot guarantee delivery to a phone. A force-quit app, a killed process, a rebooted radio or a
  full inbox all delay or lose messages, and agents must report that honestly.

## Owner decisions

The owner accepted all six recommendations on November 4.

| # | Decision | Confirmed choice |
| --- | --- | --- |
| 1 | Allow radios to store a relay key and hold the team key in memory, amending D33 | Yes. Accept that a radio rebooted while its phone is away misses messages sent to it, in exchange for a stolen radio exposing far less |
| 2 | Trust root | One authority per team with a signed roster, optional deputies and a sealed backup, plus QR scanning between individuals |
| 3 | Timing | Frame version 2 before field qualification |
| 4 | Ratchet interval | Every 24 hours by default, configurable per team, with history kept in the local vault |
| 5 | Default and Open mode | Radios stay silent until a mode is chosen, Open stays available with today's channel keys, and each radio joins one team in core v1 |
| 6 | Background delivery | Add the inbox changed alert in step 1, and build background delivery in the mobile app after it |
