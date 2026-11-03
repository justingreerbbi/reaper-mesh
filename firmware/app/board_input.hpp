#pragma once
#include <cstdint>
// Board buttons. Every board has a main button that reaches every screen function; extra
// buttons only add shortcuts. Gestures are decoded by reaper::ui::ButtonGestures.
class BoardInput {
 public:
  void begin();
  // Raw main-button level: true while held.
  bool main_pressed() const;
  // True once per press of an optional next-page button (T-Beam PWR); false on other boards.
  bool take_next_page(std::uint64_t now_ms);

 private:
  std::uint64_t next_poll_ = 0;
};
