#include "reaper/frame.hpp"
#include <cstring>
#include <iostream>
#include <string>
namespace m = reaper::mesh;
namespace c = reaper::crypto;
#define CHECK(v)                                              \
  do {                                                        \
    if (!(v)) {                                               \
      std::cerr << "line " << __LINE__ << ": " << #v << '\n'; \
      return 1;                                               \
    }                                                         \
  } while (false)
namespace {
c::Key filled(std::uint8_t value) {
  c::Key key{};
  key.fill(value);
  return key;
}
struct Keys {
  m::RelayKeys relay{};
  c::Key frame{};
};
// The chains at an epoch, as the vectors in packages/protocol/fixtures/frame-v2.json define them.
Keys keys(std::uint8_t relay_seed, std::uint8_t team_seed, unsigned epoch) {
  auto relay = filled(relay_seed), team = filled(team_seed);
  for (unsigned i = 0; i < epoch; ++i) {
    m::ratchet_chain(relay);
    m::ratchet_chain(team);
  }
  Keys out{};
  m::derive_relay_keys(relay, out.relay);
  m::derive_frame_key(team, out.frame);
  return out;
}
m::FrameRoute route(std::uint16_t epoch = 3, std::uint8_t hops = 3, std::uint8_t limit = 3) {
  m::FrameRoute r{};
  r.epoch = epoch;
  r.hops = hops;
  r.limit = limit;
  r.nonce = {1, 2, 3, 4, 5, 6, 7, 8};
  return r;
}
m::FrameFields data() {
  m::FrameFields f{};
  f.channel = 0x0a0b0c0d;
  f.origin = 0x0102030405060708ULL;
  f.destination = 0x1112131415161718ULL;
  f.boot = 7;
  f.sequence = 9;
  f.count = 1;
  f.total = f.size = 5;
  std::memcpy(f.bytes.data(), "hello", 5);
  return f;
}
m::FrameFields ack() {
  auto f = data();
  f.kind = m::PacketKind::Ack;
  f.count = f.index = f.size = 0;
  f.total = 0;
  return f;
}
using Frame = std::array<std::uint8_t, m::kMaxFrameBytes>;
void hex(const Frame& frame, std::size_t size) {
  constexpr char digits[] = "0123456789abcdef";
  for (std::size_t i = 0; i < size; ++i)
    std::cout << digits[frame[i] >> 4] << digits[frame[i] & 15];
  std::cout << '\n';
}
bool same(const m::FrameFields& a, const m::FrameFields& b) {
  return a.kind == b.kind && a.channel == b.channel && a.boot == b.boot &&
         a.sequence == b.sequence && a.origin == b.origin && a.destination == b.destination &&
         a.count == b.count && a.index == b.index && a.size == b.size && a.total == b.total &&
         !std::memcmp(a.bytes.data(), b.bytes.data(), a.size);
}
}  // namespace
int main(int argc, char** argv) {
  if (argc != 2)
    return 2;
  const std::string scenario = argv[1];
  const auto k = keys(0x11, 0x22, 3);
  Frame frame{};
  std::size_t size = 0;
  if (scenario == "golden") {
    CHECK(m::seal_frame(data(), route(), k.relay, k.frame, frame.data(), frame.size(), size));
    hex(frame, size);
    CHECK(m::seal_frame(ack(), route(), k.relay, k.frame, frame.data(), frame.size(), size));
    hex(frame, size);
    c::Key relay{}, team{};
    CHECK(m::open_mode_chains(relay, team));
    Keys open{};
    CHECK(m::derive_relay_keys(relay, open.relay) && m::derive_frame_key(team, open.frame));
    CHECK(m::seal_frame(data(), route(0), open.relay, open.frame, frame.data(), frame.size(),
                        size));
    hex(frame, size);
    return 0;
  }
  if (scenario == "hmac") {  // RFC 4231 test case 1.
    const auto key = filled(0x0b);
    const char text[] = "Hi There";
    const c::Slice part{reinterpret_cast<const std::uint8_t*>(text), 8};
    c::Key out{};
    CHECK(c::hmac_sha256(key.data(), 20, &part, 1, out));
    constexpr std::array<std::uint8_t, 32> expected{
        0xb0, 0x34, 0x4c, 0x61, 0xd8, 0xdb, 0x38, 0x53, 0x5c, 0xa8, 0xaf,
        0xce, 0xaf, 0x0b, 0xf1, 0x2b, 0x88, 0x1d, 0xc2, 0x00, 0xc9, 0x83,
        0x3d, 0xa7, 0x26, 0xe9, 0x37, 0x6c, 0x2e, 0x32, 0xcf, 0xf7};
    CHECK(out == expected);
  } else if (scenario == "roundtrip") {
    auto f = data();
    f.count = 7;
    f.index = 2;
    f.total = 1024;
    f.size = 160;
    for (std::size_t i = 0; i < f.size; ++i)
      f.bytes[i] = static_cast<std::uint8_t>(i);
    CHECK(m::seal_frame(f, route(), k.relay, k.frame, frame.data(), frame.size(), size));
    CHECK(size == m::kMaxFrameBytes);
    CHECK(m::verify_relay_tag(frame.data(), size, k.relay));
    m::FrameFields out{};
    CHECK(m::open_frame(frame.data(), size, k.frame, out));
    CHECK(same(f, out));
    CHECK(m::seal_frame(ack(), route(), k.relay, k.frame, frame.data(), frame.size(), size));
    CHECK(size == m::kFrameOverheadBytes);
    CHECK(m::verify_relay_tag(frame.data(), size, k.relay));
    CHECK(m::open_frame(frame.data(), size, k.frame, out));
    CHECK(same(ack(), out));
    // Nothing identifying travels in the clear.
    CHECK(m::seal_frame(data(), route(), k.relay, k.frame, frame.data(), frame.size(), size));
    const auto f2 = data();
    std::array<std::uint8_t, 8> origin{};
    for (unsigned i = 0; i < 8; ++i)
      origin[i] = static_cast<std::uint8_t>(f2.origin >> (i * 8));
    for (std::size_t i = 0; i + 8 <= size; ++i)
      CHECK(std::memcmp(frame.data() + i, origin.data(), 8) != 0);
  } else if (scenario == "relay") {
    // A relay holds only the relay keys: it can check and forward, and hops can change in transit.
    CHECK(m::seal_frame(data(), route(), k.relay, k.frame, frame.data(), frame.size(), size));
    for (unsigned hops = 3; hops > 0; --hops) {
      CHECK(m::verify_relay_tag(frame.data(), size, k.relay));
      CHECK(m::decrement_hops(frame.data(), size));
    }
    CHECK(!m::decrement_hops(frame.data(), size));
    CHECK(m::verify_relay_tag(frame.data(), size, k.relay));
    m::FrameFields out{};
    CHECK(m::open_frame(frame.data(), size, k.frame, out));
    CHECK(same(data(), out));
    // A thief with a relay key gets a frame forwarded, but team members reject it.
    const auto forged = keys(0x11, 0x33, 3);
    CHECK(m::seal_frame(data(), route(), forged.relay, forged.frame, frame.data(), frame.size(),
                        size));
    CHECK(m::verify_relay_tag(frame.data(), size, k.relay));
    CHECK(!m::open_frame(frame.data(), size, k.frame, out));
    // A team key alone does not satisfy relays.
    const auto outsider = keys(0x44, 0x22, 3);
    CHECK(m::seal_frame(data(), route(), outsider.relay, outsider.frame, frame.data(), frame.size(),
                        size));
    CHECK(!m::verify_relay_tag(frame.data(), size, k.relay));
  } else if (scenario == "keys") {
    // Chains are independent, one epoch's keys do not open another's frames, and they repeat.
    const auto next = keys(0x11, 0x22, 4);
    CHECK(k.relay.tag != next.relay.tag && k.frame != next.frame);
    const auto again = keys(0x11, 0x22, 3);
    CHECK(k.relay.tag == again.relay.tag && k.relay.hint == again.relay.hint &&
          k.frame == again.frame);
    CHECK(k.relay.tag != k.frame);
    CHECK(m::seal_frame(data(), route(), k.relay, k.frame, frame.data(), frame.size(), size));
    m::FrameFields out{};
    CHECK(!m::verify_relay_tag(frame.data(), size, next.relay));
    CHECK(!m::open_frame(frame.data(), size, next.frame, out));
    // Changing the epoch field invalidates both tags under the right keys.
    frame[3] ^= 1;
    CHECK(!m::verify_relay_tag(frame.data(), size, k.relay));
    CHECK(!m::open_frame(frame.data(), size, k.frame, out));
  } else if (scenario == "tamper") {
    CHECK(m::seal_frame(data(), route(3, 2, 3), k.relay, k.frame, frame.data(), frame.size(),
                        size));
    const auto original = frame;
    for (std::size_t bit = 0; bit < size * 8; ++bit) {
      frame = original;
      frame[bit / 8] ^= static_cast<std::uint8_t>(1u << (bit % 8));
      // Current hops are deliberately untagged, but stay bounded by the tagged limit.
      if (bit / 8 == 5 && bit % 8 < 3) {
        m::FrameRoute r{};
        if (m::parse_route(frame.data(), size, r)) {
          CHECK(r.hops <= 3);
          CHECK(m::verify_relay_tag(frame.data(), size, k.relay));
        }
        continue;
      }
      CHECK(!m::verify_relay_tag(frame.data(), size, k.relay));
    }
    // With the relay tag out of the way, the team tag still catches every other change.
    m::FrameFields out{};
    for (std::size_t bit = 0; bit < (size - m::kFrameRelayTagBytes) * 8; ++bit) {
      if (bit / 8 == 5 && bit % 8 < 3)
        continue;
      frame = original;
      frame[bit / 8] ^= static_cast<std::uint8_t>(1u << (bit % 8));
      m::FrameRoute r{};
      if (m::parse_route(frame.data(), size, r))
        CHECK(!m::open_frame(frame.data(), size, k.frame, out));
    }
    frame = original;
    CHECK(m::open_frame(frame.data(), size, k.frame, out));
  } else if (scenario == "malformed") {
    CHECK(m::seal_frame(data(), route(), k.relay, k.frame, frame.data(), frame.size(), size));
    m::FrameRoute r{};
    CHECK(!m::parse_route(nullptr, size, r));
    for (std::size_t shorter = 0; shorter < m::kFrameOverheadBytes; ++shorter)
      CHECK(!m::parse_route(frame.data(), shorter, r));
    CHECK(!m::parse_route(frame.data(), m::kMaxFrameBytes + 1, r));
    m::FrameFields out = data();
    out.sequence = 1234;
    for (std::size_t shorter = 0; shorter < size; ++shorter)
      CHECK(!m::open_frame(frame.data(), shorter, k.frame, out));
    CHECK(out.sequence == 1234);
    auto bad = frame;
    bad[0] = 1;
    CHECK(!m::parse_route(bad.data(), size, r));
    bad = frame;
    bad[0] = 0x12;
    CHECK(!m::parse_route(bad.data(), size, r));
    bad = frame;
    bad[5] = 0x34;  // More hops than the limit.
    CHECK(!m::parse_route(bad.data(), size, r));
    bad = frame;
    bad[5] = 0x83;  // A reserved bit.
    CHECK(!m::parse_route(bad.data(), size, r));
    // Sealing refuses invalid fields and writes nothing.
    auto f = data();
    f.origin = 0;
    CHECK(!m::seal_frame(f, route(), k.relay, k.frame, frame.data(), frame.size(), size));
    CHECK(size == 0);
    f = data();
    f.origin = m::kBroadcast;
    CHECK(!m::valid_frame_fields(f));
    f = data();
    f.boot = 0;
    CHECK(!m::valid_frame_fields(f));
    f = data();
    f.sequence = 0;
    CHECK(!m::valid_frame_fields(f));
    f = data();
    f.channel = m::ChannelSet::kNoChannel;
    CHECK(!m::valid_frame_fields(f));
    f = data();
    f.kind = static_cast<m::PacketKind>(9);
    CHECK(!m::valid_frame_fields(f));
    f = ack();
    f.destination = m::kBroadcast;
    CHECK(!m::valid_frame_fields(f));
    f = data();
    f.count = 2;
    CHECK(!m::valid_frame_fields(f));
    f = data();
    f.kind = m::PacketKind::Beacon;
    CHECK(!m::valid_frame_fields(f));  // Controls stay on channel 0.
    CHECK(!m::seal_frame(data(), route(3, 4, 3), k.relay, k.frame, frame.data(), frame.size(),
                         size));
    CHECK(!m::seal_frame(data(), route(), k.relay, k.frame, frame.data(), 10, size));
    // A valid key holder sealing nonsense directly is refused when opened, and publishes nothing.
    std::array<std::uint8_t, m::kFrameHeaderBytes> plain{};
    plain[0] = 1;
    CHECK(m::seal_frame(ack(), route(), k.relay, k.frame, frame.data(), frame.size(), size));
    std::array<std::uint8_t, c::kCcmNonceBytes> nonce{};
    std::memcpy(nonce.data(), frame.data() + 6, 8);
    std::memcpy(nonce.data() + 8, frame.data() + 3, 2);
    std::array<std::uint8_t, m::kFrameClearBytes> clear{};
    std::memcpy(clear.data(), frame.data(), clear.size());
    clear[5] &= 0x70;
    CHECK(c::aes256_ccm_seal(k.frame, nonce.data(), clear.data(), clear.size(), plain.data(),
                             plain.size(), frame.data() + m::kFrameClearBytes,
                             frame.data() + m::kFrameClearBytes + plain.size()));
    out.sequence = 1234;
    CHECK(!m::open_frame(frame.data(), size, k.frame, out));
    CHECK(out.sequence == 1234);
  } else {
    return 2;
  }
  std::cout << "ok " << scenario << '\n';
  return 0;
}
