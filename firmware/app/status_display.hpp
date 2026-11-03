#pragma once
#include "device_ui.hpp"
#include "driver/i2c_master.h"
#include <array>
#include <cstdint>
// SSD1306 panel transport. Board files implement begin(); power() and show() are shared.
// Best effort: any bus fault disables the display without blocking USB or radio work.
class StatusDisplay {
 public:
  void begin();
  bool ready() const { return ready_; }
  // Turns the panel and its charge pump on or off. The panel keeps its image while off.
  void power(bool on);
  // Sends the frame if it differs from the last one shown. Does nothing while off.
  void show(const reaper::ui::Frame&);

 private:
  i2c_master_bus_handle_t bus_ = nullptr;
  i2c_master_dev_handle_t device_ = nullptr;
  bool ready_ = false, on_ = true, drawn_ = false;
  reaper::ui::Frame previous_{};
  std::array<std::uint8_t, 1 + reaper::ui::kWidth * reaper::ui::kHeight / 8> buffer_{};
  bool send(const std::uint8_t*, std::size_t);
  // Shared SSD1306 setup once the board has powered and reset the panel.
  void configure();
};
