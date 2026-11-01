#pragma once
#include "reaper/configuration.hpp"

namespace reaper::device {
// One physical USB/UART peer. Retains authority across logical reconnects.
class Session {
 public:
  Session(Configuration& authority, Text<64> device, Text<64> boot);
  bool handle(const protocol::Message& request, protocol::Message& reply);
  bool take_error(protocol::Message& reply);
  void reset();
  bool synchronized() const { return active_ && compatible_ && synchronized_; }
 private:
  Configuration& authority_;
  Text<64> device_, boot_, link_{}, owner_{};
  bool active_ = false, compatible_ = false, admitted_ = false, synchronized_ = false, fault_ = false;
  void error(protocol::Message& reply) const;
};
} // namespace reaper::device
