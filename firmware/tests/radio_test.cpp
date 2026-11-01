#include "reaper/radio.hpp"
#include "sx126x.h"
#include <iostream>
#include <vector>
#include <string>
#include <cstring>
#include <cstdlib>
namespace r = reaper::radio; namespace m = reaper::mesh;
#define CHECK(v) do { if (!(v)) { std::cerr << "line " << __LINE__ << ": " << #v << '\n'; return 1; } } while(false)
struct Bus : r::Bus {
  bool fail = false, off_called = false; unsigned resets = 0; std::uint16_t irq = 0, errors = 0;
  std::vector<std::uint8_t> incoming; std::vector<std::vector<std::uint8_t>> commands;
  bool ready(std::uint32_t timeout) override { if (timeout != 20) std::abort(); return !fail; }
  bool reset() override { ++resets; return !fail; }
  void off() override { off_called = true; }
  bool transfer(const std::uint8_t* tx, std::uint8_t* rx, std::size_t size) override {
    if (size > 260 || !size) std::abort();
    if (fail) return false;
    commands.emplace_back(tx, tx + size); std::memset(rx, 0, size);
    if (tx[0] == 0xc0) rx[1] = 0x24;
    if (tx[0] == 0x12) { rx[2] = irq >> 8; rx[3] = irq; }
    if (tx[0] == 0x02) irq = 0;
    if (tx[0] == 0x17) { rx[2] = errors >> 8; rx[3] = errors; }
    if (tx[0] == 0x13) { rx[2] = incoming.size(); rx[3] = 0; }
    if (tx[0] == 0x1e && size >= 3 + incoming.size()) std::memcpy(rx + 3, incoming.data(), incoming.size());
    return true;
  }
  bool has(std::uint8_t opcode) const { for (const auto& c : commands) if (c[0] == opcode) return true; return false; }
};
std::vector<std::uint8_t> packet() {
  m::Packet p{}; p.key.origin = 1; p.destination = 2; p.key.boot[0] = 42; p.key.sequence = 1;
  p.count = 1; p.size = p.total = 160; p.bytes.fill('x');
  std::vector<std::uint8_t> bytes(m::kMaxPacketBytes); std::size_t size = 0;
  if (!m::encode_packet(p, bytes.data(), bytes.size(), size)) std::abort();
  bytes.resize(size); return bytes;
}
int main(int argc, char** argv) {
  if (argc != 2) return 2;
  const std::string scenario = argv[1]; Bus bus; r::Radio radio(bus); auto bytes = packet();
  if (scenario == "receive") {
    CHECK(radio.configure(0, true, false)); CHECK(bus.resets == 1 && radio.healthy() && bus.has(0x82));
    CHECK(radio.transmit(bytes.data(), bytes.size(), 0) == r::Start::Rejected && !bus.has(0x83));
    bus.incoming = bytes; bus.irq = SX126X_IRQ_RX_DONE | SX126X_IRQ_CRC_ERROR;
    CHECK(!radio.poll(1).received && radio.healthy());
    bus.irq = SX126X_IRQ_RX_DONE; auto event = radio.poll(2); CHECK(event.received && event.size == bytes.size());
    CHECK(std::memcmp(event.bytes.data(), bytes.data(), bytes.size()) == 0);
    bus.incoming.back() ^= 1; bus.irq = SX126X_IRQ_RX_DONE; CHECK(!radio.poll(3).received);
  } else if (scenario == "tx") {
    CHECK(radio.configure(10, true, true)); CHECK(!bus.has(0x83));
    CHECK(radio.transmit(bytes.data(), bytes.size(), 0) == r::Start::Started && radio.transmitting());
    CHECK(radio.transmit(bytes.data(), bytes.size(), 1) == r::Start::Wait);
    bus.irq = SX126X_IRQ_TX_DONE; auto event = radio.poll(2); CHECK(event.tx_done && event.tx_success && !radio.transmitting());
    unsigned count = 1;
    for (; count < 20; ++count) {
      auto start = radio.transmit(bytes.data(), bytes.size(), count * 3);
      if (start == r::Start::Wait) break;
      CHECK(start == r::Start::Started); bus.irq = SX126X_IRQ_TX_DONE; CHECK(radio.poll(count * 3 + 1).tx_success);
    }
    CHECK(count == 11); CHECK(radio.transmit(bytes.data(), bytes.size(), 100000) == r::Start::Started);
    event = radio.poll(101100); CHECK(event.tx_done && !event.tx_success && !radio.transmitting());
    const sx126x_pkt_params_lora_t params{8, SX126X_LORA_PKT_EXPLICIT, 214, true, false};
    const sx126x_mod_params_lora_t mod{SX126X_LORA_SF7, SX126X_LORA_BW_500, SX126X_LORA_CR_4_5, 0};
    CHECK(sx126x_get_lora_time_on_air_in_ms(&params, &mod) == (m::airtime_us(214) + 999) / 1000);
  } else if (scenario == "faults") {
    CHECK(!radio.configure(11, true, true) && bus.off_called && !bus.has(0x83));
    bus.off_called = false; CHECK(radio.configure(0, true, true));
    CHECK(radio.transmit(bytes.data(), bytes.size(), 0) == r::Start::Started);
    bus.fail = true; auto event = radio.poll(1); CHECK(event.tx_done && !event.tx_success && !radio.healthy() && bus.off_called);
    CHECK(radio.transmit(bytes.data(), bytes.size(), 2) == r::Start::Fault);
    Bus broken; broken.errors = SX126X_ERRORS_PLL_CALIBRATION; r::Radio bad(broken);
    CHECK(!bad.configure(0, true, false) && broken.off_called && !broken.has(0x83));
  } else return 3;
  std::cout << "ok " << scenario << '\n';
}
