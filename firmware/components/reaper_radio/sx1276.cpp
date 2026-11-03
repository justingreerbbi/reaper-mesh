#include "reaper/sx1276.hpp"
#include <cstring>
namespace reaper::radio {
bool Sx1276::transfer(std::uint8_t reg, const std::uint8_t* input, std::uint8_t* output,
                      std::size_t size) {
  if (!size || size > mesh::kMaxPacketBytes)
    return false;
  std::array<std::uint8_t, mesh::kMaxPacketBytes + 1> tx{}, rx{};
  tx[0] = reg;
  if (input)
    std::memcpy(tx.data() + 1, input, size);
  if (!bus_.ready(20) || !bus_.transfer(tx.data(), rx.data(), size + 1) || !bus_.ready(20)) {
    stop();
    return false;
  }
  if (output)
    std::memcpy(output, rx.data() + 1, size);
  return true;
}
bool Sx1276::read(std::uint8_t reg, std::uint8_t& value) {
  return transfer(reg & 0x7f, nullptr, &value, 1);
}
bool Sx1276::write(std::uint8_t reg, std::uint8_t value) {
  return transfer(reg | 0x80, &value, nullptr, 1);
}
void Sx1276::stop() {
  bus_.off();
  healthy_ = receive_ = allow_tx_ = transmitting_ = false;
}
bool Sx1276::listen() {
  return write(0x0d, 0) && write(0x12, 0xff) && write(0x01, 0x85);
}
bool Sx1276::configure(std::uint8_t power, bool receive, bool transmit) {
  stop();
  if (power > mesh::kUs915Lab1.max_power_dbm || (transmit && power < 2) || !bus_.reset() ||
      !read(0x42, version_) || version_ != 0x12) {
    stop();
    return false;
  }
  // Sleep before switching the LoRa register bank; 32 MHz reference, 915 MHz.
  const std::uint32_t frequency = (std::uint64_t(mesh::kUs915Lab1.frequency_hz) << 19) / 32000000;
  // T-Beam routes PA_BOOST only: 2..10 dBm. Lower values are RX/probe-only.
  const auto pa = std::uint8_t(0x80 | (power >= 2 ? power - 2 : 0));
  if (!write(0x01, 0x00) || !write(0x01, 0x80) || !write(0x01, 0x81) ||
      !write(0x06, std::uint8_t(frequency >> 16)) || !write(0x07, std::uint8_t(frequency >> 8)) ||
      !write(0x08, std::uint8_t(frequency)) || !write(0x09, pa) || !write(0x0a, 0x09) ||
      !write(0x0b, 0x2b) || !write(0x4d, 0x84) || !write(0x0c, 0x23) || !write(0x0e, 0) ||
      !write(0x0f, 0) || !write(0x11, 0) || !write(0x1d, 0x92) || !write(0x1e, 0x74) ||
      !write(0x26, 0x04) || !write(0x20, 0) || !write(0x21, 8) ||
      !write(0x23, mesh::kMaxPacketBytes) || !write(0x31, 0x03) || !write(0x37, 0x0a) ||
      !write(0x39, 0x52) || !write(0x33, 0x27) || !write(0x3b, 0x1d) || !write(0x36, 0x02) ||
      !write(0x3a, 0x64) || !write(0x40, 0) || !write(0x12, 0xff))
    return false;
  std::uint8_t mode = 0, modem = 0, sync = 0;
  if (!read(0x01, mode) || mode != 0x81 || !read(0x1d, modem) || modem != 0x92 ||
      !read(0x39, sync) || sync != 0x52) {
    stop();
    return false;
  }
  healthy_ = true;
  receive_ = receive;
  allow_tx_ = receive && transmit;
  return !receive || listen();
}
Start Sx1276::transmit(const std::uint8_t* bytes, std::size_t size, std::uint64_t now) {
  if (!healthy_)
    return Start::Fault;
  mesh::Packet decoded{};
  if (!allow_tx_ || !mesh::decode_packet(bytes, size, decoded))
    return Start::Rejected;
  if (transmitting_)
    return Start::Wait;
  if (!budget_.reserve(now, mesh::airtime_us(size) + 1000))
    return Start::Wait;
  if (!write(0x01, 0x81) || !write(0x0d, 0) || !write(0x22, size) ||
      !transfer(0x80, bytes, nullptr, size) || !write(0x12, 0xff) || !write(0x01, 0x83))
    return Start::Fault;
  transmitting_ = true;
  deadline_ = now + 1100;
  return Start::Started;
}
Event Sx1276::poll(std::uint64_t now) {
  Event event{};
  if (!healthy_)
    return event;
  std::uint8_t irq = 0;
  const bool active = transmitting_;
  if (!read(0x12, irq) || (irq && !write(0x12, irq))) {
    event.tx_done = active;
    return event;
  }
  if (transmitting_ && ((irq & 0x08) || now >= deadline_)) {
    event.tx_done = true;
    event.tx_success = (irq & 0x08) && now < deadline_;
    transmitting_ = false;
    if (receive_)
      listen();
  } else if (!transmitting_ && (irq & 0x40) && !(irq & 0x20)) {
    std::uint8_t size = 0, start = 0;
    if (read(0x13, size) && size >= 54 && size <= mesh::kMaxPacketBytes && read(0x10, start) &&
        write(0x0d, start) && transfer(0, nullptr, event.bytes.data(), size)) {
      mesh::Packet decoded{};
      if (mesh::decode_packet(event.bytes.data(), size, decoded)) {
        event.received = true;
        event.size = size;
      }
    }
  }
  return event;
}
}  // namespace reaper::radio
