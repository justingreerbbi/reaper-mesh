#include "board_power.hpp"
#include "driver/gpio.h"
#include "esp_adc/adc_oneshot.h"
#include "esp_adc/adc_cali.h"
#include "esp_adc/adc_cali_scheme.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <algorithm>

namespace {
adc_oneshot_unit_handle_t adc = nullptr;
adc_cali_handle_t calibration = nullptr;
bool initialize() {
  adc_oneshot_unit_init_cfg_t unit{};
  unit.unit_id = ADC_UNIT_1;
  if (adc_oneshot_new_unit(&unit, &adc) != ESP_OK)
    return false;
  adc_oneshot_chan_cfg_t channel{};
  channel.atten = ADC_ATTEN_DB_0;
  channel.bitwidth = ADC_BITWIDTH_DEFAULT;
  adc_cali_curve_fitting_config_t cal{};
  cal.unit_id = ADC_UNIT_1;
  cal.chan = ADC_CHANNEL_0;  // GPIO1, not the radio's SPI pins.
  cal.atten = channel.atten;
  cal.bitwidth = channel.bitwidth;
  return adc_oneshot_config_channel(adc, ADC_CHANNEL_0, &channel) == ESP_OK &&
         adc_cali_create_scheme_curve_fitting(&cal, &calibration) == ESP_OK &&
         gpio_set_level(GPIO_NUM_37, 0) == ESP_OK &&
         gpio_set_direction(GPIO_NUM_37, GPIO_MODE_OUTPUT) == ESP_OK;
}
int measure(int level) {
  if (gpio_set_level(GPIO_NUM_37, level) != ESP_OK)
    return -1;
  vTaskDelay(pdMS_TO_TICKS(10));  // Let the switched divider settle.
  int sum = 0;
  for (int i = 0; i < 16; ++i) {
    int raw = 0;
    if (adc_oneshot_read(adc, ADC_CHANNEL_0, &raw) != ESP_OK)
      return -1;
    sum += raw;
  }
  int mv = 0;
  if (adc_cali_raw_to_voltage(calibration, (sum + 8) / 16, &mv) != ESP_OK)
    return -1;
  return (mv * 49 + 5) / 10;  // 390k / 100k divider: VBAT = ADC * 4.9.
}
}  // namespace
Battery BoardPower::read(std::uint64_t now_ms) {
  if (now_ms < next_poll_)
    return last_;
  next_poll_ = now_ms + 2000;
  last_ = {};
  last_.millivolts = -1;
  static const bool ready = initialize();
  if (!ready)
    return last_;
  // V3.1 and V3.2 use opposite ADC gate polarities. Both levels are safe; the disabled
  // divider reads near zero. Measure both, then leave the divider disabled between polls.
  const int low = measure(0), high = measure(1);
  gpio_set_level(GPIO_NUM_37, low > high ? 1 : 0);
  if (low < 0 || high < 0)
    return last_;
  const int mv = std::max(low, high);
  if (mv >= 2500 && mv <= 4500)
    last_.millivolts = mv;
  // There is no fuel gauge, battery-presence or USB-sense input. Do not invent these.
  return last_;
}
