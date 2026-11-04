#include "reaper/sx1276.hpp"
#include <array>
#include <vector>
#include <cstring>
#include <iostream>
#include <string>
#include <cstdlib>
namespace r = reaper::radio;
namespace m = reaper::mesh;
#define CHECK(v)                                              \
  do {                                                        \
    if (!(v)) {                                               \
      std::cerr << "line " << __LINE__ << ": " << #v << '\n'; \
      return 1;                                               \
    }                                                         \
  } while (false)
struct Bus : r::Bus {
  std::array<std::uint8_t, 128> registers{};
  std::array<std::uint8_t, 256> fifo{};
  bool failed = false, off_called = false;
  unsigned tx = 0;
  Bus() { registers[0x42] = 0x12; }
  bool ready(std::uint32_t timeout) override { return timeout == 20 && !failed; }
  bool reset() override { return !failed; }
  void off() override { off_called = true; }
  bool transfer(const std::uint8_t* input, std::uint8_t* output, std::size_t size) override {
    if (failed || size < 2 || size > 215)
      return false;
    output[0] = 0;
    const auto address = input[0] & 0x7f;
    const bool write = input[0] & 0x80;
    for (std::size_t i = 1; i < size; ++i) {
      auto reg = (address + i - 1) & 0x7f;
      if (!address) {
        auto& byte = fifo[registers[0x0d]++];
        if (write)
          byte = input[i];
        else
          output[i] = byte;
      } else if (write) {
        if (reg == 0x12)
          registers[reg] &= ~input[i];
        else
          registers[reg] = input[i];
        if (reg == 1 && input[i] == 0x83)
          ++tx;
      } else
        output[i] = registers[reg];
    }
    return true;
  }
};
std::vector<std::uint8_t> bytes() {
  m::Packet p{};
  p.key.origin = 1;
  p.key.boot[0] = 42;
  p.key.sequence = 1;
  p.destination = 2;
  p.count = 1;
  p.total = p.size = 160;
  p.bytes.fill('x');
  std::vector<std::uint8_t> out(m::kMaxPacketBytes);
  std::size_t n = 0;
  if (!m::encode_packet(p, out.data(), out.size(), n))
    std::abort();
  out.resize(n);
  return out;
}
int main(int argc, char** argv) {
  if (argc != 2)
    return 2;
  const std::string scenario = argv[1];
  Bus bus;
  r::Sx1276 radio(bus);
  const auto packet = bytes();
  if (scenario == "receive") {
    CHECK(radio.configure(m::TxLevel::Low, false, true, false));
    CHECK(bus.tx == 0 && bus.registers[1] == 0x85);
    CHECK(bus.registers[6] == 0xe4 && bus.registers[7] == 0xc0 && bus.registers[8] == 0);
    CHECK(bus.registers[0x1d] == 0x92 && bus.registers[0x1e] == 0x74 &&
          bus.registers[0x39] == 0x52);
    CHECK(radio.transmit(packet.data(), packet.size(), 0) == r::Start::Rejected);
    std::copy(packet.begin(), packet.end(), bus.fifo.begin());
    bus.registers[0x13] = packet.size();
    bus.registers[0x10] = 0;
    bus.registers[0x12] = 0x60;
    CHECK(!radio.poll(1).received);
    bus.registers[0x12] = 0x40;
    auto result = radio.poll(2);
    CHECK(result.received && result.size == packet.size());
    CHECK(std::memcmp(result.bytes.data(), packet.data(), packet.size()) == 0);
    bus.fifo[20] ^= 1;
    bus.registers[0x12] = 0x40;
    CHECK(!radio.poll(3).received);
  } else if (scenario == "tx") {
    CHECK(radio.configure(m::TxLevel::Low, false, true, true));
    CHECK(bus.tx == 0 && bus.registers[9] == 0x80 && bus.registers[0x4d] == 0x84 &&
          bus.registers[0x0b] == 0x2b);
    CHECK(radio.transmit(packet.data(), packet.size(), 0) == r::Start::Started);
    CHECK(std::memcmp(bus.fifo.data(), packet.data(), packet.size()) == 0 &&
          bus.registers[0x22] == packet.size());
    CHECK(radio.transmit(packet.data(), packet.size(), 1) == r::Start::Wait);
    bus.registers[0x12] = 8;
    const auto done = radio.poll(2);
    CHECK(done.tx_done && done.tx_success && bus.registers[1] == 0x85);
    CHECK(radio.transmit(packet.data(), packet.size(), 3) == r::Start::Started);
    bus.registers[0x12] = 8;
    const auto late = radio.poll(1103);
    CHECK(late.tx_done && !late.tx_success);
  } else if (scenario == "faults") {
    CHECK(!radio.configure(static_cast<m::TxLevel>(3), false, true, true) && bus.tx == 0);
    bus.registers[0x42] = 0;
    CHECK(!radio.configure(m::TxLevel::Low, false, true, true) && !radio.healthy());
    bus.registers[0x42] = 0x12;
    CHECK(radio.configure(m::TxLevel::Medium, false, true, true) && bus.registers[9] == 0x88);
    CHECK(radio.configure(m::TxLevel::High, false, true, true) && bus.registers[9] == 0x8f);
    // Boost keeps the same output setting and raises the PA DAC and current limit.
    CHECK(radio.configure(m::TxLevel::Medium, true, true, true) && bus.registers[9] == 0x88 &&
          bus.registers[0x4d] == 0x87 && bus.registers[0x0b] == 0x31);
    CHECK(r::Sx1276::dbm(m::TxLevel::Low) == 2 && r::Sx1276::dbm(m::TxLevel::Medium) == 10 &&
          r::Sx1276::dbm(m::TxLevel::High) == 17 && r::Sx1276::dbm(m::TxLevel::Low, true) == 5 &&
          r::Sx1276::dbm(m::TxLevel::Medium, true) == 13 &&
          r::Sx1276::dbm(m::TxLevel::High, true) == 20);
    CHECK(radio.transmit(packet.data(), packet.size(), 0) == r::Start::Started);
    bus.failed = true;
    const auto failed = radio.poll(1);
    CHECK(failed.tx_done && !failed.tx_success && !radio.healthy() && bus.off_called);
  } else
    return 3;
  std::cout << "ok " << scenario << '\n';
}
