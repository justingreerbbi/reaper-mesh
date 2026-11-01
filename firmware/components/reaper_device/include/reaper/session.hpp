#pragma once
#include "reaper/configuration.hpp"
#include "reaper/messages.hpp"
#include "reaper/inbox.hpp"

namespace reaper::device {
// One physical USB/UART peer. Retains authority across logical reconnects.
class Session {
 public:
  Session(Configuration& authority, Text<64> device, Text<64> boot, MessageQueue* messages = nullptr, RadioInfo* radio = nullptr, Inbox* inbox = nullptr);
  void tick(std::uint64_t now) { now_ = now; if (messages_) messages_->tick(now); }
  bool handle(const protocol::Message& request, protocol::Message& reply);
  bool take_error(protocol::Message& reply);
  void reset();
  bool synchronized() const { return active_ && compatible_ && synchronized_; }
 private:
  Configuration& authority_;
  MessageQueue* messages_ = nullptr;
  RadioInfo* radio_ = nullptr;
  Inbox* inbox_ = nullptr;
  std::uint64_t now_ = 0;
  Text<64> device_, boot_, link_{}, owner_{};
  bool active_ = false, compatible_ = false, admitted_ = false, synchronized_ = false, fault_ = false;
  void error(protocol::Message& reply) const;
};
} // namespace reaper::device
