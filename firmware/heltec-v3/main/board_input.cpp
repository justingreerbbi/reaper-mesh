#include "board_input.hpp"
#include "driver/gpio.h"
void BoardInput::begin() {
  // PRG button on GPIO0, active low. GPIO0 only acts as a boot strap while the board resets.
  gpio_config_t config{};
  config.pin_bit_mask = 1ULL << GPIO_NUM_0;
  config.mode = GPIO_MODE_INPUT;
  config.pull_up_en = GPIO_PULLUP_ENABLE;
  config.pull_down_en = GPIO_PULLDOWN_DISABLE;
  config.intr_type = GPIO_INTR_DISABLE;
  gpio_config(&config);
}
bool BoardInput::main_pressed() const {
  return gpio_get_level(GPIO_NUM_0) == 0;
}
bool BoardInput::take_next_page(std::uint64_t) {
  return false;
}
