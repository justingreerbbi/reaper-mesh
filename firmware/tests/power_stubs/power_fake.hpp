#pragma once
#include <cstdint>
inline constexpr int ESP_OK = 0, GPIO_NUM_37 = 37, GPIO_MODE_OUTPUT = 1;
inline constexpr int ADC_UNIT_1 = 1, ADC_CHANNEL_0 = 0, ADC_ATTEN_DB_0 = 0,
                     ADC_BITWIDTH_DEFAULT = 12;
using adc_oneshot_unit_handle_t = void*;
using adc_cali_handle_t = void*;
struct adc_oneshot_unit_init_cfg_t {
  int unit_id{};
};
struct adc_oneshot_chan_cfg_t {
  int atten{}, bitwidth{};
};
struct adc_cali_curve_fitting_config_t {
  int unit_id{}, chan{}, atten{}, bitwidth{};
};
namespace fake {
inline bool initialize_ok = true, calibration_ok = true, sample_ok = true;
inline int enabled = 0, level = 0, voltage = 830, reads = 0;
}  // namespace fake
inline int gpio_set_level(int pin, int value) {
  if (pin != 37)
    return -1;
  fake::level = value;
  return ESP_OK;
}
inline int gpio_set_direction(int pin, int mode) {
  return pin == 37 && mode == GPIO_MODE_OUTPUT ? ESP_OK : -1;
}
inline int adc_oneshot_new_unit(const adc_oneshot_unit_init_cfg_t* cfg, void** handle) {
  *handle = reinterpret_cast<void*>(1);
  return fake::initialize_ok && cfg->unit_id == ADC_UNIT_1 ? ESP_OK : -1;
}
inline int adc_oneshot_config_channel(void*, int channel, const adc_oneshot_chan_cfg_t* cfg) {
  return channel == 0 && cfg->atten == ADC_ATTEN_DB_0 ? ESP_OK : -1;
}
inline int adc_cali_create_scheme_curve_fitting(const adc_cali_curve_fitting_config_t*,
                                                void** handle) {
  *handle = reinterpret_cast<void*>(2);
  return fake::calibration_ok ? ESP_OK : -1;
}
inline int adc_oneshot_read(void*, int channel, int* raw) {
  ++fake::reads;
  *raw = fake::level == fake::enabled ? fake::voltage : 0;
  return fake::sample_ok && channel == 0 ? ESP_OK : -1;
}
inline int adc_cali_raw_to_voltage(void*, int raw, int* mv) {
  *mv = raw;
  return ESP_OK;
}
inline void vTaskDelay(int) {}
#define pdMS_TO_TICKS(value) (value)
