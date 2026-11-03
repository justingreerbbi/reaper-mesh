#pragma once
#include <cstddef>
#include <cstdint>
using esp_err_t = int;
inline constexpr int ESP_OK = 0, I2C_NUM_0 = 0, I2C_CLK_SRC_DEFAULT = 0, I2C_ADDR_BIT_LEN_7 = 0;
using i2c_master_bus_handle_t = void*;
using i2c_master_dev_handle_t = void*;
struct i2c_master_bus_config_t {
  int i2c_port{}, sda_io_num{}, scl_io_num{}, clk_source{}, glitch_ignore_cnt{};
  struct {
    bool enable_internal_pullup{};
  } flags;
};
struct i2c_device_config_t {
  int dev_addr_length{}, device_address{}, scl_speed_hz{};
};
esp_err_t i2c_new_master_bus(const i2c_master_bus_config_t*, i2c_master_bus_handle_t*);
esp_err_t i2c_master_bus_add_device(i2c_master_bus_handle_t, const i2c_device_config_t*,
                                    i2c_master_dev_handle_t*);
esp_err_t i2c_master_transmit(i2c_master_dev_handle_t, const std::uint8_t*, std::size_t, int);
