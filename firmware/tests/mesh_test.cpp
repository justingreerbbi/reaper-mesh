#include "reaper/mesh.hpp"
#include <iostream>
#include <string>
#include <vector>
#include <algorithm>
#include <cstring>
namespace m = reaper::mesh;
#define CHECK(v) do { if (!(v)) { std::cerr << "line " << __LINE__ << ": " << #v << '\n'; return 1; } } while(false)
m::MessageKey key(std::uint32_t seq = 1, std::uint64_t origin = 1) { m::MessageKey k{}; k.origin = origin; k.boot[0] = 42; k.sequence = seq; return k; }
std::vector<std::uint8_t> wire(const m::Packet& p) { std::vector<std::uint8_t> bytes(m::kMaxPacketBytes); std::size_t size = 0; if (!m::encode_packet(p, bytes.data(), bytes.size(), size)) std::abort(); bytes.resize(size); return bytes; }
unsigned completed(const m::Mesh& node) { unsigned n = 0; for (const auto& r : node.incoming()) if (r.used && r.complete) n++; return n; }
int main(int argc, char** argv) {
  if (argc != 2) return 2;
  const std::string scenario = argv[1]; std::array<std::uint8_t, 1024> body{}; body.fill('x');
  if (scenario == "line" || scenario == "loss" || scenario == "asymmetric" || scenario == "broadcast" || scenario == "hops") {
    m::Mesh a(1, true, 1, scenario == "hops" ? 0 : 3), b(2, true), c(3, true);
    m::Mesh* nodes[] = {&a, &b, &c}; const bool broadcast = scenario == "broadcast";
    CHECK(a.enqueue(key(), broadcast ? m::kBroadcast : 3, 0, body.data(), body.size(), 0));
    struct Event { std::uint64_t at; int to; std::vector<std::uint8_t> bytes; };
    std::vector<Event> events; bool lost = false; unsigned transmissions = 0, acks = 0;
    for (std::uint64_t now = 0; now <= 61000; now += 5) {
      for (auto* node : nodes) node->tick(now);
      for (std::size_t i = 0; i < events.size();) {
        if (events[i].at <= now) { auto event = events[i]; events.erase(events.begin() + i); nodes[event.to]->receive(event.bytes.data(), event.bytes.size(), now); }
        else ++i;
      }
      for (int from = 0; from < 3; ++from) {
        m::Packet p{}; if (!nodes[from]->next_tx(now, p)) continue;
        transmissions++; if (p.kind == m::PacketKind::Ack) acks++;
        auto bytes = wire(p); nodes[from]->complete_tx(true, now);
        for (int to = 0; to < 3; ++to) {
          if (to == from || (!broadcast && std::abs(to - from) != 1)) continue;
          if (scenario == "asymmetric" && from == 1 && to == 0 && p.kind == m::PacketKind::Ack) continue;
          if (scenario == "loss" && from == 1 && to == 2 && p.kind == m::PacketKind::Data && p.index == 2 && !lost) { lost = true; continue; }
          events.push_back({now + 5 + (6 - p.index) * 5u, to, bytes}); // Reorder fragments.
          if (scenario == "loss" || broadcast) events.push_back({now + 50, to, bytes});
        }
      }
    }
    CHECK(transmissions < 250);
    if (scenario == "hops") { CHECK(completed(c) == 0 && a.outgoing()[0].state == m::SendState::Failed); }
    else {
      CHECK(completed(c) == 1);
      const auto& received = *std::find_if(c.incoming().begin(), c.incoming().end(), [](const auto& r) { return r.complete; });
      CHECK(received.size == 1024 && std::memcmp(received.bytes.data(), body.data(), 1024) == 0);
      if (broadcast) { CHECK(completed(b) == 1 && acks == 0 && a.outgoing()[0].state == m::SendState::Transmitted); }
      else if (scenario == "asymmetric") CHECK(a.outgoing()[0].state == m::SendState::Failed);
      else CHECK(a.outgoing()[0].state == m::SendState::Acknowledged);
    }
  } else if (scenario == "races") {
    m::Mesh a(1); CHECK(a.enqueue(key(), 3, 0, body.data(), 2, 0)); m::Packet p{}; CHECK(a.next_tx(0, p));
    auto ack = p; ack.kind = m::PacketKind::Ack; ack.total = ack.count = ack.index = ack.size = 0;
    auto bytes = wire(ack); CHECK(a.receive(bytes.data(), bytes.size(), 1)); a.complete_tx(false, 1);
    CHECK(a.outgoing()[0].state == m::SendState::Acknowledged); a.tick(60000); CHECK(a.outgoing()[0].state == m::SendState::Acknowledged);
    m::Mesh b(1); CHECK(b.enqueue(key(), 3, 0, body.data(), 2, 0)); CHECK(b.next_tx(0, p)); b.complete_tx(true, 1);
    CHECK(!b.receive(bytes.data(), bytes.size(), 60000)); CHECK(b.outgoing()[0].state == m::SendState::Failed);
  } else if (scenario == "bounds") {
    m::Mesh a(1); for (unsigned seq = 1; seq <= 8; ++seq) CHECK(a.enqueue(key(seq), 3, 0, body.data(), 2, 0));
    CHECK(!a.enqueue(key(9), 3, 0, body.data(), 2, 0)); a.tick(60000);
    CHECK(a.enqueue(key(10), 3, 0, body.data(), 2, 60001)); CHECK(!a.enqueue(key(1), 3, 0, body.data(), 2, 60001));
    a.quiesce(); for (const auto& r : a.outgoing()) CHECK(!r.used || r.state == m::SendState::Failed);
    m::Mesh b(2); m::Packet p{}; p.key = key(); p.destination = 2; p.count = 2; p.total = 200; p.size = 160;
    p.bytes.fill('x'); auto bytes = wire(p); CHECK(b.receive(bytes.data(), bytes.size(), 0));
    p.bytes[0] = 'z'; bytes = wire(p); CHECK(!b.receive(bytes.data(), bytes.size(), 1));
    p.index = 1; p.size = 40; bytes = wire(p); CHECK(!b.receive(bytes.data(), bytes.size(), 2)); CHECK(completed(b) == 0);
  } else return 3;
  std::cout << "ok " << scenario << '\n';
}
