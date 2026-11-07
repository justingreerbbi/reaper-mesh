#pragma once
// The board's status LED. Its policy is reaper::ui::Indicator; other LEDs on a board are wired to
// its charger or GPS and are not controlled by firmware.
class BoardLed {
 public:
  void begin();
  void set(bool on);

 private:
  bool on_ = false;
};
