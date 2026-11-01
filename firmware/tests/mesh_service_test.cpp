#include "mesh_service.hpp"
#include <iostream>
#include <string>
#include <vector>
#include <cstring>
#include <cstdlib>
namespace d = reaper::device; namespace m = reaper::mesh;
#define CHECK(v) do { if (!(v)) { std::cerr << "line " << __LINE__ << ": " << #v << '\n'; return 1; } } while(false)
static bool failure = false, transmitted = false; static std::uint16_t irq = 0;
static std::vector<std::uint8_t> received;
bool RadioBus::begin() { device_ = this; failed_ = failure; transaction_ = {}; tx_.fill(0); rx_.fill(0); (void)transaction_; return device_ && !failed_; }
bool RadioBus::ready(std::uint32_t) { return !failure; }
bool RadioBus::reset() { return !failure; }
void RadioBus::off() {}
bool RadioBus::transfer(const std::uint8_t* tx, std::uint8_t* rx, std::size_t size) {
  if (failure) return false;
  std::memset(rx, 0, size);
  if (tx[0] == 0xc0) rx[1] = 0x24;
  if (tx[0] == 0x12) { rx[2] = irq >> 8; rx[3] = irq; }
  if (tx[0] == 0x02) irq = 0;
  if (tx[0] == 0x83) transmitted = true;
  if (tx[0] == 0x13) { rx[2] = received.size(); rx[3] = 0; }
  if (tx[0] == 0x1e && size >= 3 + received.size()) std::memcpy(rx + 3, received.data(), received.size());
  return true;
}
template<std::size_t N> d::Text<N> text(const char* str) { d::Text<N> t{}; t.assign(reinterpret_cast<const std::uint8_t*>(str), std::strlen(str)); return t; }
void inject(m::Packet p) { std::size_t size = 0; received.resize(214); if (!m::encode_packet(p, received.data(), received.size(), size)) std::abort(); received.resize(size); irq = 2; }
int main(int argc, char** argv) {
  if (argc != 2) return 2;
  const std::string scenario = argv[1]; const auto device = text<64>("heltec-000000000001");
  const auto boot = text<64>("2a00000000000000000000000000000000"); std::array<std::uint8_t, 16> nonce{}; nonce[0] = 42;
  d::MessageQueue messages(boot); d::Inbox inbox; d::RadioInfo info{};
  MeshService service(messages, inbox, info, device, nonce, 1, scenario == "tx" || scenario == "policy");
  service.begin(); CHECK(info.probe); d::Snapshot config{}; config.settings.region = d::Region::Us;
  if (scenario != "local") config.settings.radio.mode = d::RadioMode::Mesh;
  service.tick(&config, 0);
  const auto destination = scenario == "local" ? device : text<64>("heltec-000000000002");
  const std::uint8_t body[] = {'h','i'};
  auto result = messages.submit(text<64>("client"), text<75>("client:1"), 0, destination, 0, 1, body, sizeof(body), 1);
  CHECK(result.state == d::MessageState::Queued); service.tick(&config, 1);
  if (scenario == "local") {
    CHECK(messages.query(text<75>("client:1")).state == d::MessageState::Acknowledged);
    CHECK(inbox.latest() == 1 && inbox.find(1)->size == 2 && info.transmitted == 0 && !transmitted);
    service.tick(&config, 2); CHECK(inbox.latest() == 1);
  } else if (scenario == "gate") {
    CHECK(messages.query(text<75>("client:1")).state == d::MessageState::Failed && !transmitted);
    CHECK(info.state.length == 9 && info.reason.length == 19); // receiving, antenna-unconfirmed
  } else if (scenario == "tx") {
    CHECK(transmitted && messages.query(text<75>("client:1")).state == d::MessageState::Queued);
    irq = 1; service.tick(&config, 2);
    CHECK(info.transmitted == 1 && messages.query(text<75>("client:1")).state == d::MessageState::Transmitted);
    m::Packet ack{}; ack.kind = m::PacketKind::Ack; ack.key.origin = 1; ack.key.boot = nonce; ack.key.sequence = 1; ack.destination = 2; ack.hops = 3;
    inject(ack); service.tick(&config, 3); CHECK(messages.query(text<75>("client:1")).state == d::MessageState::Acknowledged);
    CHECK(info.received == 1);
  } else if (scenario == "policy") {
    CHECK(transmitted); config.settings.radio.mode = d::RadioMode::Off; ++config.revision;
    service.tick(&config, 2); CHECK(messages.query(text<75>("client:1")).state == d::MessageState::Failed);
    irq = 1; service.tick(&config, 3); CHECK(info.transmitted == 0);
  } else return 3;
  std::cout << "ok " << scenario << '\n';
}
