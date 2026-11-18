#pragma once
#include "reaper/radio.hpp"
#include <cstdint>
// The LR1110's SPI link and its RESET and BUSY lines (devicetree node `lr1110`). Every operation is
// bounded; once one fails, the bus stays failed until the next reset.
class RadioBus : public reaper::radio::Bus {
 public:
  bool begin();
  bool ready(std::uint32_t timeout_ms) override;
  bool transfer(const std::uint8_t*, std::uint8_t*, std::size_t) override;
  bool reset() override;
  void off() override;
  std::uint8_t last_command() const { return last_command_; }

 private:
  bool started_ = false, failed_ = false;
  std::uint8_t last_command_ = 0;
};
