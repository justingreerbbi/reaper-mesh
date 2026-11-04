#include "reaper/session.hpp"
#include "reaper/version.hpp"
#include <cstring>
#include <cstdio>
#include <algorithm>

namespace reaper::device {
namespace p = protocol;
namespace {
template <std::size_t N>
void set(p::FieldValue& field, const Text<N>& text) {
  field.present = true;
  field.length = text.length;
  if (text.length <= N && text.length <= p::kMaxText)
    std::memcpy(field.text.data(), text.bytes.data(), text.length);
}
void literal(p::FieldValue& field, const char* value) {
  field.present = true;
  field.length = std::strlen(value);
  std::memcpy(field.text.data(), value, field.length);
}
void number(p::FieldValue& field, std::uint32_t value) {
  field.present = true;
  field.number = value;
}
template <std::size_t N>
bool same(const p::FieldValue& field, const Text<N>& text) {
  return field.present && field.length == text.length &&
         std::memcmp(field.text.data(), text.bytes.data(), text.length) == 0;
}
bool radio_changed(const Settings& a, const Settings& b) {
  return a.region != b.region || a.radio.mode != b.radio.mode || a.radio.power != b.radio.power ||
         a.radio.relay != b.radio.relay || a.radio.profile != b.radio.profile ||
         a.radio.channels.length != b.radio.channels.length ||
         a.radio.channels.bytes != b.radio.channels.bytes ||
         a.radio.channel_ids != b.radio.channel_ids;
}
const char* outcome(Outcome value) {
  switch (value) {
    case Outcome::Committed:
      return "committed";
    case Outcome::Conflict:
      return "conflict";
    case Outcome::Rejected:
      return "rejected";
    default:
      return "unknown";
  }
}
}  // namespace
Session::Session(Configuration& authority, Text<64> device, Text<64> boot, MessageQueue* messages,
                 RadioInfo* radio, Inbox* inbox, Discovery* discovery)
    : authority_(authority),
      messages_(messages),
      radio_(radio),
      inbox_(inbox),
      discovery_(discovery),
      device_(device),
      boot_(boot) {}
void Session::reset() {
  active_ = compatible_ = admitted_ = synchronized_ = fault_ = false;
  link_ = {};
  owner_ = {};
}
void Session::error(p::Message& reply) const {
  reply = {};
  reply.type = p::MessageType::Error;
  set(reply.fields[p::kErrorLink], link_);
  set(reply.fields[p::kErrorBoot], boot_);
  literal(reply.fields[p::kErrorCode], "storage-unavailable");
}
bool Session::take_error(p::Message& reply) {
  if (!fault_)
    return false;
  error(reply);
  reset();
  return true;
}
bool Session::handle(const p::Message& request, p::Message& reply) {
  // Public callers may construct messages directly; validate before indexing/copying.
  std::array<std::uint8_t, p::kMaxPayload> scratch{};
  std::size_t size = 0;
  if (!p::encode_payload(request, scratch.data(), scratch.size(), size))
    return false;
  reply = {};
  if (request.type == p::MessageType::Hello) {
    reset();
    const auto& link = request.fields[p::kHelloLink];
    link_.assign(link.text.data(), link.length);
    if (!authority_.healthy()) {
      error(reply);
      return true;
    }
    compatible_ = request.fields[p::kHelloMinVersion].number <= 1 &&
                  request.fields[p::kHelloMaxVersion].number >= 1;
    const auto& owner = request.fields[p::kHelloOwner];
    if (owner.present && compatible_) {
      owner_.assign(owner.text.data(), owner.length);
      admitted_ = authority_.admit(owner_);
    }
    active_ = true;
    reply.type = p::MessageType::Welcome;
    set(reply.fields[p::kWelcomeLink], link_);
    set(reply.fields[p::kWelcomeDevice], device_);
    set(reply.fields[p::kWelcomeBoot], boot_);
    number(reply.fields[p::kWelcomeMinVersion], 1);
    number(reply.fields[p::kWelcomeMaxVersion], 1);
    number(reply.fields[p::kWelcomeConfigSchema], 1);
    number(reply.fields[p::kWelcomeFeatures], 23 | (messages_ ? 8 : 0) | (radio_ ? 32 : 0) |
                                                  (inbox_ ? 64 : 0) | (discovery_ ? 384 : 0) | 512 |
                                                  1024);
    number(reply.fields[p::kWelcomeMaxPayload], p::kMaxPayload);
    number(reply.fields[p::kWelcomeReceiptCapacity], Configuration::kReceiptCapacity);
    number(reply.fields[p::kWelcomeOwnerCapacity], Configuration::kOwnerCapacity);
    number(reply.fields[p::kWelcomeOwnerAdmitted], admitted_ ? 1 : 0);
    number(reply.fields[p::kWelcomeRegions], 3);
    number(reply.fields[p::kWelcomeMaxLabelBytes], 64);
    literal(reply.fields[p::kWelcomeFirmware], kFirmwareVersion);
    number(reply.fields[p::kWelcomeRadioVersion], radio_ ? 1 : 0);
    number(reply.fields[p::kWelcomeRadioSchema], 1);
    number(reply.fields[p::kWelcomeMaxChannels], 8);
    number(reply.fields[p::kWelcomeScreenVersion], 1);
    number(reply.fields[p::kWelcomeChannelIdVersion], 1);
    if (inbox_) {
      number(reply.fields[p::kWelcomeInboxVersion], 2);
      number(reply.fields[p::kWelcomeInboxCapacity], Inbox::kCapacity);
    }
    if (messages_) {
      Snapshot current{};
      if (authority_.snapshot(current))
        messages_->channels(channel_set(current.settings.radio));
      number(reply.fields[p::kWelcomeMessageVersion], 1);
      number(reply.fields[p::kWelcomeMaxMessageBytes], 1024);
      number(reply.fields[p::kWelcomeMessageCapacity], MessageQueue::kCapacity);
    }
    if (discovery_) {
      number(reply.fields[p::kWelcomeLocationVersion], 1);
      number(reply.fields[p::kWelcomeDiscoveryVersion], 1);
      number(reply.fields[p::kWelcomeNodeCapacity], 32);
    }
    return true;
  }
  if (!active_ || !compatible_ || !same(request.fields[0], link_))
    return false;
  if (request.type == p::MessageType::Ping) {
    reply.type = p::MessageType::Pong;
    set(reply.fields[p::kPongLink], link_);
    set(reply.fields[p::kPongBoot], boot_);
    number(reply.fields[p::kPongRequest], request.fields[p::kPingRequest].number);
    return true;
  }
  if (request.type == p::MessageType::Discover || request.type == p::MessageType::NodeQuery) {
    if (!discovery_ || !synchronized_ || !same(request.fields[1], boot_) || !authority_.healthy())
      return false;
    if (request.type == p::MessageType::Discover) {
      const auto& field = request.fields[p::kDiscoverId];
      Text<75> id{};
      id.assign(field.text.data(), field.length);
      const auto action = request.fields[p::kDiscoverAction].number;
      const bool owns = owner_.length && id.length > owner_.length &&
                        id.bytes[owner_.length] == ':' &&
                        !std::memcmp(owner_.bytes.data(), id.bytes.data(), owner_.length);
      const auto result = action > 1 || !owns || (action && !admitted_)
                              ? DiscoveryResult{"rejected"}
                              : discovery_->request(owner_, id, action == 1, now_);
      reply.type = p::MessageType::DiscoveryStatus;
      set(reply.fields[p::kDiscoveryStatusLink], link_);
      set(reply.fields[p::kDiscoveryStatusBoot], boot_);
      set(reply.fields[p::kDiscoveryStatusId], id);
      literal(reply.fields[p::kDiscoveryStatusState], result.state);
      number(reply.fields[p::kDiscoveryStatusReplies], result.replies);
      number(reply.fields[p::kDiscoveryStatusSequence], result.sequence);
    } else {
      const auto generation = request.fields[p::kNodeQueryGeneration].number;
      const auto cursor = request.fields[p::kNodeQueryCursor].number;
      if (!generation && !cursor) {
        node_generation_ = discovery_->generation();
        node_count_ = discovery_->count();
        for (std::size_t i = 0; i < node_count_; ++i) {
          const auto* item = discovery_->peer(i);
          node_snapshot_[i] = {item->key, item->name, item->position, item->seen};
        }
      }
      const bool current = generation == node_generation_;
      const auto* peer = current && cursor < node_count_ ? &node_snapshot_[cursor] : nullptr;
      reply.type = p::MessageType::NodeReply;
      set(reply.fields[p::kNodeReplyLink], link_);
      set(reply.fields[p::kNodeReplyBoot], boot_);
      number(reply.fields[p::kNodeReplyRequest], request.fields[p::kNodeQueryRequest].number);
      number(reply.fields[p::kNodeReplyGeneration], node_generation_);
      number(reply.fields[p::kNodeReplyCursor], cursor);
      number(reply.fields[p::kNodeReplyTotal], node_count_);
      literal(reply.fields[p::kNodeReplyState], !generation && !cursor ? "head"
                                                : !current             ? "changed"
                                                : peer                 ? "item"
                                                                       : "missing");
      if (peer && generation) {
        char node[32]{}, nonce[33]{};
        std::snprintf(node, sizeof(node), "node-%016llx",
                      static_cast<unsigned long long>(peer->key.origin));
        for (std::size_t i = 0; i < 16; ++i)
          std::snprintf(nonce + i * 2, 3, "%02x", peer->key.boot[i]);
        literal(reply.fields[p::kNodeReplyNode], node);
        literal(reply.fields[p::kNodeReplyPeerBoot], nonce);
        number(reply.fields[p::kNodeReplyPeerSequence], peer->key.sequence);
        if (peer->position.source) {
          number(reply.fields[p::kNodeReplyPositionSource], peer->position.source);
          number(reply.fields[p::kNodeReplyLatitude], peer->position.latitude);
          number(reply.fields[p::kNodeReplyLongitude], peer->position.longitude);
          number(reply.fields[p::kNodeReplyPositionAgeMs], peer->position.age_ms);
        }
        set(reply.fields[p::kNodeReplyName], peer->name);
        number(reply.fields[p::kNodeReplyAgeMs],
               std::min<std::uint64_t>(now_ >= peer->seen ? now_ - peer->seen : 0, 0xffffffff));
      }
    }
    return true;
  }
  if (request.type == p::MessageType::RadioQuery || request.type == p::MessageType::InboxQuery ||
      request.type == p::MessageType::InboxRead) {
    if (!synchronized_ || !same(request.fields[1], boot_))
      return false;
    if (request.type == p::MessageType::RadioQuery) {
      if (!radio_)
        return false;
      reply.type = p::MessageType::RadioStatus;
      set(reply.fields[p::kRadioStatusLink], link_);
      set(reply.fields[p::kRadioStatusBoot], boot_);
      number(reply.fields[p::kRadioStatusRequest], request.fields[p::kRadioQueryRequest].number);
      set(reply.fields[p::kRadioStatusState], radio_->state);
      set(reply.fields[p::kRadioStatusReason], radio_->reason);
      number(reply.fields[p::kRadioStatusHeapFree], radio_->heap_free);
      number(reply.fields[p::kRadioStatusStackFree], radio_->stack_free);
      number(reply.fields[p::kRadioStatusRevision], radio_->revision);
      number(reply.fields[p::kRadioStatusProbe], radio_->probe ? 1 : 0);
      number(reply.fields[p::kRadioStatusTransmitted], radio_->transmitted);
      number(reply.fields[p::kRadioStatusReceived], radio_->received);
      return true;
    }
    if (!inbox_)
      return false;
    if (request.type == p::MessageType::InboxQuery) {
      reply.type = p::MessageType::InboxHead;
      set(reply.fields[p::kInboxHeadLink], link_);
      set(reply.fields[p::kInboxHeadBoot], boot_);
      number(reply.fields[p::kInboxHeadRequest], request.fields[p::kInboxQueryRequest].number);
      number(reply.fields[p::kInboxHeadOldest], inbox_->oldest());
      number(reply.fields[p::kInboxHeadLatest], inbox_->latest());
      return true;
    }
    const auto sequence = request.fields[p::kInboxReadSequence].number;
    const auto part = request.fields[p::kInboxReadPart].number;
    const auto* item = inbox_->find(sequence);
    if (!item || part >= 32 || part * 32 >= item->size) {
      reply.type = p::MessageType::InboxMissing;
      set(reply.fields[p::kInboxMissingLink], link_);
      set(reply.fields[p::kInboxMissingBoot], boot_);
      number(reply.fields[p::kInboxMissingRequest], request.fields[p::kInboxReadRequest].number);
      number(reply.fields[p::kInboxMissingSequence], sequence);
      return true;
    }
    reply.type = p::MessageType::InboxItem;
    set(reply.fields[p::kInboxItemLink], link_);
    set(reply.fields[p::kInboxItemBoot], boot_);
    number(reply.fields[p::kInboxItemRequest], request.fields[p::kInboxReadRequest].number);
    number(reply.fields[p::kInboxItemSequence], sequence);
    set(reply.fields[p::kInboxItemOrigin], item->origin);
    set(reply.fields[p::kInboxItemMessageId], item->message_id);
    number(reply.fields[p::kInboxItemChannel], item->channel);
    number(reply.fields[p::kInboxItemPart], part);
    number(reply.fields[p::kInboxItemCount], (item->size + 31) / 32);
    set(reply.fields[p::kInboxItemDestination], item->destination);
    const auto remaining = item->size - part * 32;
    const auto size = remaining < 32 ? remaining : 32;
    auto& data = reply.fields[p::kInboxItemData];
    data.present = true;
    data.length = size * 2;
    constexpr char digits[] = "0123456789abcdef";
    for (std::size_t i = 0; i < size; ++i) {
      auto byte = item->bytes[part * 32 + i];
      data.text[2 * i] = digits[byte >> 4];
      data.text[2 * i + 1] = digits[byte & 15];
    }
    return true;
  }
  if (request.type == p::MessageType::Submit || request.type == p::MessageType::MessageQuery) {
    if (!messages_ || !same(request.fields[1], boot_) || !synchronized_)
      return false;
    if (!authority_.healthy()) {
      error(reply);
      reset();
      return true;
    }
    Text<75> id{};
    const auto& value = request.fields[2];
    id.assign(value.text.data(), value.length);
    MessageReceipt result{};
    if (request.type == p::MessageType::MessageQuery)
      result = messages_->query(id);
    else if (!admitted_) {
      result.state = MessageState::Rejected;
      result.reason.assign(reinterpret_cast<const std::uint8_t*>("owner-capacity"), 14);
    } else {
      const auto& data = request.fields[p::kSubmitData];
      std::array<std::uint8_t, 32> bytes{};
      auto nibble = [](std::uint8_t b) -> unsigned { return b <= '9' ? b - '0' : b - 'a' + 10; };
      for (std::size_t i = 0; i < data.length / 2; ++i)
        bytes[i] = (nibble(data.text[2 * i]) << 4) | nibble(data.text[2 * i + 1]);
      Text<64> destination{};
      const auto& dest = request.fields[p::kSubmitDestination];
      destination.assign(dest.text.data(), dest.length);
      result = messages_->submit(owner_, id, request.fields[p::kSubmitChannel].number, destination,
                                 request.fields[p::kSubmitPart].number,
                                 request.fields[p::kSubmitCount].number, bytes.data(),
                                 data.length / 2, now_);
    }
    reply.type = p::MessageType::MessageStatus;
    set(reply.fields[p::kMessageStatusLink], link_);
    set(reply.fields[p::kMessageStatusBoot], boot_);
    set(reply.fields[p::kMessageStatusId], id);
    literal(reply.fields[p::kMessageStatusState], message_state(result.state));
    number(reply.fields[p::kMessageStatusReceived], result.received);
    if (result.message_id.length)
      set(reply.fields[p::kMessageStatusMessageId], result.message_id);
    if (result.reason.length)
      set(reply.fields[p::kMessageStatusReason], result.reason);
    return true;
  }
  if (request.type != p::MessageType::Sync && request.type != p::MessageType::Configure &&
      request.type != p::MessageType::Query)
    return false;
  if (!same(request.fields[1], boot_))
    return false;
  Snapshot snapshot{};
  if (!authority_.snapshot(snapshot)) {
    error(reply);
    reset();
    return true;
  }
  if (request.type == p::MessageType::Sync) {
    reply.type = p::MessageType::Snapshot;
    set(reply.fields[p::kSnapshotLink], link_);
    set(reply.fields[p::kSnapshotBoot], boot_);
    number(reply.fields[p::kSnapshotRequest], request.fields[p::kSyncRequest].number);
    number(reply.fields[p::kSnapshotSequence], snapshot.revision);
    number(reply.fields[p::kSnapshotRevision], snapshot.revision);
    literal(reply.fields[p::kSnapshotRegion], snapshot.settings.region == Region::Unset ? "UNSET"
                                              : snapshot.settings.region == Region::Us  ? "US"
                                                                                        : "EU");
    set(reply.fields[p::kSnapshotLabel], snapshot.settings.label);
    const auto& radio = snapshot.settings.radio;
    literal(reply.fields[p::kSnapshotRadioMode], radio.mode == RadioMode::Off       ? "off"
                                                 : radio.mode == RadioMode::Receive ? "receive"
                                                                                    : "mesh");
    number(reply.fields[p::kSnapshotTxPower], radio.power);
    number(reply.fields[p::kSnapshotRelay], radio.relay ? 1 : 0);
    set(reply.fields[p::kSnapshotChannels], radio.channels);
    format_channel_ids(reply.fields[p::kSnapshotChannelIds], radio);
    literal(reply.fields[p::kSnapshotPreset], "US915_LAB1");
    if (discovery_) {
      number(reply.fields[p::kSnapshotBeacon], snapshot.settings.discovery.beacon);
      number(reply.fields[p::kSnapshotRespond], snapshot.settings.discovery.respond);
      number(reply.fields[p::kSnapshotBeaconInterval], snapshot.settings.discovery.interval);
    }
    if (discovery_) {
      const auto& position = snapshot.settings.position;
      number(reply.fields[p::kSnapshotShareLocation], position.share);
      number(reply.fields[p::kSnapshotPositionSource], position.source);
      number(reply.fields[p::kSnapshotLatitude], position.latitude);
      number(reply.fields[p::kSnapshotLongitude], position.longitude);
    }
    number(reply.fields[p::kSnapshotScreenTimeout], snapshot.settings.screen.timeout);
    number(reply.fields[p::kSnapshotScreenWake], snapshot.settings.screen.wake);
    synchronized_ = true;
    return true;
  }
  Text<75> id{};
  const auto& id_field = request.fields[2];
  id.assign(id_field.text.data(), id_field.length);
  Result result{Outcome::Rejected, snapshot.revision};
  if (request.type == p::MessageType::Query)
    result = authority_.query(id);
  else {
    Command command{};
    const bool owns = owner_.length && id.length > owner_.length &&
                      id.bytes[owner_.length] == ':' &&
                      std::memcmp(id.bytes.data(), owner_.bytes.data(), owner_.length) == 0;
    if (synchronized_ && admitted_ && owns && decode_command(request, command) &&
        (!command.has_position || discovery_) && command.settings.region != Region::Eu) {
      result = authority_.apply(command);
      Snapshot current{};
      if (messages_ && result.outcome == Outcome::Committed && authority_.snapshot(current)) {
        if (radio_changed(snapshot.settings, current.settings))
          messages_->quiesce();
        messages_->channels(channel_set(current.settings.radio));
      }
    }
  }
  reply.type = p::MessageType::Result;
  set(reply.fields[p::kResultLink], link_);
  set(reply.fields[p::kResultBoot], boot_);
  set(reply.fields[p::kResultId], id);
  literal(reply.fields[p::kResultOutcome], outcome(result.outcome));
  number(reply.fields[p::kResultRevision], result.revision);
  if (!authority_.healthy())
    fault_ = true;
  return true;
}
}  // namespace reaper::device
