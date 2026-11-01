#pragma once
#include "reaper/configuration.hpp"
namespace reaper::device {
struct RadioInfo {
  Text<64> state{}, reason{};
  bool probe = false;
  std::uint32_t transmitted = 0, received = 0, revision = 0, heap_free = 0, stack_free = 0;
};
struct InboxItem {
  bool used = false; std::uint32_t sequence = 0, channel = 0;
  Text<64> origin{}, message_id{};
  std::array<std::uint8_t, 1024> bytes{};
  std::size_t size = 0;
};
class Inbox {
 public:
  static constexpr std::size_t kCapacity = 8;
  bool append(const Text<64>& origin, const Text<64>& message_id, std::uint32_t channel,
    const std::uint8_t*, std::size_t);
  const InboxItem* find(std::uint32_t sequence) const;
  std::uint32_t oldest() const;
  std::uint32_t latest() const { return sequence_; }
 private:
  std::array<InboxItem, kCapacity> items_{};
  std::uint32_t sequence_ = 0;
};
} // namespace reaper::device
