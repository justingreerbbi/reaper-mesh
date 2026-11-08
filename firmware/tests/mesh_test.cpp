#include "reaper/mesh.hpp"
#include <iostream>
#include <string>
#include <vector>
#include <algorithm>
#include <cstring>
#include <memory>
namespace m = reaper::mesh;
#define CHECK(v)                                              \
  do {                                                        \
    if (!(v)) {                                               \
      std::cerr << "line " << __LINE__ << ": " << #v << '\n'; \
      return 1;                                               \
    }                                                         \
  } while (false)
m::MessageKey key(std::uint32_t seq = 1, std::uint64_t origin = 1) {
  m::MessageKey k{};
  k.origin = origin;
  k.boot = 42;
  k.sequence = seq;
  return k;
}
reaper::crypto::Key filled(std::uint8_t value) {
  reaper::crypto::Key k{};
  k.fill(value);
  return k;
}
// A node in Open mode, with a fixed nonce seed so each run is the same.
struct Node : m::Mesh {
  template <typename... Args>
  explicit Node(Args... args) : m::Mesh(args...) {
    static std::uint8_t next_seed = 100;
    link().seed(filled(next_seed++));
    if (!link().use_open_mode())
      std::abort();
  }
};
// Plays the part of any other radio on the air.
m::FrameLink& air() {
  static m::FrameLink link = [] {
    m::FrameLink made;
    made.seed(filled(1));
    if (!made.use_open_mode())
      std::abort();
    return made;
  }();
  return link;
}
std::vector<std::uint8_t> wire(const m::Packet& p) {
  m::Frame frame{};
  if (!air().seal(p, frame))
    std::abort();
  return {frame.bytes.begin(), frame.bytes.begin() + frame.size};
}
// Takes the next frame a node sends, both as bytes and as the packet inside it.
bool pull(m::Mesh& node, std::uint64_t now, m::Packet& p, std::vector<std::uint8_t>& bytes) {
  m::Frame frame{};
  if (!node.next_tx(now, frame))
    return false;
  bytes.assign(frame.bytes.begin(), frame.bytes.begin() + frame.size);
  p = {};
  return air().receive(bytes.data(), bytes.size(), p) == m::FrameResult::Opened;
}
unsigned completed(const m::Mesh& node) {
  unsigned n = 0;
  for (const auto& r : node.incoming())
    if (r.used && r.complete)
      n++;
  return n;
}
int main(int argc, char** argv) {
  if (argc != 2)
    return 2;
  const std::string scenario = argv[1];
  std::array<std::uint8_t, 1024> body{};
  body.fill('x');
  if (scenario == "relayonly") {
    // The team's sender and receiver are out of range of each other. The relay between them holds
    // only the relay key.
    const auto relay_chain = filled(0x11), team_chain = filled(0x22), other = filled(0x33);
    m::Mesh a(1, false), relay(2, true), c(3, false), outsider(4, true);
    a.link().seed(filled(1));
    c.link().seed(filled(3));
    relay.link().seed(filled(2));
    outsider.link().seed(filled(4));
    CHECK(a.link().set_chains(relay_chain, &team_chain, 0));
    CHECK(c.link().set_chains(relay_chain, &team_chain, 0));
    CHECK(relay.link().set_chains(relay_chain, nullptr, 0));
    CHECK(outsider.link().set_chains(other, &other, 0));
    m::Mesh* line[] = {&a, &relay, &c};
    CHECK(a.enqueue(key(), 3, 0, body.data(), 400, 0));
    CHECK(!relay.enqueue(key(1, 2), 3, 0, body.data(), 2, 0));
    bool relay_sent = false;
    for (std::uint64_t now = 0; now <= 8000 && a.outgoing()[0].state != m::SendState::Acknowledged;
         now += 5)
      for (int from = 0; from < 3; ++from) {
        m::Frame frame{};
        if (!line[from]->next_tx(now, frame))
          continue;
        line[from]->complete_tx(true, now);
        relay_sent = relay_sent || from == 1;
        if (from == 1) {
          a.receive(frame.bytes.data(), frame.size, now);
          c.receive(frame.bytes.data(), frame.size, now);
        } else {
          relay.receive(frame.bytes.data(), frame.size, now);
        }
        // An outsider hears everything and can neither read nor relay it.
        CHECK(!outsider.receive(frame.bytes.data(), frame.size, now));
        m::Frame nothing{};
        CHECK(!outsider.next_tx(now + 200, nothing));
      }
    CHECK(relay_sent && completed(c) == 1 && completed(relay) == 0);
    CHECK(a.outgoing()[0].state == m::SendState::Acknowledged);
    for (const auto& r : relay.incoming())
      CHECK(!r.used);
    // An outsider's own frame goes nowhere.
    CHECK(outsider.link().use_open_mode());
    CHECK(outsider.enqueue(key(1, 4), 3, 0, body.data(), 2, 9000));
    m::Frame injected{};
    CHECK(outsider.next_tx(9000, injected));
    CHECK(!relay.receive(injected.bytes.data(), injected.size, 9001));
    CHECK(!c.receive(injected.bytes.data(), injected.size, 9001));
    m::Frame nothing{};
    CHECK(!relay.next_tx(10000, nothing));
    // A thief with the relay key gets junk forwarded, but team members reject and do not forward
    // it.
    m::Mesh thief(5, false), member(6, true);
    thief.link().seed(filled(5));
    member.link().seed(filled(6));
    CHECK(thief.link().set_chains(relay_chain, &other, 0));
    CHECK(member.link().set_chains(relay_chain, &team_chain, 0));
    CHECK(thief.enqueue(key(1, 5), 3, 0, body.data(), 2, 11000));
    m::Frame forged{};
    CHECK(thief.next_tx(11000, forged));
    CHECK(relay.receive(forged.bytes.data(), forged.size, 11001));
    CHECK(relay.next_tx(12000, nothing));
    CHECK(!member.receive(forged.bytes.data(), forged.size, 11001));
    CHECK(!member.next_tx(12000, nothing));
    CHECK(completed(c) == 1);
  } else if (scenario == "unjoined") {
    // A team radio relays a channel it has not joined, and does not deliver it.
    const std::uint32_t channel = 0x1a2b3c4d;
    m::ChannelSet members{};
    CHECK(members.add(channel));
    Node a(1, false, members), b(2, true), c(3, false, members);
    CHECK(a.enqueue(key(), 3, channel, body.data(), 2, 0));
    m::Packet p{};
    std::vector<std::uint8_t> bytes;
    CHECK(pull(a, 0, p, bytes));
    a.complete_tx(true, 0);
    CHECK(b.receive(bytes.data(), bytes.size(), 1));
    CHECK(completed(b) == 0);
    CHECK(pull(b, 200, p, bytes));
    CHECK(p.hops == 2 && p.channel == channel);
    b.complete_tx(true, 200);
    CHECK(c.receive(bytes.data(), bytes.size(), 201));
    CHECK(completed(c) == 1);
    // A duplicate is not relayed twice.
    CHECK(b.receive(bytes.data(), bytes.size(), 202));
    CHECK(!pull(b, 400, p, bytes));
  } else if (scenario == "line" || scenario == "loss" || scenario == "asymmetric" ||
             scenario == "broadcast" || scenario == "hops") {
    Node a(1, true, m::ChannelSet{}, std::uint8_t(scenario == "hops" ? 0 : 3)), b(2, true),
        c(3, true);
    Node* nodes[] = {&a, &b, &c};
    const bool broadcast = scenario == "broadcast";
    CHECK(a.enqueue(key(), broadcast ? m::kBroadcast : 3, 0, body.data(), body.size(), 0));
    struct Event {
      std::uint64_t at;
      int to;
      std::vector<std::uint8_t> bytes;
    };
    std::vector<Event> events;
    bool lost = false;
    unsigned transmissions = 0, acks = 0;
    for (std::uint64_t now = 0; now <= 61000; now += 5) {
      for (auto* node : nodes)
        node->tick(now);
      for (std::size_t i = 0; i < events.size();) {
        if (events[i].at <= now) {
          auto event = events[i];
          events.erase(events.begin() + i);
          nodes[event.to]->receive(event.bytes.data(), event.bytes.size(), now);
        } else
          ++i;
      }
      for (int from = 0; from < 3; ++from) {
        m::Packet p{};
        std::vector<std::uint8_t> bytes;
        if (!pull(*nodes[from], now, p, bytes))
          continue;
        transmissions++;
        if (p.kind == m::PacketKind::Ack)
          acks++;
        nodes[from]->complete_tx(true, now);
        for (int to = 0; to < 3; ++to) {
          if (to == from || (!broadcast && std::abs(to - from) != 1))
            continue;
          if (scenario == "asymmetric" && from == 1 && to == 0 && p.kind == m::PacketKind::Ack)
            continue;
          if (scenario == "loss" && from == 1 && to == 2 && p.kind == m::PacketKind::Data &&
              p.index == 2 && !lost) {
            lost = true;
            continue;
          }
          events.push_back({now + 5 + (6 - p.index) * 5u, to, bytes});  // Reorder fragments.
          if (scenario == "loss" || broadcast)
            events.push_back({now + 50, to, bytes});
        }
      }
    }
    CHECK(transmissions < 250);
    if (scenario == "hops") {
      CHECK(completed(c) == 0 && a.outgoing()[0].state == m::SendState::Failed);
    } else {
      CHECK(completed(c) == 1);
      const auto& received = *std::find_if(c.incoming().begin(), c.incoming().end(),
                                           [](const auto& r) { return r.complete; });
      CHECK(received.size == 1024 && std::memcmp(received.bytes.data(), body.data(), 1024) == 0);
      if (broadcast) {
        CHECK(completed(b) == 1 && acks == 0 && a.outgoing()[0].state == m::SendState::Transmitted);
      } else if (scenario == "asymmetric")
        CHECK(a.outgoing()[0].state == m::SendState::Failed);
      else
        CHECK(a.outgoing()[0].state == m::SendState::Acknowledged);
    }
  } else if (scenario == "encrypted") {
    // RME2 on a random-style channel ID (D45): the ID is carried in the header and envelope.
    const std::uint32_t channel = 0x1a2b3c4d;
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
    m::ChannelSet members{};
    CHECK(members.add(channel));
    Node sender(1, false, members), receiver(2, false, members), outsider(3, false);
    auto identity = key();
    CHECK(!sender.enqueue(identity, 2, 0x1a2b3c4e, envelope.data(), envelope.size(), 0));
    CHECK(sender.enqueue(identity, 2, channel, envelope.data(), envelope.size(), 0));
    m::Packet packet{};
    std::vector<std::uint8_t> bytes;
    CHECK(pull(sender, 0, packet, bytes));
    CHECK(packet.channel == channel && packet.bytes[0] == 'R' && packet.bytes[2] == 'E');
    CHECK(!outsider.receive(bytes.data(), bytes.size(), 1));
    CHECK(receiver.receive(bytes.data(), bytes.size(), 1));
    sender.complete_tx(true, 2);
    const auto& received = receiver.incoming()[0];
    CHECK(received.complete && received.size == envelope.size());
    CHECK(std::memcmp(received.bytes.data(), envelope.data(), envelope.size()) == 0);
    CHECK(pull(receiver, 200, packet, bytes) && packet.kind == m::PacketKind::Ack);
  } else if (scenario == "opaque") {
    // Bytes that are neither text nor a known envelope cross the mesh unchanged.
    Node a(1), b(2);
    const std::array<std::uint8_t, 4> binary{0xff, 0x00, 0xfe, 0x01};
    CHECK(a.enqueue(key(), 2, 0, binary.data(), binary.size(), 0));
    m::Packet p{};
    std::vector<std::uint8_t> bytes;
    CHECK(pull(a, 0, p, bytes));
    CHECK(b.receive(bytes.data(), bytes.size(), 1));
    CHECK(completed(b) == 1);
    CHECK(!std::memcmp(b.incoming()[0].bytes.data(), binary.data(), binary.size()));
  } else if (scenario == "races") {
    Node a(1);
    CHECK(a.enqueue(key(), 3, 0, body.data(), 2, 0));
    m::Packet p{};
    std::vector<std::uint8_t> sent;
    CHECK(pull(a, 0, p, sent));
    auto ack = p;
    ack.kind = m::PacketKind::Ack;
    ack.total = ack.count = ack.index = ack.size = 0;
    auto bytes = wire(ack);
    CHECK(a.receive(bytes.data(), bytes.size(), 1));
    a.complete_tx(false, 1);
    CHECK(a.outgoing()[0].state == m::SendState::Acknowledged);
    a.tick(60000);
    CHECK(a.outgoing()[0].state == m::SendState::Acknowledged);
    Node b(1);
    CHECK(b.enqueue(key(), 3, 0, body.data(), 2, 0));
    CHECK(pull(b, 0, p, sent));
    b.complete_tx(true, 1);
    CHECK(!b.receive(bytes.data(), bytes.size(), 60000));
    CHECK(b.outgoing()[0].state == m::SendState::Failed);
  } else if (scenario == "bounds") {
    Node reordered(1);
    CHECK(reordered.enqueue(key(2), 3, 0, body.data(), 2, 0));
    CHECK(reordered.enqueue(key(1), 3, 0, body.data(), 2, 0));
    Node a(1);
    for (unsigned seq = 1; seq <= 8; ++seq)
      CHECK(a.enqueue(key(seq), 3, 0, body.data(), 2, 0));
    CHECK(!a.enqueue(key(9), 3, 0, body.data(), 2, 0));
    a.tick(60000);
    CHECK(a.enqueue(key(10), 3, 0, body.data(), 2, 60001));
    CHECK(!a.enqueue(key(1), 3, 0, body.data(), 2, 60001));
    a.quiesce();
    for (const auto& r : a.outgoing())
      CHECK(!r.used || r.state == m::SendState::Failed);
    Node b(2);
    m::Packet p{};
    p.key = key();
    p.destination = 2;
    p.count = 2;
    p.total = 200;
    p.size = 160;
    p.bytes.fill('x');
    auto bytes = wire(p);
    CHECK(b.receive(bytes.data(), bytes.size(), 0));
    p.bytes[0] = 'z';
    bytes = wire(p);
    CHECK(!b.receive(bytes.data(), bytes.size(), 1));
    p.index = 1;
    p.size = 40;
    bytes = wire(p);
    CHECK(!b.receive(bytes.data(), bytes.size(), 2));
    CHECK(completed(b) == 0);
  } else if (scenario == "soak") {
    Node a(1, true), b(2, true), c(3, true);
    Node* nodes[] = {&a, &b, &c};
    struct Event {
      std::uint64_t at;
      int to;
      std::vector<std::uint8_t> bytes;
    };
    std::uint32_t random = 0x73550728;
    const auto next = [&random]() {
      random ^= random << 13;
      random ^= random >> 17;
      random ^= random << 5;
      return random;
    };
    unsigned acknowledged = 0, clean_acknowledged = 0, total_tx = 0;
    for (unsigned sequence = 1; sequence <= 120; ++sequence) {
      const std::uint64_t start = std::uint64_t(sequence) * 130000;
      const std::size_t size = sequence % 4 ? 1 + next() % 1024 : 1024;
      body.fill(static_cast<std::uint8_t>('a' + sequence % 26));
      for (auto* node : nodes)
        node->tick(start);
      CHECK(a.enqueue(key(sequence), 3, 0, body.data(), size, start));
      if (sequence > 1)
        CHECK(!a.enqueue(key(sequence - 1), 3, 0, body.data(), size, start));
      std::vector<Event> events;
      unsigned transmissions = 0;
      for (auto now = start; now < start + 12000; now += 5) {
        for (auto* node : nodes)
          node->tick(now);
        for (std::size_t i = 0; i < events.size();) {
          if (events[i].at > now) {
            ++i;
            continue;
          }
          const auto event = events[i];
          events.erase(events.begin() + i);
          nodes[event.to]->receive(event.bytes.data(), event.bytes.size(), now);
        }
        for (int from = 0; from < 3; ++from) {
          m::Packet packet{};
          std::vector<std::uint8_t> sent;
          if (!pull(*nodes[from], now, packet, sent))
            continue;
          ++transmissions;
          const bool success = next() % 100 >= 2 || sequence % 10 == 0;
          nodes[from]->complete_tx(success, now);
          if (!success)
            continue;
          for (int to = 0; to < 3; ++to) {
            if (std::abs(to - from) != 1)
              continue;
            if (next() % 100 < 10 && sequence % 10)
              continue;
            auto bytes = sent;
            if (next() % 100 < 5 && sequence % 10)
              bytes.back() ^= 1;  // Rejected by the relay tag.
            events.push_back({now + 5 + next() % 150, to, bytes});
            if (next() % 4 == 0)
              events.push_back({now + 200, to, bytes});
          }
        }
        CHECK(events.size() < 256);
        CHECK(transmissions < 250);
      }
      unsigned deliveries = 0;
      for (const auto& item : c.incoming())
        if (item.used && item.complete && item.key == key(sequence)) {
          ++deliveries;
          CHECK(item.size == size && std::memcmp(item.bytes.data(), body.data(), size) == 0);
        }
      CHECK(deliveries <= 1);
      const auto outcome = std::find_if(
          a.outgoing().begin(), a.outgoing().end(),
          [sequence](const auto& item) { return item.used && item.key == key(sequence); });
      CHECK(outcome != a.outgoing().end());
      if (outcome->state == m::SendState::Acknowledged) {
        CHECK(deliveries == 1);
        ++acknowledged;
        if (sequence % 10 == 0)
          ++clean_acknowledged;
      } else {
        a.tick(start + 60000);
        CHECK(outcome->state == m::SendState::Failed);
      }
      const auto settled = outcome->state;
      CHECK(a.enqueue(key(sequence), 3, 0, body.data(), size,
                      start + 60001));  // Identical retained request is idempotent.
      CHECK(outcome->state == settled);
      total_tx += transmissions;
    }
    std::cerr << "seed 0x73550728: acknowledged=" << acknowledged
              << "/120 clean=" << clean_acknowledged << "/12 tx=" << total_tx << "\n";
    CHECK(clean_acknowledged == 12);
    CHECK(total_tx < 120 * 250);
  } else if (scenario == "halfduplex") {
    // Radios as they really are: a frame takes its airtime, a radio can't listen while it sends,
    // and a frame is lost where it overlaps another frame the receiver can hear. Nodes in a line
    // hear only their neighbors. A full-size message must cross one relay and two relays, both
    // ways, and be acknowledged. Before the fragment gap, the relay missed every other fragment.
    CHECK(m::fragment_gap_ms(m::airtime_us(218), 0) == 0);
    CHECK(m::fragment_gap_ms(m::airtime_us(218), 1) < m::fragment_gap_ms(m::airtime_us(218), 2));
    CHECK(m::fragment_gap_ms(m::airtime_us(218), 2) == m::fragment_gap_ms(m::airtime_us(218), 7));
    CHECK(m::fragment_gap_ms(m::airtime_us(218), 3) >= 3 * m::airtime_us(218) / 1000 + 200);
    struct Air {
      int from;
      std::uint64_t start, end;
      std::vector<std::uint8_t> bytes;
    };
    for (const int length : {3, 4})
      for (const bool forward : {true, false}) {
        std::vector<std::unique_ptr<Node>> nodes;
        for (int i = 0; i < length; ++i)
          nodes.push_back(std::make_unique<Node>(std::uint64_t(i + 1), i > 0 && i < length - 1));
        const int origin = forward ? 0 : length - 1, target = forward ? length - 1 : 0;
        auto& sender = *nodes[origin];
        CHECK(sender.enqueue(key(1, origin + 1), std::uint64_t(target + 1), 0, body.data(),
                             body.size(), 0));
        std::vector<Air> air_log;
        std::vector<int> sending(length, -1);  // Index into air_log while a node transmits.
        unsigned lost = 0;
        std::uint64_t now = 0;
        for (; now <= 30000 && sender.outgoing()[0].state != m::SendState::Acknowledged; ++now) {
          for (int n = 0; n < length; ++n) {
            nodes[n]->tick(now);
            if (sending[n] >= 0 && air_log[sending[n]].end == now) {
              const auto& done = air_log[sending[n]];
              sending[n] = -1;
              nodes[n]->complete_tx(true, now);
              for (const int to : {n - 1, n + 1}) {
                if (to < 0 || to >= length)
                  continue;
                // Lost if the receiver sent, or heard anyone else, while this frame was on air.
                bool clear = true;
                for (const auto& other : air_log)
                  if (&other != &done && other.start < done.end && done.start < other.end &&
                      (other.from == to || std::abs(other.from - to) == 1))
                    clear = false;
                if (clear)
                  nodes[to]->receive(done.bytes.data(), done.bytes.size(), now);
                else
                  lost++;
              }
            }
          }
          for (int n = 0; n < length; ++n) {
            m::Frame frame{};
            if (sending[n] >= 0 || !nodes[n]->next_tx(now, frame))
              continue;
            const std::uint64_t airtime = (m::airtime_us(frame.size) + 999) / 1000;
            air_log.push_back(
                {n, now, now + airtime, {frame.bytes.begin(), frame.bytes.begin() + frame.size}});
            sending[n] = static_cast<int>(air_log.size() - 1);
          }
        }
        std::cerr << length << " nodes, " << (forward ? "forward" : "back") << ": acknowledged at "
                  << now << " ms, " << air_log.size() << " frames, " << lost << " lost\n";
        CHECK(sender.outgoing()[0].state == m::SendState::Acknowledged);
        CHECK(completed(*nodes[target]) == 1);
        // The first round must get through on its own: nothing lost by design.
        CHECK(now < 8000);
      }
  } else
    return 3;
  std::cout << "ok " << scenario << '\n';
}
