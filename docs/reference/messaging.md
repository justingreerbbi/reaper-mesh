# Messaging and inbox v1

How a message is accepted over USB, what each delivery state means, and how an app reads the
board's inbox. What protects a message is in [Security and privacy](../guides/security.md) and
[Radio protocol](radio-protocol.md).

## Limits

| Bound | Value |
| --- | --- |
| Text per message | 1,024 UTF-8 bytes, nonempty |
| Message records on the board | 8 |
| Owner sequence marks per boot | 8, never evicted |
| Pending uploads per app | 1 |
| Board inbox | 8 complete messages in a ring |
| App sent history | 160 rolling entries, of which up to 32 may be unresolved |
| App received history | 32 entries |

Configuration and message commands have separate request-ID namespaces.

## Uploading a message

Text crosses USB in 32-byte binary chunks, each encoded as at most 64 lowercase hex characters,
so UTF-8 characters may span chunks. A message has at most 32 chunks, indexed from zero, and
every chunk but the last holds exactly 32 bytes. The whole text is validated (UTF-8, no
disallowed control characters) before it is queued.

A message binds its request ID, origin boot, channel, destination, chunk count and contents. A
duplicate with different content is rejected and the original is unchanged. A partial upload
expires after 5 seconds, and queued or in-flight work after 60 seconds. Expiry never reopens an
ID for execution.

## Delivery states

| State | Meaning |
| --- | --- |
| `receiving` | Chunks are arriving over USB |
| `queued` | Accepted into the board's volatile queue |
| `transmitted` | The radio sent every fragment. Not delivery |
| `acknowledged` | The addressed destination accepted the complete message. Never a read receipt |
| `failed` | Could not be sent, or no acknowledgment in time |
| `rejected` | Refused by the board, with a reason |
| `unknown` | The outcome could not be established, for example after a reboot |

A status carries the request ID, state, a bitmap of received chunks, an optional stable message
ID and a reason. Recovery uses a separate read-only query and never replays chunks after a link
change. Message records and owner marks survive a USB reconnect but not a reboot, so an
earlier boot's outcomes stay unknown even if matching text is seen later. A new message ID
combines the boot identity and a device counter.

**Broadcasts** (destination `broadcast`) never produce acknowledgments. A transmitted broadcast
is complete for the sender, and the app keeps that fact across disconnects and reloads, shown as
*Broadcast transmitted · no recipient acknowledgment*. A unicast stays unconfirmed at
transmitted until it is acknowledged or fails.

**Local delivery:** sending to the connected board's own node ID puts the message straight into
its inbox and reports `acknowledged` with reason `local-delivery`, without claiming a radio
transmission. This makes one-board testing meaningful. Remote sends need mesh mode, a working
radio, a confirmed US board and antenna, and airtime; otherwise they fail rather than pretend.

## Reading the inbox

Welcome feature bit 6, with `inboxVersion` 1 and `inboxCapacity` 8, advertises inbox retrieval.
The inbox has its own sequence space, separate from configuration revisions.

- **Query/head** returns the oldest and latest sequence numbers.
- **Read/item** returns one 32-byte chunk of one message, as lowercase hex. Each item repeats
  the origin, stable message ID, channel ID and chunk metadata. A missing reply identifies an
  evicted or invalid request.
- The app validates every response, bounds every buffer and only shows complete, valid
  messages. Read retries stop after three attempts. No inbox operation sends or changes
  anything.
- On reconnect to the same board and boot, a completed cursor is kept and a partial read
  restarts from its first chunk. A new boot resets the cursor. Gaps from eviction are shown,
  never hidden.

**Inbox version 2** adds the original radio destination (`broadcast` or the addressed node),
which lets apps keep channel broadcasts out of direct-message threads. Version-1 items have no
destination, so apps show them only in their channel.

An inbox item may hold bytes that are neither text nor a known envelope. See
[Agent features, payloads and inbox alert](protocol.md#agent-features-payloads-and-inbox-alert-d50).

## Live radio diagnostics

Welcome feature bit 5 advertises diagnostics. A radio query returns the settings revision,
probe result, effective state and reason, RX and TX counters, free heap and the minimum free
main-task stack. It uses its own request counter, and only a matching outstanding request can
update the app's view. Three unanswered probes stop polling. Counters do not prove delivery.

The radio driver works behind bounded SPI operations and fails closed if a transfer times out.
A probe at boot never transmits. Listen mode never transmits, including acknowledgments and
relays. A settings change cancels pending radio work first (`radio-config-changed`); it cannot
recall a signal already sent.

## Required tests

Chunk reordering, duplication and conflicts; invalid UTF-8; maximum size; assembly timeout and
its exact boundary; queue and owner exhaustion; receipt eviction; lost acceptance and reconnect
query; reboot ambiguity; acknowledgment and timeout races; refusing broadcast acknowledgments;
no state regressions; and bounded retry budgets. Real radio delivery is a separate hardware
gate.
