#include "status_display.hpp"
#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
void StatusDisplay::begin() {
  // Heltec V3 Vext is active-low. OLED: SDA17, SCL18, reset21, address0x3c.
  gpio_set_level(GPIO_NUM_36, 0);
  gpio_set_direction(GPIO_NUM_36, GPIO_MODE_OUTPUT);
  gpio_set_level(GPIO_NUM_21, 0);
  gpio_set_direction(GPIO_NUM_21, GPIO_MODE_OUTPUT);
  vTaskDelay(pdMS_TO_TICKS(20));
  gpio_set_level(GPIO_NUM_21, 1);
  vTaskDelay(pdMS_TO_TICKS(20));
  i2c_master_bus_config_t config{};
  config.i2c_port = I2C_NUM_0;
  config.sda_io_num = GPIO_NUM_17;
  config.scl_io_num = GPIO_NUM_18;
  config.clk_source = I2C_CLK_SRC_DEFAULT;
  config.glitch_ignore_cnt = 7;
  config.flags.enable_internal_pullup = true;
  if (i2c_new_master_bus(&config, &bus_) != ESP_OK)
    return;
  configure();
}
