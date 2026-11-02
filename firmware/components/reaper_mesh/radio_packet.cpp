#include "reaper/radio_packet.hpp"
#include "reaper/protocol.hpp"
#include <cstring>
namespace reaper::mesh {
namespace {
void write(std::uint8_t* p, std::uint64_t value, unsigned size) { for (unsigned i = 0; i < size; ++i) p[i] = static_cast<std::uint8_t>(value >> (i * 8)); }
std::uint64_t read(const std::uint8_t* p, unsigned size) { std::uint64_t v = 0; for (unsigned i = 0; i < size; ++i) v |= std::uint64_t(p[i]) << (i * 8); return v; }
}
PositionReport position_report(const Packet& p) {
  if (p.bytes[0] != 2) return {};
  const auto* extra = p.bytes.data() + 2 + p.bytes[1] + (p.kind == PacketKind::Presence ? 20 : 0);
  return {extra[0], static_cast<std::uint32_t>(read(extra + 1, 4)), static_cast<std::uint32_t>(read(extra + 5, 4)), static_cast<std::uint32_t>(read(extra + 9, 4))};
}
bool encrypted_payload(const std::uint8_t* bytes, std::size_t size, std::uint32_t channel) {
  if (!bytes || size < 74 || size > kMaxMessageBytes || bytes[0] != 'R' || bytes[1] != 'M' || bytes[2] != 'E' || bytes[3] != 1 ||
      bytes[4] != 1 || bytes[5] != channel || channel > 7) return false;
  bool key_id = false; for (std::size_t i = 6; i < 14; ++i) key_id = key_id || bytes[i];
  return key_id && read(bytes + 14, 4) != 0;
}
bool valid_message_payload(const std::uint8_t* bytes, std::size_t size, std::uint32_t channel) {
  if (!bytes || !size || size > kMaxMessageBytes) return false;
  if (size >= 4 && bytes[0] == 'R' && bytes[1] == 'M' && bytes[2] == 'E' && bytes[3] == 1)
    return encrypted_payload(bytes, size, channel);
  return protocol::valid_message_text(bytes, size);
}
bool valid_packet(const Packet& p) {
  bool nonce = false; for (auto byte : p.key.boot) nonce = nonce || byte != 0;
  if (!p.key.origin || p.key.origin == kBroadcast || !p.destination || !p.key.sequence || !nonce || p.hops > 7 || p.channel > 7) return false;
  if (p.kind == PacketKind::Ack) return p.destination != kBroadcast && !p.count && !p.index && !p.total && !p.size;
  if (p.kind == PacketKind::Beacon || p.kind == PacketKind::Discover || p.kind == PacketKind::Presence) {
    const bool reply = p.kind == PacketKind::Presence;
    if (p.channel || p.hops != 1 || p.count != 1 || p.index || p.total != p.size || p.size < 2 || (p.bytes[0] != 1 && p.bytes[0] != 2) || p.bytes[1] > 64 ||
        p.size != 2u + p.bytes[1] + (reply ? 20u : 0u) + (p.bytes[0] == 2 ? 13u : 0u) || (reply ? p.destination == kBroadcast : p.destination != kBroadcast)) return false;
    if (p.bytes[0] == 2) {
      if (p.kind == PacketKind::Discover) return false; // Requests stay v1 so old listeners can respond.
      const auto position = position_report(p);
      if (position.source != 1 || position.latitude > 1800000000 || position.longitude > 3600000000U || position.age_ms) return false;
    }
    if (p.bytes[1] && !protocol::valid_message_text(p.bytes.data() + 2, p.bytes[1])) return false;
    for (std::size_t i = 2; i < 2u + p.bytes[1]; ++i) if (p.bytes[i] < 32 || p.bytes[i] == 127) return false;
    if (reply) { bool nonce = false; for (unsigned i = 0; i < 16; ++i) nonce = nonce || p.bytes[2 + p.bytes[1] + i]; if (!nonce || !read(p.bytes.data() + 18 + p.bytes[1], 4)) return false; }
    return true;
  }
  if (p.kind != PacketKind::Data || !p.total || p.total > kMaxMessageBytes ||
      p.count != (p.total + kFragmentBytes - 1) / kFragmentBytes || p.index >= p.count) return false;
  const auto expected = p.index + 1 < p.count ? kFragmentBytes : p.total - p.index * kFragmentBytes;
  return p.size == expected;
}
bool encode_packet(const Packet& p, std::uint8_t* out, std::size_t capacity, std::size_t& size) {
  size = 0; if (!out || !valid_packet(p) || capacity < 54u + p.size) return false;
  out[0] = 'R'; out[1] = 'M'; out[2] = 1; out[3] = static_cast<std::uint8_t>(p.kind);
  write(out + 4, p.channel, 4); write(out + 8, p.key.origin, 8); write(out + 16, p.destination, 8);
  std::memcpy(out + 24, p.key.boot.data(), 16); write(out + 40, p.key.sequence, 4);
  out[44] = p.count; out[45] = p.index; out[46] = p.hops; write(out + 47, p.total, 2); out[49] = p.size;
  std::memcpy(out + 50, p.bytes.data(), p.size); write(out + 50 + p.size, protocol::crc32(out, 50 + p.size), 4);
  size = 54 + p.size; return true;
}
bool decode_packet(const std::uint8_t* bytes, std::size_t size, Packet& out) {
  if (!bytes || size < 54 || size > kMaxPacketBytes || bytes[0] != 'R' || bytes[1] != 'M' || bytes[2] != 1 ||
      size != 54u + bytes[49] || protocol::crc32(bytes, size - 4) != read(bytes + size - 4, 4)) return false;
  Packet p{}; p.kind = static_cast<PacketKind>(bytes[3]); p.channel = static_cast<std::uint32_t>(read(bytes + 4, 4));
  p.key.origin = read(bytes + 8, 8); p.destination = read(bytes + 16, 8); std::memcpy(p.key.boot.data(), bytes + 24, 16);
  p.key.sequence = static_cast<std::uint32_t>(read(bytes + 40, 4)); p.count = bytes[44]; p.index = bytes[45]; p.hops = bytes[46];
  p.total = static_cast<std::uint16_t>(read(bytes + 47, 2)); p.size = bytes[49];
  if (p.size > p.bytes.size()) return false;
  std::memcpy(p.bytes.data(), bytes + 50, p.size);
  if (!valid_packet(p)) return false;
  out = p; return true;
}
} // namespace reaper::mesh
