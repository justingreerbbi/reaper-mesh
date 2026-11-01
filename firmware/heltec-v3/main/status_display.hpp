#pragma once
#include "driver/i2c_master.h"
#include <array>
#include <cstdint>
// Board-only, best-effort status. No protocol decisions or persistent state.
class StatusDisplay {
 public:
  void begin();
  void update(const char* usb, bool healthy, std::uint32_t revision, const char* radio = "RADIO OFF");
 private:
  i2c_master_bus_handle_t bus_ = nullptr;
  i2c_master_dev_handle_t device_ = nullptr;
  bool ready_ = false;
  std::array<std::uint8_t, 1025> pixels_{};
  std::array<std::uint8_t, 1025> previous_{};
  bool send(const std::uint8_t*, std::size_t);
  void text(unsigned row, const char*);
};
