#include "mesh_service.hpp"
#include <cstring>
#include <cstdio>
#include <limits>
namespace d = reaper::device; namespace m = reaper::mesh; namespace r = reaper::radio;
namespace {
template<std::size_t N> void literal(d::Text<N>& text, const char* value) { text.assign(reinterpret_cast<const std::uint8_t*>(value), std::strlen(value)); }
bool changed(const d::Settings& a, const d::Settings& b) {
  return a.region != b.region || a.radio.mode != b.radio.mode || a.radio.power != b.radio.power ||
    a.radio.relay != b.radio.relay || a.radio.channels.bytes != b.radio.channels.bytes;
}
std::uint8_t channels(const d::RadioSettings& radio) {
  std::uint8_t mask = 1; unsigned slot = 0;
  for (std::size_t i = 0; i < radio.channels.length; ++i) { if (radio.channels.bytes[i] == '|') ++slot; else if (slot < 8) mask |= 1u << slot; }
  return mask;
}
std::uint64_t destination(const d::Text<64>& text) {
  if (text.length == 9 && !std::memcmp(text.bytes.data(), "broadcast", 9)) return m::kBroadcast;
  std::size_t start = 0;
  if (text.length == 19 && !std::memcmp(text.bytes.data(), "heltec-", 7)) start = 7;
  else if (text.length == 21 && !std::memcmp(text.bytes.data(), "node-", 5)) start = 5;
  else return 0;
  std::uint64_t value = 0;
  for (std::size_t i = start; i < text.length; ++i) {
    auto b = text.bytes[i]; unsigned digit;
    if (b >= '0' && b <= '9') digit = b - '0'; else if (b >= 'a' && b <= 'f') digit = b - 'a' + 10; else return 0;
    value = (value << 4) | digit;
  }
  return value == m::kBroadcast ? 0 : value;
}
m::MessageKey key(const d::Text<64>& id, std::uint64_t node, const std::array<std::uint8_t, 16>& boot) {
  m::MessageKey k{}; k.origin = node; k.boot = boot;
  std::size_t split = 0; while (split < id.length && id.bytes[split] != '_') ++split;
  std::uint64_t number = 0;
  for (std::size_t i = split + 1; i < id.length; ++i) {
    if (id.bytes[i] < '0' || id.bytes[i] > '9') return {};
    number = number * 10 + id.bytes[i] - '0'; if (number > 0xffffffff) return {};
  }
  k.sequence = number; return k;
}
d::Text<64> message_id(const m::MessageKey& key) {
  char id[64]{}; for (std::size_t i = 0; i < 16; ++i) std::snprintf(id + i * 2, 3, "%02x", key.boot[i]);
  std::snprintf(id + 32, sizeof(id) - 32, "_%lu", static_cast<unsigned long>(key.sequence));
  d::Text<64> value{}; literal(value, id); return value;
}
d::Text<64> origin(std::uint64_t node) {
  char id[64]{};
  if (node <= 0xffffffffffffULL) std::snprintf(id, sizeof(id), "heltec-%012llx", static_cast<unsigned long long>(node));
  else std::snprintf(id, sizeof(id), "node-%016llx", static_cast<unsigned long long>(node));
  d::Text<64> value{}; literal(value, id); return value;
}
void increment(std::uint32_t& n) { if (n < std::numeric_limits<std::uint32_t>::max()) ++n; }
}
MeshService::MeshService(d::MessageQueue& messages, d::Inbox& inbox, d::RadioInfo& info, d::Text<64> device,
    std::array<std::uint8_t, 16> boot, std::uint64_t node, bool verified)
  : messages_(messages), inbox_(inbox), info_(info), device_(device), boot_(boot), node_(node), antenna_verified_(verified), radio_(bus_), mesh_(node) {
  literal(info_.state, "off"); literal(info_.reason, "radio-off");
}
void MeshService::begin() {
  info_.probe = bus_.begin() && radio_.configure(0, false, false);
  radio_.stop();
  if (!info_.probe) {
    char reason[64]{}; std::snprintf(reason, sizeof(reason), "probe-%02x-mode%u-status%u-errors%04x", bus_.last_command(), radio_.chip_mode(), radio_.command_status(), radio_.device_errors());
    literal(info_.state, "fault"); literal(info_.reason, reason);
  }
}
void MeshService::tick(const d::Snapshot* snapshot, std::uint64_t now) {
  if (!snapshot) {
    radio_.stop(); mesh_.quiesce(); if (pending_ || tx_) { mesh_.complete_tx(false, now); }
    pending_ = tx_ = false;
    literal(info_.state, "blocked"); literal(info_.reason, "storage-unavailable"); return;
  }
  info_.revision = snapshot->revision;
  const bool policy_changed = configured_ && changed(settings_, snapshot->settings);
  if (!configured_ || policy_changed) {
    if (policy_changed) messages_.quiesce();
    if (pending_ || tx_) { mesh_.complete_tx(false, now); }
    pending_ = tx_ = false;
    radio_.stop(); mesh_.quiesce(); settings_ = snapshot->settings; configured_ = true;
    mesh_.policy(settings_.radio.relay && settings_.radio.mode == d::RadioMode::Mesh && antenna_verified_, channels(settings_.radio));
    const bool receive = settings_.region == d::Region::Us && settings_.radio.mode != d::RadioMode::Off;
    if (receive && info_.probe) radio_.configure(settings_.radio.power, true, settings_.radio.mode == d::RadioMode::Mesh && antenna_verified_);
  }
  if (!info_.probe) { literal(info_.state, "fault"); }
  else if (settings_.radio.mode == d::RadioMode::Off || settings_.region != d::Region::Us) {
    literal(info_.state, "off"); literal(info_.reason, "radio-off");
  } else if (!radio_.healthy()) { literal(info_.state, "fault"); literal(info_.reason, "radio-driver-fault"); }
  else {
    literal(info_.state, radio_.transmitting() ? "transmitting" : "receiving");
    literal(info_.reason, settings_.radio.mode == d::RadioMode::Receive ? "receive-only" : !antenna_verified_ ? "antenna-unconfirmed" : "ready");
  }
  mesh_.tick(now);
  auto event = radio_.poll(now);
  if (event.tx_done) { mesh_.complete_tx(event.tx_success, now); tx_ = false; if (event.tx_success) increment(info_.transmitted); }
  if (event.received) { increment(info_.received); mesh_.receive(event.bytes.data(), event.size, now); }
  const auto& incoming = mesh_.incoming();
  for (std::size_t i = 0; i < incoming.size(); ++i) {
    const auto& item = incoming[i];
    if (item.used && item.complete && !(reported_[i] == item.key) &&
        inbox_.append(origin(item.key.origin), message_id(item.key), item.channel, item.bytes.data(), item.size)) reported_[i] = item.key;
  }
  for (const auto& message : messages_.records()) {
    if (!message.used || (message.state != d::MessageState::Queued && message.state != d::MessageState::Transmitted)) continue;
    const auto target = destination(message.destination);
    if (target == node_) {
      if (inbox_.append(device_, message.message_id, message.channel, message.bytes.data(), message.size)) messages_.local_accept(message.message_id);
      else messages_.fail(message.message_id, "inbox-unavailable");
      continue;
    }
    if (!target) { messages_.fail(message.message_id, "invalid-destination"); continue; }
    if (!radio_.healthy() || settings_.radio.mode != d::RadioMode::Mesh || !antenna_verified_) {
      char reason[65]{}; std::memcpy(reason, info_.reason.bytes.data(), info_.reason.length);
      messages_.fail(message.message_id, reason); continue;
    }
    const auto identity = key(message.message_id, node_, boot_);
    const m::Outbound* known = nullptr;
    for (const auto& item : mesh_.outgoing()) if (item.used && item.key == identity) { known = &item; break; }
    if (!known) {
      if (!mesh_.enqueue(identity, target, message.channel, message.bytes.data(), message.size, now)) messages_.fail(message.message_id, "mesh-capacity");
    } else if (known->state == m::SendState::Failed) messages_.fail(message.message_id, "delivery-unconfirmed");
    else if (known->state == m::SendState::Transmitted || known->state == m::SendState::Acknowledged) {
      messages_.transmitted(message.message_id, now);
      if (known->state == m::SendState::Acknowledged) messages_.acknowledge(message.message_id, message.destination, now);
    }
  }
  if (radio_.healthy() && settings_.radio.mode == d::RadioMode::Mesh && antenna_verified_ && !tx_) {
    if (!pending_ && mesh_.next_tx(now, packet_)) { pending_ = true; pending_at_ = now; }
    if (pending_) {
      std::array<std::uint8_t, m::kMaxPacketBytes> bytes{}; std::size_t size = 0;
      if (!m::encode_packet(packet_, bytes.data(), bytes.size(), size) || now - pending_at_ >= 10000) {
        mesh_.complete_tx(false, now); pending_ = false;
      } else {
        const auto result = radio_.transmit(bytes.data(), size, now);
        if (result == r::Start::Started) { tx_ = true; pending_ = false; }
        else if (result == r::Start::Rejected || result == r::Start::Fault) { mesh_.complete_tx(false, now); pending_ = false; }
      }
    }
  }
}
