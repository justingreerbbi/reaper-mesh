#pragma once
#include "reaper/radio.hpp"
#include "driver/spi_master.h"
#include <array>
class RadioBus : public reaper::radio::Bus {
 public:
  bool begin();
  bool ready(std::uint32_t timeout_ms) override;
  bool transfer(const std::uint8_t*, std::uint8_t*, std::size_t) override;
  bool reset() override;
  void off() override;
  std::uint8_t last_command() const { return last_command_; }

 private:
  spi_device_handle_t device_ = nullptr;
  bool failed_ = false;
  std::uint8_t last_command_ = 0;
  // Keep queued transaction storage alive even if native completion times out.
  spi_transaction_t transaction_{};
  alignas(4) std::array<std::uint8_t, 260> tx_{};
  alignas(4) std::array<std::uint8_t, 260> rx_{};
};
