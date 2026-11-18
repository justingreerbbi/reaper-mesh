// The T1000-E's button, LED and battery reading, behind the shared board interfaces in app/.
#include "board_input.hpp"
#include "board_led.hpp"
#include "board_power.hpp"
#include <zephyr/drivers/adc.h>
#include <zephyr/drivers/gpio.h>
namespace {
const gpio_dt_spec button = GPIO_DT_SPEC_GET(DT_ALIAS(sw0), gpios);
const gpio_dt_spec led = GPIO_DT_SPEC_GET(DT_ALIAS(led0), gpios);
const gpio_dt_spec external = GPIO_DT_SPEC_GET(DT_PATH(zephyr_user), external_power_gpios);
const adc_dt_spec battery = ADC_DT_SPEC_GET(DT_PATH(zephyr_user));
bool button_ok = false, led_ok = false, power_ok = false, adc_ok = false;
}  // namespace

void BoardInput::begin() {
  button_ok = gpio_is_ready_dt(&button) && gpio_pin_configure_dt(&button, GPIO_INPUT) == 0;
}
bool BoardInput::main_pressed() const {
  return button_ok && gpio_pin_get_dt(&button) == 1;
}
// One button, so every screen function is a gesture on it.
bool BoardInput::take_next_page(std::uint64_t) {
  return false;
}

void BoardLed::begin() {
  led_ok = gpio_is_ready_dt(&led) && gpio_pin_configure_dt(&led, GPIO_OUTPUT_INACTIVE) == 0;
}
void BoardLed::set(bool on) {
  if (led_ok && on != on_ && gpio_pin_set_dt(&led, on ? 1 : 0) == 0)
    on_ = on;
}

// Voltage only: the T1000-E has no fuel gauge, so no percentage is invented (see AI.md). The
// battery reaches AIN0 through a 2:1 divider.
Battery BoardPower::read(std::uint64_t now) {
  if (now < next_poll_)
    return last_;
  next_poll_ = now + 2000;
  if (!power_ok) {
    power_ok = true;
    adc_ok = adc_is_ready_dt(&battery) && adc_channel_setup_dt(&battery) == 0;
    if (gpio_is_ready_dt(&external))
      gpio_pin_configure_dt(&external, GPIO_INPUT);
  }
  last_.external = gpio_is_ready_dt(&external) && gpio_pin_get_dt(&external) == 1;
  last_.millivolts = -1;
  std::int16_t sample = 0;
  adc_sequence sequence{};
  sequence.buffer = &sample;
  sequence.buffer_size = sizeof(sample);
  if (adc_ok && adc_sequence_init_dt(&battery, &sequence) == 0 &&
      adc_read_dt(&battery, &sequence) == 0) {
    std::int32_t millivolts = sample < 0 ? 0 : sample;
    if (adc_raw_to_millivolts_dt(&battery, &millivolts) == 0 && millivolts > 0)
      last_.millivolts = static_cast<int>(millivolts * 2);
  }
  return last_;
}
