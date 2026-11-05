#pragma once
#include "reaper/frame.hpp"
namespace reaper::mesh {
enum class SendState { Queued, Transmitted, Acknowledged, Failed };
// Handled includes frames relayed without being read. Control hands discovery traffic back.
enum class Received { Dropped, Handled, Control };
struct Outbound {
  bool used = false;
  MessageKey key{};
  std::uint64_t destination = 0;
  std::uint32_t channel = 0;
  std::array<std::uint8_t, 1024> bytes{};
  std::size_t size = 0;
  std::uint8_t part = 0, rounds = 0, failures = 0;
  std::uint64_t due = 0, deadline = 0;
  bool early_ack = false;
  SendState state = SendState::Queued;
};
struct Inbound {
  bool used = false, complete = false, poisoned = false;
  MessageKey key{};
  std::uint64_t destination = 0, deadline = 0, next_ack = 0;
  std::uint32_t channel = 0;
  std::uint16_t size = 0;
  std::uint8_t received = 0, count = 0;
  std::array<std::uint8_t, 1024> bytes{};
};
// Serialized core. next_tx/complete_tx are the sole radio adapter boundary.
// No register I/O, RF claims, heap allocation or wall-clock ownership.
class Mesh {
 public:
  explicit Mesh(std::uint64_t node, bool relay = false, ChannelSet channels = {},
                std::uint8_t hops = 3)
      : node_(node), relay_(relay), channels_(channels), hops_(hops <= 7 ? hops : 0) {}
  bool enqueue(const MessageKey&, std::uint64_t destination, std::uint32_t channel,
               const std::uint8_t*, std::size_t, std::uint64_t now);
  Received receive(const std::uint8_t*, std::size_t, std::uint64_t now, Packet& control);
  bool receive(const std::uint8_t* bytes, std::size_t size, std::uint64_t now) {
    Packet ignored{};
    return receive(bytes, size, now, ignored) == Received::Handled;
  }
  bool next_tx(std::uint64_t now, Frame&);
  FrameLink& link() { return link_; }
  void complete_tx(bool success, std::uint64_t now);
  void tick(std::uint64_t now);
  void quiesce();
  void policy(bool relay, const ChannelSet& channels) {
    quiesce();
    relay_ = relay;
    channels_ = channels;
  }
  const std::array<Outbound, 8>& outgoing() const { return out_; }
  const std::array<Inbound, 8>& incoming() const { return in_; }

 private:
  struct Forward {
    bool used = false;
    Frame frame{};
    std::uint64_t due = 0;
  };
  struct Seen {
    bool used = false;
    std::array<std::uint8_t, 8> nonce{};
    std::uint64_t until = 0;
  };
  FrameLink link_{};
  std::uint64_t node_;
  bool relay_;
  ChannelSet channels_;
  std::uint8_t hops_;
  std::array<Outbound, 8> out_{};
  std::array<Inbound, 8> in_{};
  std::array<Forward, 16> forward_{};
  std::array<Seen, 64> seen_{};
  bool boot_set_ = false;
  std::uint32_t boot_ = 0;
  std::uint32_t highest_ = 0;
  std::uint64_t submitted_ = 0;
  bool in_flight_ = false;
  int flight_index_ = -1;
  std::size_t next_out_ = 0;
  bool queue_frame(const Frame&, std::uint64_t now);
  bool relay_frame(const std::uint8_t*, std::size_t, std::uint64_t now);
  bool seen(const std::uint8_t* frame, std::uint64_t now);
  void ack(Inbound&, std::uint64_t now);
};
}  // namespace reaper::mesh
