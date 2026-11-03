#pragma once
#include <cstdint>
// Power state for the screen. Values come only from a supported hardware measurement; boards
// without one report an unknown percent and no external power, and the screen shows nothing.
struct Battery {
  int percent = -1;       // 0-100; negative when unknown or no battery
  bool external = false;  // USB power present
};
class BoardPower {
 public:
  // Polls the hardware at most every two seconds and returns the last reading in between.
  Battery read(std::uint64_t now_ms);

 private:
  std::uint64_t next_poll_ = 0;
  Battery last_{};
};
