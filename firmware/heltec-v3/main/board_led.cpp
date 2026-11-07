#include "board_led.hpp"
#include "driver/gpio.h"
namespace {
// White LED on GPIO35, lit by a high level.
constexpr auto kPin = GPIO_NUM_35;
constexpr int kOn = 1;
}  // namespace
void BoardLed::begin() {
  gpio_set_level(kPin, !kOn);
  gpio_set_direction(kPin, GPIO_MODE_OUTPUT);
}
void BoardLed::set(bool on) {
  if (on == on_)
    return;
  on_ = on;
  gpio_set_level(kPin, on ? kOn : !kOn);
}
