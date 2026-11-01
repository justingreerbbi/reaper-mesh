#include "reaper/radio_packet.hpp"
#include "reaper/protocol.hpp"
#include <cstring>
namespace reaper::mesh {
namespace {
void write(std::uint8_t* p, std::uint64_t value, unsigned size) { for (unsigned i = 0; i < size; ++i) p[i] = static_cast<std::uint8_t>(value >> (i * 8)); }
std::uint64_t read(const std::uint8_t* p, unsigned size) { std::uint64_t v = 0; for (unsigned i = 0; i < size; ++i) v |= std::uint64_t(p[i]) << (i * 8); return v; }
}
bool valid_packet(const Packet& p) {
  bool nonce = false; for (auto byte : p.key.boot) nonce = nonce || byte != 0;
  if (!p.key.origin || p.key.origin == kBroadcast || !p.destination || !p.key.sequence || !nonce || p.hops > 7 || p.channel > 7) return false;
  if (p.kind == PacketKind::Ack) return p.destination != kBroadcast && !p.count && !p.index && !p.total && !p.size;
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
  if (!valid_packet(p)) return false;
  std::memcpy(p.bytes.data(), bytes + 50, p.size); out = p; return true;
}
} // namespace reaper::mesh
