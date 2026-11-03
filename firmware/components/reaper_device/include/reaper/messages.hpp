#pragma once
#include "reaper/configuration.hpp"
#include <cstdint>
namespace reaper::device {
enum class MessageState { Receiving, Queued, Transmitted, Acknowledged, Failed, Rejected, Unknown };
const char* message_state(MessageState);
struct MessageReceipt {
  MessageState state = MessageState::Unknown;
  std::uint32_t received = 0;
  Text<64> message_id{}, reason{};
};
struct MessageRecord {
  bool used = false;
  Text<75> request{};
  Text<64> destination{}, message_id{};
  std::uint32_t channel = 0, count = 0, received = 0;
  std::array<std::uint8_t, 1024> bytes{};
  std::size_t size = 0;
  std::uint64_t deadline = 0;
  MessageState state = MessageState::Receiving;
  Text<64> reason{};
};
// Single serialized execution context, no allocation, no implicit radio success.
class MessageQueue {
 public:
  static constexpr std::size_t kCapacity = 8;
  explicit MessageQueue(Text<64> boot) : boot_(boot) {}
  MessageReceipt submit(const Text<64>& owner, const Text<75>& id, std::uint32_t channel,
                        const Text<64>& destination, std::uint32_t part, std::uint32_t count,
                        const std::uint8_t* bytes, std::size_t size, std::uint64_t now);
  MessageReceipt query(const Text<75>& id) const;
  void tick(std::uint64_t now);
  void channels(std::uint8_t enabled) { channels_ = enabled; }
  void quiesce();
  bool fail(const Text<64>& message_id, const char* reason);
  bool local_accept(const Text<64>& message_id);
  bool transmitted(const Text<64>& message_id, std::uint64_t now);
  bool acknowledge(const Text<64>& message_id, const Text<64>& destination, std::uint64_t now);
  const std::array<MessageRecord, kCapacity>& records() const { return records_; }

 private:
  struct Owner {
    Text<64> id{};
    std::uint32_t highest = 0;
    bool used = false;
  };
  Text<64> boot_{};
  std::array<MessageRecord, kCapacity> records_{};
  std::array<Owner, 8> owners_{};
  std::uint8_t channels_ = 1;
  std::uint32_t counter_ = 0;
  std::size_t next_ = 0;
};
}  // namespace reaper::device
