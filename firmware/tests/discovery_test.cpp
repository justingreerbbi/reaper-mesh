#include "reaper/discovery.hpp"
#include "reaper/session.hpp"
#include <iostream>
#include <string>
#include <cstring>
namespace d = reaper::device; namespace m = reaper::mesh; namespace p = reaper::protocol;
#define CHECK(v) do { if (!(v)) { std::cerr << "line " << __LINE__ << ": " << #v << '\n'; return 1; } } while(false)
template<std::size_t N> d::Text<N> text(const char* s) { d::Text<N> t{}; t.assign(reinterpret_cast<const std::uint8_t*>(s), std::strlen(s)); return t; }
std::array<std::uint8_t, 16> boot(unsigned n) { std::array<std::uint8_t, 16> b{}; b[0] = n; return b; }
d::Settings settings(const char* name, bool respond = false, bool beacon = false) { d::Settings s{}; s.region = d::Region::Us; s.radio.mode = d::RadioMode::Mesh; s.radio.power = 2; s.label = text<64>(name); s.discovery.respond = respond; s.discovery.beacon = beacon; return s; }
m::Packet control(std::uint64_t node, unsigned nonce, unsigned seq, m::PacketKind kind = m::PacketKind::Beacon) {
  m::Packet p{}; p.kind = kind; p.key = {node, boot(nonce), seq}; p.destination = m::kBroadcast; p.count = p.hops = 1; p.size = p.total = 3; p.bytes[0] = p.bytes[1] = 1; p.bytes[2] = 'N'; return p;
}
int main(int argc, char** argv) {
  if (argc != 2) return 2;
  const std::string scenario = argv[1]; d::Discovery a(1, boot(1)), b(2, boot(2));
  auto sa = settings("Alpha"), sb = settings("Bravo", true); a.policy(&sa, true, 0); b.policy(&sb, true, 0);
  if (scenario == "flow" || scenario == "expiry") {
    auto result = a.request(text<64>("owner"), text<75>("owner:1"), true, 0); CHECK(std::string(result.state) == "collecting");
    m::Packet query{}, reply{}; CHECK(a.next_tx(0, query)); a.complete_tx(true, 0);
    CHECK(b.receive(query, 1)); CHECK(!b.next_tx(200, reply)); CHECK(b.receive(query, 2) == false);
    CHECK(b.next_tx(5001, reply)); b.complete_tx(true, 5001); CHECK(reply.kind == m::PacketKind::Presence);
    CHECK(a.receive(reply, scenario == "expiry" ? 10000 : 5002) == (scenario == "flow"));
    if (scenario == "flow") { CHECK(a.count() == 1 && a.peer(0)->name.length == 5); CHECK(!a.receive(reply, 5003)); CHECK(a.query(text<75>("owner:1"), 10000).replies == 1); }
    CHECK(!a.next_tx(6000, query)); CHECK(!b.next_tx(6000, reply));
    CHECK(a.request(text<64>("owner"), text<75>("owner:1"), true, 31000).sequence == result.sequence);
    CHECK(!a.next_tx(31000, query)); CHECK(std::string(a.request(text<64>("owner"), text<75>("owner:2"), true, 100).state) == "cooldown");
  } else if (scenario == "codec") {
    auto q = control(2, 2, 1, m::PacketKind::Discover); std::array<std::uint8_t, 214> bytes{}; std::size_t size = 0; m::Packet decoded{};
    CHECK(m::encode_packet(q, bytes.data(), bytes.size(), size) && m::decode_packet(bytes.data(), size, decoded));
    q.bytes[2] = '\n'; CHECK(!m::encode_packet(q, bytes.data(), bytes.size(), size));
    q = control(2, 2, 1); q.hops = 2; CHECK(!m::valid_packet(q)); q.hops = 1; q.count = 2; CHECK(!m::valid_packet(q));
  } else if (scenario == "bounds") {
    for (unsigned i = 2; i < 42; ++i) { CHECK(a.receive(control(i, 1, 1), i)); }
    CHECK(a.count() == 32);
    auto q = control(50, 1, 1); CHECK(a.receive(q, 50)); CHECK(!a.receive(q, 51));
    q.key.sequence = 2; CHECK(a.receive(q, 52)); q.key.sequence = 1; CHECK(!a.receive(q, 53));
    q.key.boot = boot(2); CHECK(a.receive(q, 54)); q.key.boot = boot(1); q.key.sequence = 100; CHECK(!a.receive(q, 55));
    unsigned replies = 0;
    for (unsigned i = 1; i <= 12; ++i) { auto request = control(3, 3, i, m::PacketKind::Discover); const auto now = std::uint64_t(i) * 4000;
      b.receive(request, now); m::Packet reply{}; if (b.next_tx(now + 5000, reply)) { ++replies; b.complete_tx(true, now + 5000); }
    }
    CHECK(replies == 6);
  } else if (scenario == "policy") {
    auto q = control(3, 3, 1, m::PacketKind::Discover); CHECK(b.receive(q, 0)); sb.discovery.respond = false; b.policy(&sb, true, 1);
    m::Packet out{}; CHECK(!b.next_tx(6000, out)); q.key.sequence++; CHECK(b.receive(q, 6001)); CHECK(!b.next_tx(12000, out));
    sb.discovery.beacon = true; b.policy(&sb, true, 12001); CHECK(!b.next_tx(12002, out)); CHECK(b.next_tx(400000, out)); b.complete_tx(true, 400001);
    CHECK(!b.next_tx(400002, out)); sb.radio.mode = d::RadioMode::Receive; b.policy(&sb, true, 500000); CHECK(!b.next_tx(1000000, out));
  } else if (scenario == "record") {
    d::Snapshot snapshot{}; snapshot.settings = settings("Node"); snapshot.settings.discovery = {true, true, 60};
    std::array<std::uint8_t, d::kMaxRecord> bytes{}; std::size_t size = 0;
    CHECK(d::encode_record(snapshot, bytes.data(), bytes.size(), size) && bytes[2] == 3);
    d::Snapshot decoded{}; CHECK(d::decode_record(bytes.data(), size, decoded) && decoded.settings.discovery.respond && decoded.settings.discovery.interval == 60);
    for (std::size_t n = 0; n < size; ++n) CHECK(!d::decode_record(bytes.data(), n, decoded));
  } else return 3;
  std::cout << "ok " << scenario << '\n';
}
