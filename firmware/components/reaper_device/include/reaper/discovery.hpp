#pragma once
#include "reaper/configuration.hpp"
#include "reaper/radio_packet.hpp"
namespace reaper::device {
struct Peer {
  bool used = false;
  mesh::MessageKey key{};
  mesh::PositionReport position{};
  Text<64> name{};
  std::uint64_t seen = 0;
  std::uint32_t replied_to = 0;
  std::array<std::array<std::uint8_t, 16>, 4> retired{};
  std::uint8_t next_retired = 0;
};
struct DiscoveryResult {
  const char* state = "unknown";
  std::uint32_t replies = 0, sequence = 0;
};
class Discovery {
 public:
  Discovery(std::uint64_t node, std::array<std::uint8_t, 16> boot) : node_(node), boot_(boot) {}
  void policy(const Settings*, bool may_transmit, std::uint64_t now);
  DiscoveryResult request(const Text<64>& owner, const Text<75>& id, bool start, std::uint64_t now);
  DiscoveryResult query(const Text<75>& id, std::uint64_t now) const;
  bool receive(const mesh::Packet&, std::uint64_t now);
  bool next_tx(std::uint64_t now, mesh::Packet&);
  void complete_tx(bool success, std::uint64_t now);
  std::uint64_t flight_deadline() const { return flight_deadline_; }
  std::uint32_t generation() const { return generation_; }
  std::size_t count() const;
  const Peer* peer(std::size_t cursor) const;

 private:
  struct Mark {
    bool used = false;
    mesh::MessageKey key{};
    std::uint64_t until = 0;
  };
  struct Owner {
    Text<64> id{};
    std::uint32_t highest = 0;
  };
  struct Receipt {
    Text<75> id{};
    std::uint32_t sequence = 0, replies = 0;
    std::uint64_t end = 0;
    bool sent = false, failed = false;
  };
  struct Pending {
    bool used = false;
    mesh::Packet packet{};
    std::uint64_t due = 0, until = 0;
  };
  std::uint64_t node_;
  std::array<std::uint8_t, 16> boot_{};
  Settings settings_{};
  bool configured_ = false, allowed_ = false, flight_ = false;
  mesh::Packet flight_packet_{};
  std::uint64_t flight_deadline_ = 0;
  std::uint32_t sequence_ = 0, generation_ = 0;
  std::uint64_t next_beacon_ = 0, cooldown_ = 0;
  unsigned reply_count_ = 0, next_reply_ = 0;
  std::array<std::uint64_t, 6> reply_times_{};
  std::array<Peer, 32> peers_{};
  std::array<Mark, 16> marks_{};
  std::array<Owner, 8> owners_{};
  std::array<Receipt, 8> receipts_{};
  std::size_t next_receipt_ = 0;
  std::array<Pending, 4> pending_{};
  bool queue(mesh::PacketKind, std::uint64_t destination, const mesh::MessageKey* parent,
             std::uint64_t due, std::uint64_t until);
  bool observe(const mesh::Packet&, std::uint64_t now);
};
}  // namespace reaper::device
