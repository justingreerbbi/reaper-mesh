#include "reaper/radio_packet.hpp"
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
  p.key.boot = 1;
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
  if (scenario == "encrypted") {
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
    CHECK(m::readable_by_any_agent(envelope.data(), envelope.size(), channel));
    CHECK(!m::readable_by_any_agent(envelope.data(), envelope.size(), channel ^ 1));
    CHECK(!m::readable_by_any_agent(envelope.data(), envelope.size() - 1, channel));
    for (std::uint8_t version : {1, 3}) {  // the old RME1 and unknown versions are refused
      envelope[3] = version;
      CHECK(!m::readable_by_any_agent(envelope.data(), envelope.size(), channel));
    }
    CHECK(m::readable_by_any_agent(reinterpret_cast<const std::uint8_t*>("plain"), 5, 1));
    // Firmware carries anything of a legal size, and only agents decide what it means.
    const std::array<std::uint8_t, 3> binary{0xff, 0x00, 0xfe};
    CHECK(m::valid_message_payload(binary.data(), binary.size()));
    CHECK(!m::readable_by_any_agent(binary.data(), binary.size(), 1));
    CHECK(m::valid_message_payload(envelope.data(), envelope.size()));
    CHECK(!m::valid_message_payload(envelope.data(), 0));
    CHECK(!m::valid_message_payload(nullptr, 1));
    CHECK(!m::valid_message_payload(envelope.data(), m::kMaxMessageBytes + 1));
    // Header channels are full 32-bit IDs now; only the reserved all-ones value is invalid.
    p.channel = channel;
    CHECK(m::valid_packet(p));
    p.channel = 0xffffffff;
    CHECK(!m::valid_packet(p));
  } else if (scenario == "validation") {
    CHECK(m::valid_packet(p));
    p.total = 1024;
    p.count = 7;
    p.size = 160;
    CHECK(m::valid_packet(p));
    p.index = 6;
    p.size = 64;
    CHECK(m::valid_packet(p));
    p.size = 65;
    CHECK(!m::valid_packet(p));
    p = sample();
    p.key.boot = 0;
    CHECK(!m::valid_packet(p));
    p = sample();
    p.key.sequence = 0;
    CHECK(!m::valid_packet(p));
    p = sample();
    p.hops = 8;
    CHECK(!m::valid_packet(p));
    p = sample();
    p.count = 7;
    CHECK(!m::valid_packet(p));
    p = sample();
    p.kind = m::PacketKind::Ack;
    p.total = p.size = p.count = 0;
    CHECK(!m::valid_packet(p));  // ACKs are never broadcast.
    p.destination = 42;
    CHECK(m::valid_packet(p));
  } else
    return 3;
  std::cout << "ok " << scenario << '\n';
}
