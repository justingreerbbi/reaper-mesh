#include "board_input.hpp"
#include "driver/gpio.h"
#include "driver/i2c_master.h"
// Set by status_display.cpp: the AXP2101 handle and whether its power-key interrupt is enabled.
extern i2c_master_dev_handle_t tbeam_pmu;
extern bool tbeam_power_key;
void BoardInput::begin() {
  // Middle user button on GPIO38, active low. GPIO34-39 are input-only without internal
  // pull resistors, so this relies on the board's own pull-up.
  gpio_config_t config{};
  config.pin_bit_mask = 1ULL << GPIO_NUM_38;
  config.mode = GPIO_MODE_INPUT;
  config.pull_up_en = GPIO_PULLUP_DISABLE;
  config.pull_down_en = GPIO_PULLDOWN_DISABLE;
  config.intr_type = GPIO_INTR_DISABLE;
  gpio_config(&config);
}
bool BoardInput::main_pressed() const {
  return gpio_get_level(GPIO_NUM_38) == 0;
}
bool BoardInput::take_next_page(std::uint64_t now_ms) {
  if (!tbeam_power_key || now_ms < next_poll_)
    return false;
  next_poll_ = now_ms + 50;
  // AXP2101 INTSTS2 (0x49) bit 3: power-key short press. Writing 1 clears only that bit.
  const std::uint8_t reg = 0x49;
  std::uint8_t status = 0;
  if (i2c_master_transmit_receive(tbeam_pmu, &reg, 1, &status, 1, 40) != ESP_OK || !(status & 0x08))
    return false;
  const std::uint8_t clear[] = {0x49, 0x08};
  i2c_master_transmit(tbeam_pmu, clear, sizeof(clear), 40);
  return true;
}
