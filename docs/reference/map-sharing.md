# Shared map items v1

> [!NOTE]
> **Planned change (D43, after field qualification):** a per-channel, off-by-default **Auto-add shared map items** setting, available only on encrypted channels, will let items, updates and removals from the original sender apply without a prompt. Sharing will also require an explicit channel choice, with no preselected channel. Until it is implemented, this page describes current behavior. See [decision D43](../contributing/decisions.md#d43-per-channel-auto-add-for-shared-map-items) and [specification section 5.4.1](../overview/project-specification.md#541-shared-map-items-and-plugins).

The Map workspace supports local points and axis-aligned rectangles, optional JSON-defined types, and explicit channel/direct sharing. Sharing is an agent application protocol over existing UTF-8 messaging. No USB schema, radio packet, firmware source, generated descriptor or frozen fixture changes are required.

## Application envelope

The body is ASCII prefix `RMAP1:` followed by compact JSON `{ "operation": "put" | "withdraw", "item": ... }`. `packages/protocol/map-item.ts` is the canonical validator/encoder. `item` contains:

| Field | Contract |
| --- | --- |
| id | UUID-format lower-case hex, generated once per local item; copies get a fresh UUID |
| revision | integer 1–4294967295; local edits and explicit share attempts advance it; never wraps |
| geometry | `point` or `rectangle` |
| type | stable namespaced ID, at most 96 ASCII characters; built-ins use `core/`; plugins use `plugin-id/type-id` |
| color | six hexadecimal RGB digits prefixed by `#` |
| name / note | required nonblank name up to 48 UTF-8 bytes; optional note up to 160 bytes; no control characters or invalid Unicode |
| coordinates | point: [latitude, longitude]; rectangle: [north, west, south, east] |
| metadata | up to 12 safe field IDs with string (96 UTF-8 bytes), finite number or boolean values |

Coordinates reuse offset degree*10^7 unsigned integers: latitude range 0–1800000000 and longitude 0–3600000000. Rectangles require north > south and west < east; date-line crossing and arbitrary polygons are unsupported. Render only validated data using text nodes, fixed icon symbols and validated colors.

The entire serialized text must fit 1024 bytes, or 950 when existing RME1 channel encryption is required. The share dialog checks the actual bytes; oversized metadata is not truncated. Metadata is sent only for installed/enabled plugin fields explicitly marked `shared: true`; unknown/unavailable type metadata stays local rather than risk leaking local-only fields. Essential name/note/color/geometry/type remain interoperable without the plugin.

This text encoding supersedes the provisional binary RMA1 proposal: it avoids firmware changes and reuses the current text encryption API. RME1 wraps the text unchanged, with the existing channel/sender/destination authenticated context. Recoveries retain the same plaintext/ciphertext and only query previous work; no new replay behavior is introduced. Older agents show the envelope as ordinary text rather than render a map item. There is no recipient map-support negotiation or application acceptance receipt in v1.

## Ownership, revisions and approval

Incoming object identity is `(channel, canonical origin node, object UUID)`, distinct from the transport message identity. Duplicate/equal/lower revisions do not create approval prompts or replace accepted data. Equal-revision conflicts keep the first observation. A different origin or channel is a different object. Origin checking is not sender authentication; existing group keys cannot prove an individual sender's identity.

Every new item/update/withdrawal waits for an explicit action on its message card. No unapproved geometry is placed on the map. Cards expose Add to map, Update on map or Remove from map; sent cards describe the item without claiming recipient acceptance. The map sidebar only manages saved items and devices. Deleting a message/chat never deletes an accepted map item or resets its revision barrier; records are stored separately. A removed message cannot offer an add action, but its preserved barrier still suppresses delayed replay. Each record retains its highest observed revision, its accepted payload (if any) and its latest pending payload. Accepting an update replaces the accepted payload; dismissing it preserves the accepted version and high-water revision. A stale approval cannot approve a newer unseen revision. Accepting withdrawal removes the accepted item and retains the revision barrier, preventing delayed resurrection. Removing an accepted item locally also preserves that barrier. Copies receive a fresh local UUID; subsequent original-owner changes cannot overwrite them.

Each explicit share attempt advances and checkpoints the local object revision before dispatch, including failed/ambiguous attempts; gaps are allowed. This permits re-sharing after a withdrawal without reusing a suppressed revision. Local-only metadata is retained locally even when omitted from the outgoing payload. Withdraw is a full-item message with an advanced revision. It requests removal; it does not remotely erase data. Local delete does not transmit. The sender reports only existing transport states, not recipient review/acceptance. Broadcast has no destination ACK; direct ACK confirms device acceptance only. No automatic rebroadcast or full-map synchronization exists.

## Storage and limits

`reaper-mesh.map-workspace.v1` is independent of outgoing recovery retention: 512 local items, 1024 shared object/revision records, 16 plugins and 2 MiB serialized characters. Mutations use the existing browser writer lock/wipe gate and synchronous atomic `setItem` before changing live state. Corrupt records fail closed and are preserved. Capacity/quota failure reports an error without eviction of uncertainty or revision barriers.

Local items (including explicit copies) are plaintext browser data. Shared encrypted payloads retain only ciphertext plus source/channel/destination and approval metadata; decryption is temporary and accepted geometry disappears when the app is locked. Copying one creates a disclosed plaintext local item. Map exports include the stored workspace and require the same care as saved data. This release exports backups but does not import complete workspace backups. Emergency local wipe covers this namespace.

The device retains eight inbox messages and the agent's received transport history retains 32. A busy/disconnected agent can miss shared items after device eviction. Retention gaps are not evidence that a map synchronized. Revision records are bounded, do not confer authentication and are not a distributed consensus system.

## Evidence and remaining qualification

Host regressions cover UTF-8/size/range validation, rectangles, native unchanged-firmware message admission, fragmented read-only inbox retrieval, pending approval, duplicate/stale/conflicting revisions, stale approval, dismissal, withdrawal/reload suppression, source separation, storage failure/lock gating, plugin install/update/disable/uninstall and ciphertext-only encrypted map storage. Existing frozen wire fixtures remain unchanged.

An isolated browser origin was used for local point creation/reload and plugin file import/review/install/settings QA. This is not RF qualification. No firmware update, flash, device setting change or map RF transmission is part of this work. Two-agent/both-board direct/broadcast, encrypted RF, power-loss, field/relay and long-duration qualification remain required. A single attached device cannot qualify remote-agent acceptance.

Message-card UI follow-up verification: all 262 host tests and the production build pass. A temporary memory-only browser fixture verified an incoming shared-point card, no pre-approval marker, Add to map → disabled Added to map, and marker creation. The fixture was removed; no RF/firmware test is implied. Accepted cards offer View on map; map approval never changes device delivery/ACK state.
