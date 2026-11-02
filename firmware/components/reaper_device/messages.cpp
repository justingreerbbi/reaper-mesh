#include "reaper/messages.hpp"
#include "reaper/radio_packet.hpp"
#include <cstring>
#include <cstdio>
#include <limits>
namespace reaper::device {
namespace {
template<std::size_t N> void literal(Text<N>& target, const char* value) {
  target.assign(reinterpret_cast<const std::uint8_t*>(value), std::strlen(value));
}
template<std::size_t N> bool equal(const Text<N>& a, const Text<N>& b) {
  return a.length == b.length && std::memcmp(a.bytes.data(), b.bytes.data(), a.length) == 0;
}
bool broadcast(const Text<64>& value) { Text<64> b{}; literal(b, "broadcast"); return equal(value, b); }
bool terminal(const MessageRecord& r) {
  return r.state == MessageState::Acknowledged || r.state == MessageState::Rejected ||
    r.state == MessageState::Failed || (r.state == MessageState::Transmitted && broadcast(r.destination));
}
MessageReceipt receipt(const MessageRecord& record) { return {record.state, record.received, record.message_id, record.reason}; }
MessageReceipt reject(const char* why) { MessageReceipt r{}; r.state = MessageState::Rejected; literal(r.reason, why); return r; }
bool sequence(const Text<64>& owner, const Text<75>& id, std::uint32_t& value) {
  if (!owner.length || owner.length > 64 || id.length <= owner.length + 1 || id.length > 75 ||
      std::memcmp(owner.bytes.data(), id.bytes.data(), owner.length) || id.bytes[owner.length] != ':') return false;
  std::uint64_t number = 0;
  if (id.bytes[owner.length + 1] == '0') return false;
  for (std::size_t i = owner.length + 1; i < id.length; ++i) {
    if (id.bytes[i] < '0' || id.bytes[i] > '9') return false;
    number = number * 10 + id.bytes[i] - '0'; if (number > 0xffffffff) return false;
  }
  value = static_cast<std::uint32_t>(number); return value != 0;
}
}
const char* message_state(MessageState state) {
  switch (state) {
    case MessageState::Receiving: return "receiving"; case MessageState::Queued: return "queued";
    case MessageState::Transmitted: return "transmitted"; case MessageState::Acknowledged: return "acknowledged";
    case MessageState::Failed: return "failed"; case MessageState::Rejected: return "rejected";
    default: return "unknown";
  }
}
bool MessageQueue::fail(const Text<64>& id, const char* why) {
  for (auto& r : records_) if (r.used && equal(r.message_id, id) && !terminal(r)) {
    r.state = MessageState::Failed; literal(r.reason, why); return true;
  }
  return false;
}
bool MessageQueue::local_accept(const Text<64>& id) {
  for (auto& r : records_) if (r.used && equal(r.message_id, id) && r.state == MessageState::Queued) {
    r.state = MessageState::Acknowledged; literal(r.reason, "local-delivery"); return true;
  }
  return false;
}
void MessageQueue::quiesce() {
  for (auto& r : records_) if (r.used && !terminal(r)) { r.state = MessageState::Failed; literal(r.reason, "radio-config-changed"); }
}
void MessageQueue::tick(std::uint64_t now) {
  for (auto& r : records_) if (r.used && !terminal(r) && now >= r.deadline) {
    r.state = MessageState::Failed; literal(r.reason, "expired");
  }
}
MessageReceipt MessageQueue::query(const Text<75>& id) const {
  for (const auto& r : records_) if (r.used && equal(r.request, id)) return receipt(r);
  return {};
}
MessageReceipt MessageQueue::submit(const Text<64>& owner, const Text<75>& id, std::uint32_t channel,
    const Text<64>& destination, std::uint32_t part, std::uint32_t count,
    const std::uint8_t* bytes, std::size_t size, std::uint64_t now) {
  tick(now); std::uint32_t seq = 0;
  if (!sequence(owner, id, seq) || channel > 7 || !(channels_ & (1u << channel)) || !destination.length || destination.length > 64 ||
      !count || count > 32 || part >= count || !bytes || !size || size > 32 || (part + 1 < count && size != 32)) return reject("invalid-message");
  MessageRecord* record = nullptr;
  for (auto& r : records_) if (r.used && equal(r.request, id)) { record = &r; break; }
  if (record) {
    auto& r = *record;
    if (r.channel != channel || !equal(r.destination, destination) || r.count != count) return reject("id-conflict");
    if (r.received & (1u << part)) {
      const auto expected = part + 1 == count ? r.size - part * 32 : 32;
      if (expected != size || std::memcmp(r.bytes.data() + part * 32, bytes, size)) return reject("id-conflict");
      return receipt(r);
    }
    if (r.state != MessageState::Receiving) return receipt(r);
  } else {
    Owner* mark = nullptr;
    for (auto& o : owners_) if (o.used && equal(o.id, owner)) { mark = &o; break; }
    if (!mark) for (auto& o : owners_) if (!o.used) { o.used = true; o.id = owner; mark = &o; break; }
    if (!mark) return reject("owner-capacity");
    if (seq <= mark->highest) return {};
    mark->highest = seq;
    for (std::size_t i = 0; i < records_.size(); ++i) {
      auto& r = records_[(next_ + i) % records_.size()];
      if (!r.used || terminal(r)) { record = &r; next_ = (next_ + i + 1) % records_.size(); break; }
    }
    if (!record || counter_ == std::numeric_limits<std::uint32_t>::max()) return reject("queue-capacity");
    *record = {}; auto& r = *record; r.used = true; r.request = id; r.destination = destination;
    r.channel = channel; r.count = count; r.deadline = now + 5000;
    char identity[65]{};
    // Boot identity is at most 32 bytes for target firmware; refuse oversized combinations.
    const auto length = std::snprintf(identity, sizeof(identity), "%.*s_%lu", static_cast<int>(boot_.length),
      reinterpret_cast<const char*>(boot_.bytes.data()), static_cast<unsigned long>(++counter_));
    if (length < 0 || static_cast<std::size_t>(length) >= sizeof(identity)) { r.state = MessageState::Rejected; literal(r.reason, "identity-limit"); return receipt(r); }
    literal(r.message_id, identity);
  }
  auto& r = *record;
  std::memcpy(r.bytes.data() + part * 32, bytes, size); r.received |= 1u << part;
  if (part + 1 == count) r.size = part * 32 + size;
  const auto complete = count == 32 ? 0xffffffffu : (1u << count) - 1;
  if (r.received == complete) {
    if (!mesh::valid_message_payload(r.bytes.data(), r.size, r.channel)) { r.state = MessageState::Rejected; literal(r.reason, "invalid-payload"); }
    else { r.state = MessageState::Queued; r.deadline = now + 60000; }
  }
  return receipt(r);
}
bool MessageQueue::transmitted(const Text<64>& id, std::uint64_t now) {
  tick(now);
  for (auto& r : records_) if (r.used && equal(r.message_id, id) && r.state == MessageState::Queued) {
    r.state = MessageState::Transmitted; return true;
  }
  return false;
}
bool MessageQueue::acknowledge(const Text<64>& id, const Text<64>& destination, std::uint64_t now) {
  tick(now);
  for (auto& r : records_) if (r.used && equal(r.message_id, id) && equal(r.destination, destination) &&
      !broadcast(destination) && r.state == MessageState::Transmitted) { r.state = MessageState::Acknowledged; return true; }
  return false;
}
} // namespace reaper::device
