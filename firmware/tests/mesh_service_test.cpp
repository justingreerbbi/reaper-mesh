#include "mesh_service.hpp"
#include <algorithm>
#include <iostream>
#include <string>
#include <vector>
#include <cstring>
#include <cstdlib>
namespace d = reaper::device;
namespace m = reaper::mesh;
#define CHECK(v)                                              \
  do {                                                        \
    if (!(v)) {                                               \
      std::cerr << "line " << __LINE__ << ": " << #v << '\n'; \
      return 1;                                               \
    }                                                         \
  } while (false)
static bool failure = false, transmitted = false;
static std::uint16_t irq = 0;
static std::vector<std::uint8_t> received, sent;
bool RadioBus::begin() {
  device_ = this;
  failed_ = failure;
  transaction_ = {};
  tx_.fill(0);
  rx_.fill(0);
  (void)transaction_;
  return device_ && !failed_;
}
bool RadioBus::ready(std::uint32_t) {
  return !failure;
}
bool RadioBus::reset() {
  return !failure;
}
void RadioBus::off() {}
bool RadioBus::transfer(const std::uint8_t* tx, std::uint8_t* rx, std::size_t size) {
  if (failure)
    return false;
  std::memset(rx, 0, size);
  if (tx[0] == 0xc0)
    rx[1] = 0x24;
  if (tx[0] == 0x12) {
    rx[2] = irq >> 8;
    rx[3] = irq;
  }
  if (tx[0] == 0x02)
    irq = 0;
  if (tx[0] == 0x0e && size > 2)
    sent.assign(tx + 2, tx + size);
  if (tx[0] == 0x83)
    transmitted = true;
  if (tx[0] == 0x13) {
    rx[2] = received.size();
    rx[3] = 0;
  }
  if (tx[0] == 0x1e && size >= 3 + received.size())
    std::memcpy(rx + 3, received.data(), received.size());
  return true;
}
struct MemorySectors final : d::KeySectors {
  std::array<std::array<std::uint8_t, 4096>, 2> sectors{};
  MemorySectors() {
    for (auto& sector : sectors)
      sector.fill(0xff);
  }
  bool read(unsigned sector, std::uint8_t* out, std::size_t size) override {
    std::memcpy(out, sectors[sector].data(), size);
    return true;
  }
  bool erase(unsigned sector) override {
    sectors[sector].fill(0xff);
    return true;
  }
  bool write(unsigned sector, const std::uint8_t* bytes, std::size_t size) override {
    std::memcpy(sectors[sector].data(), bytes, size);
    return true;
  }
};
template <std::size_t N>
d::Text<N> text(const char* str) {
  d::Text<N> t{};
  t.assign(reinterpret_cast<const std::uint8_t*>(str), std::strlen(str));
  return t;
}
// Plays the part of another Open mode radio.
m::FrameLink& air() {
  static m::FrameLink link = [] {
    m::FrameLink made;
    reaper::crypto::Key seed{};
    seed.fill(9);
    made.seed(seed);
    if (!made.use_open_mode())
      std::abort();
    return made;
  }();
  return link;
}
void inject(const m::Packet& p) {
  m::Frame frame{};
  if (!air().seal(p, frame))
    std::abort();
  received.assign(frame.bytes.begin(), frame.bytes.begin() + frame.size);
  irq = 2;
}
bool opened(m::Packet& p) {
  return air().receive(sent.data(), sent.size(), p) == m::FrameResult::Opened;
}
int main(int argc, char** argv) {
  if (argc != 2)
    return 2;
  const std::string scenario = argv[1];
  const auto device = text<64>("heltec-000000000001");
  const auto boot = text<64>("2a00000000000000000000000000000000");
  const std::uint32_t boot_counter = 42;
  reaper::crypto::Key nonce_seed{};
  nonce_seed.fill(5);
  d::MessageQueue messages(scenario == "identity" ? d::boot_identity(boot_counter) : boot);
  d::Inbox inbox;
  d::RadioInfo info{};
  MemorySectors key_sectors;
  d::Network network(key_sectors);
  network.begin();
  if (scenario != "unset" && scenario != "teamrelay" && scenario != "rotation")
    network.fill(1, 0, 0, nullptr, nullptr, nullptr);  // Open mode.
  MeshService service(messages, inbox, info, network, device,
                      scenario == "noboot" ? 0 : boot_counter, nonce_seed, 1,
                      scenario == "tx" || scenario == "policy" || scenario == "discovery" ||
                          scenario == "privacy" || scenario == "noboot" || scenario == "identity" ||
                          scenario == "unset" || scenario == "teamrelay" ||
                          scenario == "detached" || scenario == "rotation");
  service.begin();
  CHECK(info.probe);
  d::Snapshot config{};
  config.settings.region = d::Region::Us;
  if (scenario != "local")
    config.settings.radio.mode = d::RadioMode::Mesh;
  service.tick(&config, 0);
  if (scenario == "detached") {
    // With no agent attached, a radio sends no beacons and answers no discovery requests.
    config.settings.discovery.beacon = true;
    config.settings.discovery.respond = true;
    service.tick(&config, 1, false);
    service.tick(&config, 400000, false);
    CHECK(!transmitted);
    m::Packet request{};
    request.kind = m::PacketKind::Discover;
    request.key.origin = 2;
    request.key.boot = 2;
    request.key.sequence = 1;
    request.destination = m::kBroadcast;
    request.count = 1;
    request.size = request.total = 2;
    request.bytes[0] = 1;
    inject(request);
    service.tick(&config, 400001, false);
    service.tick(&config, 406000, false);
    CHECK(!transmitted);
    // The first beacon follows once an agent attaches and an interval passes.
    service.tick(&config, 406001, true);
    service.tick(&config, 806001, true);
    CHECK(transmitted);
    std::cout << "ok detached\n";
    return 0;
  }
  if (scenario == "rotation") {
    // A member radio with a message on air when the epoch moves under it.
    using Key = reaper::crypto::Key;
    Key relay_chain{}, device_key{}, team_chain{}, start{};
    relay_chain.fill(0x11);
    device_key.fill(0x12);
    team_chain.fill(0x13);
    std::array<Key, 4> proofs{};
    proofs[3].fill(0x14);
    for (std::size_t i = 3; i > 0; --i)
      CHECK(m::previous_proof(proofs[i], proofs[i - 1]));
    CHECK(!std::strcmp(network.fill(2, 1, 0, &relay_chain, &device_key, &proofs[0]), "ok"));
    CHECK(!std::strcmp(network.load_team(1, 0, team_chain), "ok"));
    config.settings.radio.relay = true;
    ++config.revision;
    service.tick(&config, 2);
    CHECK(info.reason.length == 5);  // ready
    const std::uint8_t body[] = {'h', 'i'};
    CHECK(messages
              .submit(text<64>("agent"), text<75>("agent:2"), 0, text<64>("heltec-000000000009"), 0,
                      1, body, sizeof(body), 3)
              .state == d::MessageState::Queued);
    transmitted = false;
    service.tick(&config, 3);
    service.tick(&config, 200);
    CHECK(transmitted);
    irq = 1;  // Its transmission finishes.
    service.tick(&config, 201);
    CHECK(messages.query(text<75>("agent:2")).state == d::MessageState::Transmitted);
    // Agent advances. Nothing is cancelled, and the proof goes out on air.
    CHECK(!std::strcmp(network.advance(1, proofs[1]), "ok"));
    sent.clear();
    transmitted = false;
    service.tick(&config, 202);
    service.tick(&config, 400);
    CHECK(transmitted && sent.size() == m::kProofFrameBytes && sent[0] == m::kNetworkFrameByte);
    CHECK(sent[3] == 1 && sent[5] == 0x33);  // Epoch 1 with three hops to go.
    CHECK(messages.query(text<75>("agent:2")).state == d::MessageState::Transmitted);
    irq = 1;
    service.tick(&config, 401);
    // The radio's next frames use the new epoch, and a retry of that same message is one of them.
    sent.clear();
    transmitted = false;
    service.tick(&config, 4300);
    CHECK(transmitted && sent[0] == 2 && sent[3] == 1);
    irq = 1;
    service.tick(&config, 4301);
    // A proof from another radio: forwarded once when new, and never when it is old news.
    m::FrameLink other;
    Key seed{};
    seed.fill(7);
    other.seed(seed);
    Key chain_2 = relay_chain;
    CHECK(m::ratchet_chain(chain_2) && m::ratchet_chain(chain_2));
    CHECK(other.set_chains(chain_2, nullptr, 2));
    m::Frame proof{};
    CHECK(other.seal_proof(2, proofs[2], 3, proof));
    received.assign(proof.bytes.begin(), proof.bytes.begin() + proof.size);
    irq = 2;
    sent.clear();
    transmitted = false;
    service.tick(&config, 4302);
    CHECK(network.view().proven_epoch == 2 && network.view().epoch == 2);
    service.tick(&config, 4500);
    CHECK(transmitted && sent.size() == m::kProofFrameBytes && sent[5] == 0x32);
    CHECK(std::equal(sent.begin() + 6, sent.end(), proof.bytes.begin() + 6));
    irq = 1;
    service.tick(&config, 4501);
    received.assign(proof.bytes.begin(), proof.bytes.begin() + proof.size);
    irq = 2;
    sent.clear();
    transmitted = false;
    service.tick(&config, 5000);
    service.tick(&config, 5200);
    CHECK(sent.size() != m::kProofFrameBytes);
    // A forged proof with a valid relay tag does nothing, and is not forwarded.
    Key bogus{};
    bogus.fill(0x55);
    CHECK(other.seal_proof(2, bogus, 3, proof));
    Key chain_3 = chain_2;
    CHECK(m::ratchet_chain(chain_3));
    CHECK(other.set_chains(chain_3, nullptr, 3));
    CHECK(other.seal_proof(3, bogus, 3, proof));
    received.assign(proof.bytes.begin(), proof.bytes.begin() + proof.size);
    irq = 2;
    sent.clear();
    service.tick(&config, 5300);
    service.tick(&config, 5500);
    CHECK(network.view().proven_epoch == 2 && sent.size() != m::kProofFrameBytes);
    (void)start;
    std::cout << "ok rotation\n";
    return 0;
  }
  if (scenario == "privacy") {
    config.settings.position = {true, 1, 900000000, 1800000000};
    config.settings.discovery.beacon = true;
    service.tick(&config, 1);
    service.tick(&config, 400000);
    CHECK(transmitted);
    m::Packet report{};
    CHECK(opened(report) && report.bytes[0] == 2);
    config.settings.position.share = false;
    ++config.revision;
    transmitted = false;
    service.tick(&config, 400001);
    CHECK(!transmitted);
    // No TX_DONE is needed to stop an old control flight; the next beacon is name-only.
    service.tick(&config, 800000);
    CHECK(transmitted);
    CHECK(opened(report) && report.bytes[0] == 1);
    std::cout << "ok privacy\n";
    return 0;
  }
  if (scenario == "discovery") {
    config.settings.discovery.respond = true;
    service.tick(&config, 1);
    const auto result =
        service.discovery().request(text<64>("agent"), text<75>("agent:1"), true, 2);
    CHECK(result.sequence);
    service.tick(&config, 2);
    CHECK(transmitted);
    m::Packet request{};
    CHECK(opened(request) && request.kind == m::PacketKind::Discover && !request.hops);
    irq = 1;
    service.tick(&config, 3);
    m::Packet response{};
    response.kind = m::PacketKind::Presence;
    response.key.origin = 2;
    response.key.boot = 2;
    response.key.sequence = 1;
    response.destination = 1;
    response.count = 1;
    response.size = response.total = 14;
    response.bytes[0] = 1;
    response.bytes[1] = 4;
    std::memcpy(response.bytes.data() + 2, "Peer", 4);
    response.bytes[6] = boot_counter;
    response.bytes[10] = result.sequence;
    inject(response);
    service.tick(&config, 4);
    CHECK(service.discovery().count() == 1 &&
          service.discovery().query(text<75>("agent:1"), 4).replies == 1);
    CHECK(inbox.latest() == 0 && info.transmitted == 1);
    std::cout << "ok discovery\n";
    return 0;
  }
  const auto destination = scenario == "local" ? device : text<64>("heltec-000000000002");
  const std::uint8_t body[] = {'h', 'i'};
  auto result = messages.submit(text<64>("agent"), text<75>("agent:1"), 0, destination, 0, 1, body,
                                sizeof(body), 1);
  CHECK(result.state == d::MessageState::Queued);
  service.tick(&config, 1);
  if (scenario == "local") {
    CHECK(messages.query(text<75>("agent:1")).state == d::MessageState::Acknowledged);
    CHECK(inbox.latest() == 1 && inbox.find(1)->size == 2 && info.transmitted == 0 && !transmitted);
    service.tick(&config, 2);
    CHECK(inbox.latest() == 1);
  } else if (scenario == "gate") {
    CHECK(messages.query(text<75>("agent:1")).state == d::MessageState::Failed && !transmitted);
    CHECK(info.state.length == 9 && info.reason.length == 19);  // receiving, antenna-unconfirmed
  } else if (scenario == "tx") {
    CHECK(transmitted && messages.query(text<75>("agent:1")).state == d::MessageState::Queued);
    irq = 1;
    service.tick(&config, 2);
    CHECK(info.transmitted == 1 &&
          messages.query(text<75>("agent:1")).state == d::MessageState::Transmitted);
    m::Packet ack{};
    ack.kind = m::PacketKind::Ack;
    ack.key.origin = 1;
    ack.key.boot = boot_counter;
    ack.key.sequence = 1;
    ack.destination = 2;
    ack.hops = 3;
    inject(ack);
    service.tick(&config, 3);
    CHECK(messages.query(text<75>("agent:1")).state == d::MessageState::Acknowledged);
    CHECK(info.received == 1);
  } else if (scenario == "identity") {
    // Agents on both ends correlate a message by ID, so a receiver must rebuild the sender's ID.
    m::Packet frame{};
    CHECK(transmitted && opened(frame));
    const auto id = messages.query(text<75>("agent:1")).message_id;
    CHECK(id.length);
    m::Packet heard = frame;
    heard.key.origin = 2;
    heard.destination = 1;
    irq = 1;
    service.tick(&config, 2);
    inject(heard);
    service.tick(&config, 3);
    const auto* item = inbox.find(inbox.latest());
    CHECK(item);
    CHECK(item->message_id.length == id.length &&
          !std::memcmp(item->message_id.bytes.data(), id.bytes.data(), id.length));
  } else if (scenario == "unset") {
    // A radio with no network chosen sends nothing and hears nothing.
    CHECK(messages.query(text<75>("agent:1")).state == d::MessageState::Failed && !transmitted);
    CHECK(info.reason.length == 18);  // network-not-chosen
    m::Packet ack{};
    ack.kind = m::PacketKind::Ack;
    ack.key.origin = 2;
    ack.key.boot = 2;
    ack.key.sequence = 1;
    ack.destination = 3;
    ack.hops = 3;
    inject(ack);
    service.tick(&config, 2);
    service.tick(&config, 200);
    CHECK(!transmitted);
    // Choosing Open mode brings it up.
    CHECK(!std::strcmp(network.fill(1, 0, 0, nullptr, nullptr, nullptr), "ok"));
    service.tick(&config, 201);
    CHECK(info.reason.length == 5);  // ready
  } else if (scenario == "teamrelay") {
    // With relay keys but no team key: it relays, and sends nothing of its own.
    reaper::crypto::Key relay_chain{}, device_key{}, team_chain{}, proof{};
    relay_chain.fill(0x11);
    device_key.fill(0x12);
    team_chain.fill(0x13);
    proof.fill(0x14);
    CHECK(!std::strcmp(network.fill(2, 1, 0, &relay_chain, &device_key, &proof), "ok"));
    config.settings.radio.relay = true;
    ++config.revision;
    service.tick(&config, 2);
    CHECK(info.reason.length == 15);  // team-key-needed
    CHECK(messages.query(text<75>("agent:1")).state == d::MessageState::Failed);
    CHECK(!transmitted);
    m::FrameLink member;
    reaper::crypto::Key seed{};
    seed.fill(3);
    member.seed(seed);
    CHECK(member.set_chains(relay_chain, &team_chain, 0));
    m::Packet heard{};
    heard.key.origin = 2;
    heard.key.boot = 2;
    heard.key.sequence = 1;
    heard.destination = 3;
    heard.hops = 2;
    heard.count = 1;
    heard.size = heard.total = 2;
    heard.bytes[0] = 'h';
    heard.bytes[1] = 'i';
    m::Frame frame{};
    CHECK(member.seal(heard, frame));
    received.assign(frame.bytes.begin(), frame.bytes.begin() + frame.size);
    irq = 2;
    service.tick(&config, 3);
    CHECK(info.received == 1 && inbox.latest() == 0);
    service.tick(&config, 200);
    CHECK(transmitted);
    // Everything but the hop count is the original frame.
    CHECK(sent.size() == frame.size && sent[5] == 0x21);
    CHECK(std::equal(sent.begin() + 6, sent.end(), frame.bytes.begin() + 6));
    // Loading the team key lets it read and send.
    irq = 1;
    service.tick(&config, 201);
    CHECK(!std::strcmp(network.load_team(1, 0, team_chain), "ok"));
    service.tick(&config, 202);
    CHECK(info.reason.length == 5);  // ready
    heard.key.sequence = 2;
    heard.destination = 1;
    CHECK(member.seal(heard, frame));
    received.assign(frame.bytes.begin(), frame.bytes.begin() + frame.size);
    irq = 2;
    service.tick(&config, 203);
    CHECK(inbox.latest() == 1);
  } else if (scenario == "noboot") {
    // Without a saved boot counter, nothing goes out.
    CHECK(messages.query(text<75>("agent:1")).state == d::MessageState::Failed && !transmitted);
    CHECK(info.reason.length == 22);  // frame-keys-unavailable
  } else if (scenario == "policy") {
    CHECK(transmitted);
    config.settings.radio.mode = d::RadioMode::Off;
    ++config.revision;
    service.tick(&config, 2);
    CHECK(messages.query(text<75>("agent:1")).state == d::MessageState::Failed);
    irq = 1;
    service.tick(&config, 3);
    CHECK(info.transmitted == 0);
  } else
    return 3;
  std::cout << "ok " << scenario << '\n';
}
