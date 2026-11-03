#pragma once
#include "reaper/radio.hpp"
namespace reaper::radio {
// First-party, bounded register driver. Same Reaper modem/profile as SX1262.
class Sx1276 {
 public:
  explicit Sx1276(Bus& bus) : bus_(bus) {}
  bool configure(std::uint8_t power, bool receive, bool transmit);
  void stop();
  Start transmit(const std::uint8_t*, std::size_t, std::uint64_t now);
  Event poll(std::uint64_t now);
  bool healthy() const { return healthy_; }
  bool transmitting() const { return transmitting_; }
  std::uint8_t chip_mode() const { return version_; }
  std::uint8_t command_status() const { return 0; }
  std::uint16_t device_errors() const { return 0; }

 private:
  Bus& bus_;
  mesh::AirtimeBudget budget_{};
  bool healthy_ = false, receive_ = false, allow_tx_ = false, transmitting_ = false;
  std::uint8_t version_ = 0;
  std::uint64_t deadline_ = 0;
  bool read(std::uint8_t reg, std::uint8_t& value);
  bool write(std::uint8_t reg, std::uint8_t value);
  bool transfer(std::uint8_t reg, const std::uint8_t*, std::uint8_t*, std::size_t);
  bool listen();
};
}  // namespace reaper::radio
