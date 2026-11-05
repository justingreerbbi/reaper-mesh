#pragma once
#include "reaper/configuration.hpp"
#include "reaper/messages.hpp"
#include "reaper/inbox.hpp"
#include "reaper/discovery.hpp"

namespace reaper::device {
// Bluetooth pairing as seen over the host protocol (D47).
struct PairingView {
  const char* state = "closed";  // closed, open, passkey, full, paired, failed, forgotten or
                                 // unavailable
  int passkey = -1;              // negative when none is showing
  std::uint32_t seconds = 0, bonds = 0;
  const char* name = "";  // advertised name while open
};
class PairingControl {
 public:
  virtual void open(std::uint64_t now) = 0;
  virtual PairingView view(std::uint64_t now) const = 0;

 protected:
  ~PairingControl() = default;
};
// Which network the radio belongs to, as seen over the host protocol (D50).
enum class NetworkMode : std::uint8_t { Unset = 0, Open = 1, Team = 2 };
struct NetworkView {
  std::uint32_t mode = 0, generation = 0, epoch = 0;
  bool team_loaded = false, healthy = false;
  char relay_fingerprint[17]{}, team_fingerprint[17]{};
};
class NetworkControl {
 public:
  virtual NetworkView view() const = 0;
  // Each returns the reply state: "ok" or the reason for refusing.
  virtual const char* fill(std::uint32_t mode, std::uint32_t generation, std::uint32_t epoch,
                           const std::array<std::uint8_t, 32>* relay_chain,
                           const std::array<std::uint8_t, 32>* device_key) = 0;
  virtual const char* load_team(std::uint32_t generation, std::uint32_t epoch,
                                const std::array<std::uint8_t, 32>& team_chain) = 0;
  virtual const char* erase() = 0;

 protected:
  ~NetworkControl() = default;
};
// One physical USB/UART peer. Retains authority across logical reconnects.
class Session {
 public:
  Session(Configuration& authority, Text<64> device, Text<64> boot,
          MessageQueue* messages = nullptr, RadioInfo* radio = nullptr, Inbox* inbox = nullptr,
          Discovery* discovery = nullptr, PairingControl* pairing = nullptr,
          NetworkControl* network = nullptr);
  void tick(std::uint64_t now) {
    now_ = now;
    if (messages_)
      messages_->tick(now);
  }
  bool handle(const protocol::Message& request, protocol::Message& reply);
  bool take_error(protocol::Message& reply);
  // An unsolicited alert that a new message is in the inbox, for an agent that asked for alerts.
  // Mark it sent only once it was written. It is a hint: agents still read by query.
  bool take_alert(protocol::Message& alert);
  void alert_sent();
  void reset();
  // Whether the next request arrived over a link that proves physical access: USB, not Bluetooth.
  // Only such a link may open pairing, see a passkey or change keys without a button press.
  void set_physical(bool physical) { physical_ = physical; }
  bool synchronized() const { return active_ && compatible_ && synchronized_; }

 private:
  Configuration& authority_;
  MessageQueue* messages_ = nullptr;
  RadioInfo* radio_ = nullptr;
  Inbox* inbox_ = nullptr;
  Discovery* discovery_ = nullptr;
  PairingControl* pairing_ = nullptr;
  NetworkControl* network_ = nullptr;
  std::uint32_t agent_features_ = 0, alerted_ = 0;
  bool physical_ = false;
  struct NodeView {
    mesh::MessageKey key{};
    Text<64> name{};
    mesh::PositionReport position{};
    std::uint64_t seen = 0;
  };
  std::array<NodeView, 32> node_snapshot_{};
  std::uint32_t node_generation_ = 0;
  std::size_t node_count_ = 0;
  std::uint64_t now_ = 0;
  Text<64> device_, boot_, link_{}, owner_{};
  bool active_ = false, compatible_ = false, admitted_ = false, synchronized_ = false,
       fault_ = false;
  void error(protocol::Message& reply) const;
};
}  // namespace reaper::device
