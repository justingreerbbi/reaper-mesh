#include "reaper/inbox.hpp"
#include "reaper/radio_packet.hpp"
#include <cstring>
#include <limits>
namespace reaper::device {
namespace {
bool identity(const Text<64>& value) {
  if (!value.length || value.length > 64) return false;
  for (std::size_t i = 0; i < value.length; ++i) {
    const auto b = value.bytes[i];
    if (!((b >= 'A' && b <= 'Z') || (b >= 'a' && b <= 'z') || (b >= '0' && b <= '9') || b == '_' || b == '-')) return false;
  }
  return true;
}
bool equal(const Text<64>& a, const Text<64>& b) {
  return a.length <= 64 && a.length == b.length && std::memcmp(a.bytes.data(), b.bytes.data(), a.length) == 0;
}
}
bool Inbox::append(const Text<64>& origin, const Text<64>& id, const Text<64>& destination, std::uint32_t channel,
    const std::uint8_t* bytes, std::size_t size) {
  if (!identity(origin) || !identity(id) || !identity(destination) || channel > 7 || !mesh::valid_message_payload(bytes, size, channel)) return false;
  for (const auto& item : items_) if (item.used && equal(item.origin, origin) && equal(item.message_id, id))
    return item.destination.length == destination.length && !std::memcmp(item.destination.bytes.data(), destination.bytes.data(), destination.length) && item.channel == channel && item.size == size && std::memcmp(item.bytes.data(), bytes, size) == 0;
  if (sequence_ == std::numeric_limits<std::uint32_t>::max()) return false;
  const auto sequence = ++sequence_;
  auto& item = items_[(sequence - 1) % items_.size()]; item = {};
  item.used = true; item.sequence = sequence; item.channel = channel; item.origin = origin; item.message_id = id;
  item.destination = destination; item.size = size; std::memcpy(item.bytes.data(), bytes, size); return true;
}
const InboxItem* Inbox::find(std::uint32_t sequence) const {
  for (const auto& item : items_) if (item.used && item.sequence == sequence) return &item;
  return nullptr;
}
std::uint32_t Inbox::oldest() const { return !sequence_ ? 0 : sequence_ > items_.size() ? sequence_ - items_.size() + 1 : 1; }
} // namespace reaper::device
