#include "status_display.hpp"
#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
bool tbeam_power_ready = false;
// AXP2101 handle once the PMU is identified (board_power.cpp reads battery state), and whether
// the power-key interrupt is enabled (board_input.cpp polls it).
i2c_master_dev_handle_t tbeam_pmu = nullptr;
bool tbeam_power_key = false;
void StatusDisplay::begin() {
  i2c_master_bus_config_t config{};
  config.i2c_port = I2C_NUM_0;
  config.sda_io_num = GPIO_NUM_21;
  config.scl_io_num = GPIO_NUM_22;
  config.clk_source = I2C_CLK_SRC_DEFAULT;
  config.glitch_ignore_cnt = 7;
  config.flags.enable_internal_pullup = true;
  if (i2c_new_master_bus(&config, &bus_) != ESP_OK)
    return;
  // V1.2 AXP2101: confirm ID; touch only the radio ALDO2 rail, not CPU/charging.
  i2c_device_config_t power{};
  power.dev_addr_length = I2C_ADDR_BIT_LEN_7;
  power.device_address = 0x34;
  power.scl_speed_hz = 100000;
  i2c_master_dev_handle_t pmu = nullptr;
  if (i2c_master_bus_add_device(bus_, &power, &pmu) != ESP_OK)
    return;
  const auto read = [&](std::uint8_t reg, std::uint8_t& value) {
    return i2c_master_transmit_receive(pmu, &reg, 1, &value, 1, 40) == ESP_OK;
  };
  const auto write = [&](std::uint8_t reg, std::uint8_t value) {
    const std::uint8_t bytes[] = {reg, value};
    return i2c_master_transmit(pmu, bytes, 2, 40) == ESP_OK;
  };
  std::uint8_t id = 0, voltage = 0, enabled = 0;
  if (!read(0x03, id) || id != 0x4a || !read(0x93, voltage) || !read(0x90, enabled) ||
      !write(0x93, (voltage & 0xe0) | 28) || !write(0x90, enabled | 2))
    return;
  std::uint8_t verified_voltage = 0, verified_enabled = 0;
  if (!read(0x93, verified_voltage) || (verified_voltage & 0x1f) != 28 ||
      !read(0x90, verified_enabled) || !(verified_enabled & 2))
    return;
  tbeam_power_ready = true;
  tbeam_pmu = pmu;
  // Power-key short press interrupt (INTEN2 0x41 bit 3) for the PWR page shortcut. Only that
  // bit changes; a stale status (INTSTS2 0x49 bit 3) is cleared by writing 1 to it.
  std::uint8_t irq = 0;
  if (read(0x41, irq) && write(0x41, irq | 0x08) && read(0x41, irq) && (irq & 0x08) &&
      write(0x49, 0x08))
    tbeam_power_key = true;
  vTaskDelay(pdMS_TO_TICKS(20));
  configure();
}
