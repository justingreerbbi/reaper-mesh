#include "reaper/lr1110.hpp"
#include <array>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <string>
#include <vector>
namespace r = reaper::radio;
namespace m = reaper::mesh;
#define CHECK(v)                                              \
  do {                                                        \
    if (!(v)) {                                               \
      std::cerr << "line " << __LINE__ << ": " << #v << '\n'; \
      return 1;                                               \
    }                                                         \
  } while (false)
// A simulated LR1110 that decodes the driver's real SPI commands: opcode, arguments, and the
// two-transaction reads (command, then Stat1 and the reply). A transfer of only zero bytes with no
// read pending is the GetStatus direct read.
struct Chip : r::Bus {
  std::uint8_t type = 0x01, mode = 1;  // LR1110, standby RC
  std::uint16_t errors = 0, firmware = 0x0401;
  bool tcxo_fails = false, failed = false, off_called = false, read_pending = false;
  std::uint32_t irq = 0, irq_enabled = 0, frequency = 0;
  std::uint8_t tcxo = 0xff, sync = 0, power_set = 0, fallback = 0;
  std::array<std::uint8_t, 8> rf_switch{};
  std::array<std::uint8_t, 4> pa{};
  std::uint8_t packet_size = 0, sf = 0, bw = 0, cr = 0;
  unsigned tx = 0, rx = 0, calibrations = 0;
  std::array<std::uint8_t, 256> tx_buffer{}, rx_buffer{};
  std::uint8_t rx_size = 0, rx_start = 0;
  std::vector<std::uint8_t> reply;
  bool ready(std::uint32_t) override { return !failed; }
  bool reset() override {
    mode = 1;
    irq = 0;
    return !failed;
  }
  void off() override { off_called = true; }
  static std::uint32_t word(const std::uint8_t* b) {
    return std::uint32_t(b[0]) << 24 | std::uint32_t(b[1]) << 16 | std::uint32_t(b[2]) << 8 | b[3];
  }
  bool transfer(const std::uint8_t* in, std::uint8_t* out, std::size_t size) override {
    if (failed || !size || size > 260)
      return false;
    std::memset(out, 0, size);
    bool zeros = true;
    for (std::size_t i = 0; i < size; ++i)
      zeros = zeros && !in[i];
    if (zeros && read_pending) {
      out[0] = 0x03 << 1;  // Stat1: command status DATA
      for (std::size_t i = 0; i + 1 < size && i < reply.size(); ++i)
        out[i + 1] = reply[i];
      read_pending = false;
      return true;
    }
    if (zeros) {           // GetStatus
      out[0] = 0x02 << 1;  // OK
      out[1] = static_cast<std::uint8_t>(mode << 1);
      out[2] = irq >> 24, out[3] = irq >> 16, out[4] = irq >> 8, out[5] = irq;
      return true;
    }
    if (size < 2)
      return false;
    const unsigned opcode = in[0] << 8 | in[1];
    const auto* a = in + 2;
    const auto read = [&](std::vector<std::uint8_t> bytes) {
      reply = std::move(bytes);
      read_pending = true;
    };
    switch (opcode) {
      case 0x0101:
        read({0x22, type, std::uint8_t(firmware >> 8), std::uint8_t(firmware)});
        break;
      case 0x010d:
        read({std::uint8_t(errors >> 8), std::uint8_t(errors)});
        break;
      case 0x010e:
        errors = 0;
        break;
      case 0x010f:
        ++calibrations;
        if (tcxo_fails)
          errors |= 0x20;  // HF_XOSC_START
        break;
      case 0x0111:
        break;  // Image calibration
      case 0x0110:
        break;  // Regulator mode
      case 0x0112:
        std::memcpy(rf_switch.data(), a, 8);
        break;
      case 0x0113:
        irq_enabled = word(a);
        break;
      case 0x0114:
        irq &= ~word(a);
        break;
      case 0x0117:
        tcxo = a[0];
        break;
      case 0x011c:
        mode = 1;
        break;
      case 0x0109:
        std::memcpy(tx_buffer.data(), a, size - 2);
        break;
      case 0x010a:
        read(std::vector<std::uint8_t>(rx_buffer.begin() + a[0], rx_buffer.begin() + a[0] + a[1]));
        break;
      case 0x0203:
        read({rx_size, rx_start});
        break;
      case 0x0209:
        ++rx, mode = 5;
        break;
      case 0x020a:
        ++tx, mode = 4;
        break;
      case 0x020b:
        frequency = word(a);
        break;
      case 0x020e:
        break;
      case 0x020f:
        sf = a[0], bw = a[1], cr = a[2];
        break;
      case 0x0210:
        packet_size = a[3];
        break;
      case 0x0211:
        power_set = a[0];
        break;
      case 0x0213:
        fallback = a[0];
        break;
      case 0x0215:
        std::memcpy(pa.data(), a, 4);
        break;
      case 0x022b:
        sync = a[0];
        break;
      case 0x010c:
        break;  // High-ACP workaround register write
      default:
        return false;
    }
    return true;
  }
};
const r::Lr1110Wiring kWiring{0x00, 164, 0x0f, 0, 0x09, 0x0b, 0x0a, 0, 0x04, 0};
std::vector<std::uint8_t> bytes() {
  // The driver carries bytes without reading them, so this only needs a frame's size and layout.
  std::vector<std::uint8_t> out(m::kFragmentBytes + m::kMinPacketBytes, 'x');
  out[0] = 2;
  out[5] = 0x33;
  return out;
}
int main(int argc, char** argv) {
  if (argc != 2)
    return 2;
  const std::string scenario = argv[1];
  Chip chip;
  r::Lr1110 radio(chip, kWiring);
  const auto packet = bytes();
  if (scenario == "receive") {
    CHECK(radio.configure(m::TxLevel::Low, false, true, false));
    // Board wiring reaches the chip unchanged; the modem matches the SX1262 boards.
    CHECK(chip.tcxo == 0x00 && chip.rf_switch[0] == 0x0f && chip.rf_switch[2] == 0x09 &&
          chip.rf_switch[3] == 0x0b && chip.rf_switch[4] == 0x0a && chip.rf_switch[6] == 0x04);
    CHECK(chip.frequency == m::kUs915Lab1.frequency_hz && chip.sf == 7 && chip.bw == 6 &&
          chip.cr == 1 && chip.sync == 0x52 && chip.calibrations == 1);
    CHECK(chip.pa[0] == 1 && chip.pa[1] == 1 && chip.pa[2] == 4 && chip.pa[3] == 7);
    CHECK(static_cast<std::int8_t>(chip.power_set) == -9 && chip.fallback == 1);
    CHECK(chip.rx == 1 && chip.tx == 0 && chip.packet_size == m::kMaxPacketBytes);
    CHECK(radio.transmit(packet.data(), packet.size(), 0) == r::Start::Rejected);
    std::copy(packet.begin(), packet.end(), chip.rx_buffer.begin() + 4);
    chip.rx_size = static_cast<std::uint8_t>(packet.size());
    chip.rx_start = 4;
    chip.irq = (1 << 3) | (1 << 7);  // RX done with a CRC error
    CHECK(!radio.poll(1).received && chip.irq == 0);
    chip.irq = 1 << 3;
    auto result = radio.poll(2);
    CHECK(result.received && result.size == packet.size());
    CHECK(std::memcmp(result.bytes.data(), packet.data(), packet.size()) == 0);
    chip.rx_buffer[4] ^= 1;  // Not a version 2 frame. Authentication happens above the driver.
    chip.irq = 1 << 3;
    CHECK(!radio.poll(3).received);
  } else if (scenario == "tx") {
    CHECK(radio.configure(m::TxLevel::High, false, true, true) && chip.power_set == 22);
    CHECK(radio.transmit(packet.data(), packet.size(), 0) == r::Start::Started);
    CHECK(chip.tx == 1 && chip.packet_size == packet.size() &&
          std::memcmp(chip.tx_buffer.data(), packet.data(), packet.size()) == 0);
    CHECK(radio.transmit(packet.data(), packet.size(), 1) == r::Start::Wait);
    chip.irq = 1 << 2;  // TX done
    const auto done = radio.poll(2);
    CHECK(done.tx_done && done.tx_success && chip.rx == 2 && radio.transmitting() == false);
    CHECK(radio.transmit(packet.data(), packet.size(), 3) == r::Start::Started);
    chip.irq = 1 << 2;
    const auto late = radio.poll(1103);
    CHECK(late.tx_done && !late.tx_success);
    CHECK(radio.transmit(packet.data(), 3, 1200) == r::Start::Rejected);
  } else if (scenario == "faults") {
    CHECK(!radio.configure(static_cast<m::TxLevel>(3), false, true, true) && chip.tx == 0);
    CHECK(!radio.configure(m::TxLevel::Low, true, true, true));  // No boost on this chip.
    chip.type = 0x03;  // An LR1121 is not this board's chip.
    CHECK(!radio.configure(m::TxLevel::Low, false, true, true) && radio.chip_mode() == 3);
    chip.type = 0x01;
    chip.firmware = 0x0302;  // Too old to set the Reaper sync word.
    CHECK(!radio.configure(m::TxLevel::Low, false, true, true) && radio.firmware() == 0x0302 &&
          chip.rx == 0);
    chip.firmware = 0x0401;
    chip.tcxo_fails = true;  // A wrong TCXO supply leaves the radio off and says why.
    CHECK(!radio.configure(m::TxLevel::Low, false, true, true) && radio.device_errors() == 0x20 &&
          !radio.healthy() && chip.rx == 0);
    chip.tcxo_fails = false;
    CHECK(radio.configure(m::TxLevel::Medium, false, true, true) && chip.power_set == 7);
    CHECK(r::Lr1110::dbm(m::TxLevel::Low) == -9 && r::Lr1110::dbm(m::TxLevel::Medium) == 7 &&
          r::Lr1110::dbm(m::TxLevel::High) == 22 && !r::Lr1110::kHasBoost);
    CHECK(radio.transmit(packet.data(), packet.size(), 0) == r::Start::Started);
    chip.failed = true;
    const auto failed = radio.poll(1);
    CHECK(failed.tx_done && !failed.tx_success && !radio.healthy() && chip.off_called);
  } else
    return 3;
  std::cout << "ok " << scenario << '\n';
}
