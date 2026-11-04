#include "reaper/radio_packet.hpp"
#include "reaper/protocol.hpp"
#include <iostream>
#include <string>
#include <cstring>
namespace m = reaper::mesh;
#define CHECK(v)                                              \
  do {                                                        \
    if (!(v)) {                                               \
      std::cerr << "line " << __LINE__ << ": " << #v << '\n'; \
      return 1;                                               \
    }                                                         \
  } while (false)
m::Packet sample() {
  m::Packet p{};
  p.key.origin = 0x0102030405060708ULL;
  p.destination = m::kBroadcast;
  for (unsigned i = 0; i < 16; ++i)
    p.key.boot[i] = i;
  p.key.sequence = 1;
  p.hops = 3;
  p.count = 1;
  p.total = p.size = 2;
  p.bytes[0] = 'h';
  p.bytes[1] = 'i';
  return p;
}
int main(int argc, char** argv) {
  if (argc != 2)
    return 2;
  const std::string scenario = argv[1];
  auto p = sample();
  std::array<std::uint8_t, m::kMaxPacketBytes> bytes{};
  std::size_t size = 0;
  CHECK(m::encode_packet(p, bytes.data(), bytes.size(), size));
  if (scenario == "golden") {
    constexpr char digits[] = "0123456789abcdef";
    for (std::size_t i = 0; i < size; ++i)
      std::cout << digits[bytes[i] >> 4] << digits[bytes[i] & 15];
    std::cout << '\n';
    return 0;
  }
  if (scenario == "roundtrip") {
    m::Packet decoded{};
    CHECK(m::decode_packet(bytes.data(), size, decoded));
    CHECK(decoded.key == p.key && decoded.bytes[1] == 'i');
    p.total = 1024;
    p.count = 7;
    p.index = 0;
    p.size = 160;
    CHECK(m::encode_packet(p, bytes.data(), bytes.size(), size) && size == 214);
    p.index = 6;
    p.size = 64;
    CHECK(m::encode_packet(p, bytes.data(), bytes.size(), size));
    CHECK(m::decode_packet(bytes.data(), size, decoded) && decoded.total == 1024 &&
          decoded.index == 6);
    p.kind = m::PacketKind::Ack;
    p.destination = 42;
    p.count = p.index = p.size = p.total = 0;
    CHECK(m::encode_packet(p, bytes.data(), bytes.size(), size) && size == 54);
    CHECK(m::decode_packet(bytes.data(), size, decoded) && decoded.kind == m::PacketKind::Ack);
  } else if (scenario == "encrypted") {
    // RME2 carries the 32-bit channel ID at bytes 5-8 (D45).
    const std::uint32_t channel = 0x9c41e2a7;
    std::array<std::uint8_t, 77> envelope{};
    envelope[0] = 'R';
    envelope[1] = 'M';
    envelope[2] = 'E';
    envelope[3] = 2;
    envelope[4] = 1;
    for (unsigned i = 0; i < 4; ++i)
      envelope[5 + i] = static_cast<std::uint8_t>(channel >> (8 * i));
    envelope[9] = 0x42;
    envelope[17] = 1;
    CHECK(m::encrypted_payload(envelope.data(), envelope.size(), channel));
    CHECK(m::valid_message_payload(envelope.data(), envelope.size(), channel));
    CHECK(!m::valid_message_payload(envelope.data(), envelope.size(), channel ^ 1));
    CHECK(!m::encrypted_payload(envelope.data(), envelope.size() - 1, channel));
    for (std::uint8_t version : {1, 3}) {  // the old RME1 and unknown versions are refused
      envelope[3] = version;
      CHECK(!m::valid_message_payload(envelope.data(), envelope.size(), channel));
    }
    CHECK(m::valid_message_payload(reinterpret_cast<const std::uint8_t*>("plain"), 5, 1));
    // Header channels are full 32-bit IDs now; only the reserved all-ones value is invalid.
    p.channel = channel;
    CHECK(m::valid_packet(p));
    p.channel = 0xffffffff;
    CHECK(!m::valid_packet(p));
  } else if (scenario == "malformed") {
    for (std::size_t bit = 0; bit < size * 8; ++bit) {
      auto changed = bytes;
      changed[bit / 8] ^= 1u << (bit % 8);
      m::Packet out{};
      out.key.sequence = 99;
      CHECK(!m::decode_packet(changed.data(), size, out));
      CHECK(out.key.sequence == 99);
    }
    for (std::size_t length = 0; length < size; ++length) {
      m::Packet out{};
      CHECK(!m::decode_packet(bytes.data(), length, out));
    }
    for (unsigned offset : {2u, 3u, 44u, 45u, 46u, 47u}) {
      auto changed = bytes;
      changed[offset] = 255;
      auto crc = reaper::protocol::crc32(changed.data(), size - 4);
      for (unsigned i = 0; i < 4; ++i)
        changed[size - 4 + i] = crc >> (i * 8);
      m::Packet out{};
      CHECK(!m::decode_packet(changed.data(), size, out));
    }
    p.key.boot.fill(0);
    CHECK(!m::valid_packet(p));
    p = sample();
    p.count = 7;
    CHECK(!m::valid_packet(p));
    p = sample();
    p.kind = m::PacketKind::Ack;
    p.total = p.size = p.count = 0;
    CHECK(!m::valid_packet(p));
    CHECK(!m::encode_packet(sample(), bytes.data(), 1, size) && size == 0);
  } else
    return 3;
  std::cout << "ok " << scenario << '\n';
}
