#include "reaper/frame.hpp"
#include <algorithm>
#include <cstring>
#include <iostream>
#include <string>
#include <vector>
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
std::array<std::uint8_t, 8> kNonce{1, 2, 3, 4, 5, 6, 7, 8};
m::Packet data() {
  m::Packet p{};
  p.channel = 0x0a0b0c0d;
  p.key.origin = 0x0102030405060708ULL;
  p.destination = 0x1112131415161718ULL;
  p.key.boot = 7;
  p.key.sequence = 9;
  p.hops = 3;
  p.count = 1;
  p.total = p.size = 5;
  std::memcpy(p.bytes.data(), "hello", 5);
  return p;
}
m::Packet ack() {
  auto p = data();
  p.kind = m::PacketKind::Ack;
  p.count = p.index = p.size = 0;
  p.total = 0;
  return p;
}
using Bytes = std::array<std::uint8_t, m::kMaxFrameBytes>;
bool seal(const m::Packet& p, const Keys& k, Bytes& frame, std::size_t& size,
          std::uint16_t epoch = 3) {
  return m::seal_frame(p, epoch, kNonce, k.relay, k.frame, frame.data(), frame.size(), size);
}
void hex(const Bytes& frame, std::size_t size) {
  constexpr char digits[] = "0123456789abcdef";
  for (std::size_t i = 0; i < size; ++i)
    std::cout << digits[frame[i] >> 4] << digits[frame[i] & 15];
  std::cout << '\n';
}
bool same(const m::Packet& a, const m::Packet& b) {
  return a.kind == b.kind && a.channel == b.channel && a.key == b.key &&
         a.destination == b.destination && a.count == b.count && a.index == b.index &&
         a.size == b.size && a.total == b.total && a.hops == b.hops &&
         !std::memcmp(a.bytes.data(), b.bytes.data(), a.size);
}
}  // namespace
int main(int argc, char** argv) {
  if (argc != 2)
    return 2;
  const std::string scenario = argv[1];
  const auto k = keys(0x11, 0x22, 3);
  Bytes frame{};
  std::size_t size = 0;
  if (scenario == "golden") {
    CHECK(seal(data(), k, frame, size));
    hex(frame, size);
    CHECK(seal(ack(), k, frame, size));
    hex(frame, size);
    c::Key relay{}, team{};
    CHECK(m::open_mode_chains(relay, team));
    Keys open{};
    CHECK(m::derive_relay_keys(relay, open.relay) && m::derive_frame_key(team, open.frame));
    CHECK(seal(data(), open, frame, size, 0));
    hex(frame, size);
    return 0;
  }
  if (scenario == "hmac") {  // RFC 4231 test case 1.
    const auto key = filled(0x0b);
    const char text[] = "Hi There";
    const c::Slice part{reinterpret_cast<const std::uint8_t*>(text), 8};
    c::Key out{};
    CHECK(c::hmac_sha256(key.data(), 20, &part, 1, out));
    constexpr std::array<std::uint8_t, 32> expected{0xb0, 0x34, 0x4c, 0x61, 0xd8, 0xdb, 0x38, 0x53,
                                                    0x5c, 0xa8, 0xaf, 0xce, 0xaf, 0x0b, 0xf1, 0x2b,
                                                    0x88, 0x1d, 0xc2, 0x00, 0xc9, 0x83, 0x3d, 0xa7,
                                                    0x26, 0xe9, 0x37, 0x6c, 0x2e, 0x32, 0xcf, 0xf7};
    CHECK(out == expected);
  } else if (scenario == "roundtrip") {
    auto p = data();
    p.count = 7;
    p.index = 2;
    p.total = 1024;
    p.size = 160;
    for (std::size_t i = 0; i < p.size; ++i)
      p.bytes[i] = static_cast<std::uint8_t>(i);
    CHECK(seal(p, k, frame, size));
    CHECK(size == m::kMaxFrameBytes);
    CHECK(m::verify_relay_tag(frame.data(), size, k.relay));
    m::Packet out{};
    CHECK(m::open_frame(frame.data(), size, k.frame, out));
    CHECK(same(p, out));
    CHECK(seal(ack(), k, frame, size));
    CHECK(size == m::kFrameOverheadBytes);
    CHECK(m::verify_relay_tag(frame.data(), size, k.relay));
    CHECK(m::open_frame(frame.data(), size, k.frame, out));
    CHECK(same(ack(), out));
    // Nothing identifying travels in the clear.
    CHECK(seal(data(), k, frame, size));
    std::array<std::uint8_t, 8> origin{};
    for (unsigned i = 0; i < 8; ++i)
      origin[i] = static_cast<std::uint8_t>(data().key.origin >> (i * 8));
    for (std::size_t i = 0; i + 8 <= size; ++i)
      CHECK(std::memcmp(frame.data() + i, origin.data(), 8) != 0);
  } else if (scenario == "relay") {
    // A relay holds only the relay keys: it can check and forward, and hops can change in transit.
    CHECK(seal(data(), k, frame, size));
    for (unsigned hops = 3; hops > 0; --hops) {
      CHECK(m::verify_relay_tag(frame.data(), size, k.relay));
      CHECK(m::decrement_hops(frame.data(), size));
    }
    CHECK(!m::decrement_hops(frame.data(), size));
    CHECK(m::verify_relay_tag(frame.data(), size, k.relay));
    m::Packet out{};
    CHECK(m::open_frame(frame.data(), size, k.frame, out));
    CHECK(out.hops == 0);
    // A thief with a relay key gets a frame forwarded, but team members reject it.
    const auto forged = keys(0x11, 0x33, 3);
    CHECK(seal(data(), forged, frame, size));
    CHECK(m::verify_relay_tag(frame.data(), size, k.relay));
    CHECK(!m::open_frame(frame.data(), size, k.frame, out));
    // A team key alone does not satisfy relays.
    const auto outsider = keys(0x44, 0x22, 3);
    CHECK(seal(data(), outsider, frame, size));
    CHECK(!m::verify_relay_tag(frame.data(), size, k.relay));
  } else if (scenario == "keys") {
    // Chains are independent, one epoch's keys do not open another's frames, and they repeat.
    const auto next = keys(0x11, 0x22, 4);
    CHECK(k.relay.tag != next.relay.tag && k.frame != next.frame);
    const auto again = keys(0x11, 0x22, 3);
    CHECK(k.relay.tag == again.relay.tag && k.relay.hint == again.relay.hint &&
          k.frame == again.frame);
    CHECK(k.relay.tag != k.frame);
    CHECK(seal(data(), k, frame, size));
    m::Packet out{};
    CHECK(!m::verify_relay_tag(frame.data(), size, next.relay));
    CHECK(!m::open_frame(frame.data(), size, next.frame, out));
    // Changing the epoch field invalidates both tags under the right keys.
    frame[3] ^= 1;
    CHECK(!m::verify_relay_tag(frame.data(), size, k.relay));
    CHECK(!m::open_frame(frame.data(), size, k.frame, out));
  } else if (scenario == "tamper") {
    CHECK(seal(data(), k, frame, size));
    CHECK(m::decrement_hops(frame.data(), size));  // Two hops left under a limit of three.
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
    m::Packet out{};
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
    CHECK(seal(data(), k, frame, size));
    m::FrameRoute r{};
    CHECK(!m::parse_route(nullptr, size, r));
    for (std::size_t shorter = 0; shorter < m::kFrameOverheadBytes; ++shorter)
      CHECK(!m::parse_route(frame.data(), shorter, r));
    CHECK(!m::parse_route(frame.data(), m::kMaxFrameBytes + 1, r));
    m::Packet out = data();
    out.key.sequence = 1234;
    for (std::size_t shorter = 0; shorter < size; ++shorter)
      CHECK(!m::open_frame(frame.data(), shorter, k.frame, out));
    CHECK(out.key.sequence == 1234);
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
    // Sealing refuses invalid packets and writes nothing.
    auto p = data();
    p.key.origin = 0;
    CHECK(!seal(p, k, frame, size));
    CHECK(size == 0);
    p = data();
    p.hops = 8;
    CHECK(!seal(p, k, frame, size));
    CHECK(!m::seal_frame(data(), 3, kNonce, k.relay, k.frame, frame.data(), 10, size));
    // A valid key holder sealing nonsense directly is refused when opened, and publishes nothing.
    std::array<std::uint8_t, m::kFrameHeaderBytes> plain{};
    plain[0] = 1;
    CHECK(seal(ack(), k, frame, size));
    std::array<std::uint8_t, c::kCcmNonceBytes> nonce{};
    std::memcpy(nonce.data(), frame.data() + 6, 8);
    std::memcpy(nonce.data() + 8, frame.data() + 3, 2);
    std::array<std::uint8_t, m::kFrameClearBytes> clear{};
    std::memcpy(clear.data(), frame.data(), clear.size());
    clear[5] &= 0x70;
    CHECK(c::aes256_ccm_seal(k.frame, nonce.data(), clear.data(), clear.size(), plain.data(),
                             plain.size(), frame.data() + m::kFrameClearBytes,
                             frame.data() + m::kFrameClearBytes + plain.size()));
    out.key.sequence = 1234;
    CHECK(!m::open_frame(frame.data(), size, k.frame, out));
    CHECK(out.key.sequence == 1234);
  } else if (scenario == "link") {
    const auto relay_chain = filled(0x11), team_chain = filled(0x22);
    m::FrameLink member, relay, stranger, unseeded;
    member.seed(filled(1));
    CHECK(member.set_chains(relay_chain, &team_chain, 5));
    relay.seed(filled(2));
    CHECK(relay.set_chains(relay_chain, nullptr, 5));
    stranger.seed(filled(3));
    const auto other = filled(0x55);
    CHECK(stranger.set_chains(other, &team_chain, 5));
    CHECK(unseeded.set_chains(relay_chain, &team_chain, 5));
    m::Frame sealed{};
    CHECK(!unseeded.seal(data(), sealed));
    CHECK(!relay.seal(data(), sealed));  // A relay cannot originate.
    CHECK(member.seal(data(), sealed));
    m::Packet out{};
    CHECK(member.receive(sealed.bytes.data(), sealed.size, out) == m::FrameResult::Opened);
    CHECK(same(data(), out));
    out = {};
    CHECK(relay.receive(sealed.bytes.data(), sealed.size, out) == m::FrameResult::RelayOnly);
    CHECK(!out.key.origin);  // A relay learns nothing about the frame.
    CHECK(stranger.receive(sealed.bytes.data(), sealed.size, out) == m::FrameResult::Rejected);
    // Another epoch is refused until rotation exists.
    m::FrameLink later;
    CHECK(later.set_chains(relay_chain, &team_chain, 6));
    CHECK(later.receive(sealed.bytes.data(), sealed.size, out) == m::FrameResult::Rejected);
    // A relay-key forgery passes a relay but not a team member, who must not forward it.
    const auto wrong_team = filled(0x66);
    m::FrameLink forger;
    forger.seed(filled(4));
    CHECK(forger.set_chains(relay_chain, &wrong_team, 5));
    CHECK(forger.seal(data(), sealed));
    CHECK(relay.receive(sealed.bytes.data(), sealed.size, out) == m::FrameResult::RelayOnly);
    CHECK(member.receive(sealed.bytes.data(), sealed.size, out) == m::FrameResult::Rejected);
    // Nonces repeat only for an identical seed.
    m::FrameLink a, b;
    a.seed(filled(7));
    b.seed(filled(8));
    CHECK(a.use_open_mode() && b.use_open_mode());
    std::vector<std::array<std::uint8_t, 8>> nonces;
    for (unsigned i = 0; i < 500; ++i) {
      m::Frame x{}, y{};
      CHECK(a.seal(data(), x) && b.seal(data(), y));
      std::array<std::uint8_t, 8> nx{}, ny{};
      std::memcpy(nx.data(), x.bytes.data() + 6, 8);
      std::memcpy(ny.data(), y.bytes.data() + 6, 8);
      nonces.push_back(nx);
      nonces.push_back(ny);
    }
    std::sort(nonces.begin(), nonces.end());
    CHECK(std::adjacent_find(nonces.begin(), nonces.end()) == nonces.end());
  } else {
    return 2;
  }
  std::cout << "ok " << scenario << '\n';
  return 0;
}
