#include "reaper/radio_packet.hpp"
#include "reaper/protocol.hpp"
#include <cstring>
namespace reaper::mesh {
namespace {
std::uint64_t read(const std::uint8_t* p, unsigned size) {
  std::uint64_t v = 0;
  for (unsigned i = 0; i < size; ++i)
    v |= std::uint64_t(p[i]) << (i * 8);
  return v;
}
}  // namespace
PositionReport position_report(const Packet& p) {
  if (p.bytes[0] != 2)
    return {};
  const auto* extra = p.bytes.data() + 2 + p.bytes[1] + (p.kind == PacketKind::Presence ? 8 : 0);
  return {extra[0], static_cast<std::uint32_t>(read(extra + 1, 4)),
          static_cast<std::uint32_t>(read(extra + 5, 4)),
          static_cast<std::uint32_t>(read(extra + 9, 4))};
}
namespace {
// RME2 envelope: magic, version 2, suite 1, channel ID (LE32), key ID (8), epoch (LE32), nonce
// (24), message ID (16), then ciphertext and a 16-byte tag.
bool encrypted_payload(const std::uint8_t* bytes, std::size_t size, std::uint32_t channel) {
  if (size < 77 || bytes[0] != 'R' || bytes[1] != 'M' || bytes[2] != 'E' || bytes[3] != 2 ||
      bytes[4] != 1 || read(bytes + 5, 4) != channel)
    return false;
  bool key_id = false;
  for (std::size_t i = 9; i < 17; ++i)
    key_id = key_id || bytes[i];
  return key_id && read(bytes + 17, 4) != 0;
}
}  // namespace
bool valid_message_payload(const std::uint8_t* bytes, std::size_t size) {
  return bytes && size && size <= kMaxMessageBytes;
}
bool readable_by_any_agent(const std::uint8_t* bytes, std::size_t size, std::uint32_t channel) {
  if (!valid_message_payload(bytes, size))
    return false;
  // Any envelope version counts as an envelope, so an unknown one is not taken as text.
  if (size >= 4 && bytes[0] == 'R' && bytes[1] == 'M' && bytes[2] == 'E' && bytes[3] < 32)
    return encrypted_payload(bytes, size, channel);
  return protocol::valid_message_text(bytes, size);
}
bool valid_frame_layout(const std::uint8_t* bytes, std::size_t size) {
  return bytes && size >= kMinPacketBytes && size <= kMaxPacketBytes && bytes[0] == 2 &&
         !(bytes[5] & 0x88) && (bytes[5] & 7) <= ((bytes[5] >> 4) & 7);
}
bool valid_packet(const Packet& p) {
  if (!p.key.origin || p.key.origin == kBroadcast || !p.destination || !p.key.sequence ||
      !p.key.boot || p.hops > 7 || p.size > kFragmentBytes || p.channel == ChannelSet::kNoChannel)
    return false;
  if (p.kind == PacketKind::Ack)
    return p.destination != kBroadcast && !p.count && !p.index && !p.total && !p.size;
  if (p.kind == PacketKind::Beacon || p.kind == PacketKind::Discover ||
      p.kind == PacketKind::Presence) {
    const bool reply = p.kind == PacketKind::Presence;
    // Controls are never relayed: hops and the hop limit are both zero.
    if (p.channel || p.hops || p.count != 1 || p.index || p.total != p.size || p.size < 2 ||
        (p.bytes[0] != 1 && p.bytes[0] != 2) || p.bytes[1] > 64 ||
        p.size != 2u + p.bytes[1] + (reply ? 8u : 0u) + (p.bytes[0] == 2 ? 13u : 0u) ||
        (reply ? p.destination == kBroadcast : p.destination != kBroadcast))
      return false;
    if (p.bytes[0] == 2) {
      if (p.kind == PacketKind::Discover)
        return false;  // Requests stay v1 so old listeners can respond.
      const auto position = position_report(p);
      if (position.source != 1 || position.latitude > 1800000000 ||
          position.longitude > 3600000000U || position.age_ms)
        return false;
    }
    if (p.bytes[1] && !protocol::valid_message_text(p.bytes.data() + 2, p.bytes[1]))
      return false;
    for (std::size_t i = 2; i < 2u + p.bytes[1]; ++i)
      if (p.bytes[i] < 32 || p.bytes[i] == 127)
        return false;
    if (reply) {
      const auto* parent = p.bytes.data() + 2 + p.bytes[1];  // The request's boot and sequence.
      if (!read(parent, 4) || !read(parent + 4, 4))
        return false;
    }
    return true;
  }
  if (p.kind != PacketKind::Data || !p.total || p.total > kMaxMessageBytes ||
      p.count != (p.total + kFragmentBytes - 1) / kFragmentBytes || p.index >= p.count)
    return false;
  const auto expected = p.index + 1 < p.count ? kFragmentBytes : p.total - p.index * kFragmentBytes;
  return p.size == expected;
}
}  // namespace reaper::mesh
