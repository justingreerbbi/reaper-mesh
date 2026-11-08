#pragma once
#include "reaper/frame.hpp"
#include "reaper/regional.hpp"
namespace reaper::mesh {
enum class SendState { Queued, Transmitted, Acknowledged, Failed };
// Handled includes frames relayed without being read. Control hands discovery traffic back. Proof
// hands back an epoch proof, which is forwarded only once the caller has found it new and valid.
enum class Received { Dropped, Handled, Control, Proof };
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
// How long an origin waits after sending one fragment before the next, so relays can forward it.
// A relay waits 10-100 ms, then sends the fragment for one airtime T, and can't listen meanwhile.
// With one relay, the next fragment must start after that: 2T + 100 ms. With two or more in a
// line, the second relay's copy must also be off the air around the first: 3T + 200 ms. Nodes
// three hops apart can't hear each other, so longer lines need no more. Plus 50 ms for polling.
// Hop limit 0 means nothing relays, so there is no wait.
constexpr std::uint64_t fragment_gap_ms(std::uint32_t airtime_us, std::uint8_t hops) {
  const std::uint64_t relays = hops < 2 ? hops : 2;
  const std::uint64_t t = (airtime_us + 999) / 1000;
  return relays ? (relays + 1) * t + relays * 100 + 50 : 0;
}
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
  // Forwards a frame the caller has finished checking.
  bool forward(const std::uint8_t* bytes, std::size_t size, std::uint64_t now) {
    return relay_frame(bytes, size, now);
  }
  // Announces an epoch this radio's agent has started.
  bool send_proof(std::uint16_t epoch, const crypto::Key& proof, std::uint64_t now);
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
  std::size_t flight_size_ = 0;
  std::size_t next_out_ = 0;
  bool queue_frame(const Frame&, std::uint64_t now);
  bool relay_frame(const std::uint8_t*, std::size_t, std::uint64_t now);
  bool seen(const std::uint8_t* frame, std::uint64_t now);
  void ack(Inbound&, std::uint64_t now);
};
}  // namespace reaper::mesh
