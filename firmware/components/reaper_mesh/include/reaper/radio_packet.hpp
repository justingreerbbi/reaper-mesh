#pragma once
#include <array>
#include <cstdint>
#include <cstddef>
#include <limits>
namespace reaper::mesh {
// Radio version 2 frames: 58 bytes of overhead plus the fragment body (see frame.hpp).
inline constexpr std::size_t kFragmentBytes = 160, kMaxMessageBytes = 1024, kMinPacketBytes = 58,
                             kMaxPacketBytes = kMinPacketBytes + kFragmentBytes;
inline constexpr std::uint64_t kBroadcast = std::numeric_limits<std::uint64_t>::max();
enum class PacketKind : std::uint8_t { Data = 1, Ack = 2, Beacon = 3, Discover = 4, Presence = 5 };
struct MessageKey {
  std::uint64_t origin = 0;
  std::uint32_t boot = 0;  // Persisted counter; a new value after every reboot.
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
// A radio version 2 frame's layout, before any cryptography. Radio drivers use this to drop noise.
bool valid_frame_layout(const std::uint8_t*, std::size_t);
// Firmware carries any message of a legal size without understanding it (D41, D50). What the bytes
// mean is for agents to decide.
bool valid_message_payload(const std::uint8_t*, std::size_t);
// Plain text or the one envelope an agent can be assumed to understand. An agent that does not
// declare it handles unknown payloads gets a placeholder for anything else.
bool readable_by_any_agent(const std::uint8_t*, std::size_t, std::uint32_t channel);
}  // namespace reaper::mesh
