#pragma once
#include <array>
#include <cstdint>
#include <cstddef>
#include <limits>
namespace reaper::mesh {
inline constexpr std::size_t kFragmentBytes = 160, kMaxMessageBytes = 1024, kMaxPacketBytes = 214;
inline constexpr std::uint64_t kBroadcast = std::numeric_limits<std::uint64_t>::max();
enum class PacketKind : std::uint8_t { Data = 1, Ack = 2, Beacon = 3, Discover = 4, Presence = 5 };
struct MessageKey {
  std::uint64_t origin = 0;
  std::array<std::uint8_t, 16> boot{};
  std::uint32_t sequence = 0;
  bool operator==(const MessageKey& other) const {
    return origin == other.origin && boot == other.boot && sequence == other.sequence;
  }
};
struct Packet {
  PacketKind kind = PacketKind::Data;
  std::uint32_t channel = 0;
  MessageKey key{};
  std::uint64_t destination = 0;
  std::uint8_t count = 0, index = 0, hops = 0, size = 0;
  std::uint16_t total = 0;
  std::array<std::uint8_t, kFragmentBytes> bytes{};
};
// Channels this node uses, by on-air channel ID (D45). Public (ID 0) is always a member.
struct ChannelSet {
  std::array<std::uint32_t, 8> ids{};
  std::uint8_t count = 1;
  bool contains(std::uint32_t id) const {
    for (std::uint8_t i = 0; i < count; ++i)
      if (ids[i] == id)
        return true;
    return false;
  }
  bool add(std::uint32_t id) {
    if (contains(id))
      return true;
    if (count >= ids.size() || id == kNoChannel)
      return false;
    ids[count++] = id;
    return true;
  }
  static constexpr std::uint32_t kNoChannel = 0xffffffff;
};
struct PositionReport {
  std::uint8_t source = 0;
  std::uint32_t latitude = 0, longitude = 0, age_ms = 0;
};
// Call only after valid_packet: v1 has no position; v2 appends one fixed-position report.
PositionReport position_report(const Packet&);
bool valid_packet(const Packet&);
bool encrypted_payload(const std::uint8_t*, std::size_t, std::uint32_t channel);
bool valid_message_payload(const std::uint8_t*, std::size_t, std::uint32_t channel);
bool encode_packet(const Packet&, std::uint8_t*, std::size_t capacity, std::size_t& size);
bool decode_packet(const std::uint8_t*, std::size_t size, Packet&);
}  // namespace reaper::mesh
