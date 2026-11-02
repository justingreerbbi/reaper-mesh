#include "radio_bus.hpp"
#include "driver/gpio.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <cstring>
extern bool tbeam_power_ready;
bool RadioBus::begin() {
  if (!tbeam_power_ready) return false;
  off();
  if (gpio_set_direction(GPIO_NUM_23, GPIO_MODE_OUTPUT) != ESP_OK ||
      gpio_set_direction(GPIO_NUM_26, GPIO_MODE_INPUT) != ESP_OK ||
      gpio_set_direction(GPIO_NUM_33, GPIO_MODE_INPUT) != ESP_OK) return false;
  spi_bus_config_t bus{};
  bus.mosi_io_num = 27; bus.miso_io_num = 19; bus.sclk_io_num = 5;
  bus.quadwp_io_num = bus.quadhd_io_num = -1; bus.max_transfer_sz = tx_.size();
  if (spi_bus_initialize(SPI2_HOST, &bus, SPI_DMA_CH_AUTO) != ESP_OK) return false;
  spi_device_interface_config_t device{};
  device.clock_speed_hz = 4000000; device.mode = 0; device.spics_io_num = 18; device.queue_size = 1;
  if (spi_bus_add_device(SPI2_HOST, &device, &device_) != ESP_OK) return false;
  std::size_t maximum = 0;
  // Non-DMA ESP32-S3 transactions are limited to 64 bytes, below a fragment.
  return spi_bus_get_max_transaction_len(SPI2_HOST, &maximum) == ESP_OK && maximum >= tx_.size();
}
bool RadioBus::ready(std::uint32_t timeout_ms) {
  if (!device_ || failed_) return false;
  (void)timeout_ms; // SX1276 has no BUSY line; SPI operations carry their own bound.
  return true;
}
bool RadioBus::transfer(const std::uint8_t* tx, std::uint8_t* rx, std::size_t size) {
  if (!device_ || failed_ || !tx || !rx || !size || size > tx_.size()) return false;
  last_command_ = tx[0];
  std::memcpy(tx_.data(), tx, size); rx_.fill(0); transaction_ = {};
  transaction_.length = size * 8; transaction_.tx_buffer = tx_.data(); transaction_.rx_buffer = rx_.data();
  if (spi_device_queue_trans(device_, &transaction_, pdMS_TO_TICKS(20)) != ESP_OK) { failed_ = true; off(); return false; }
  spi_transaction_t* completed = nullptr;
  if (spi_device_get_trans_result(device_, &completed, pdMS_TO_TICKS(20)) != ESP_OK || completed != &transaction_) {
    failed_ = true; off(); return false;
  }
  std::memcpy(rx, rx_.data(), size); return true;
}
bool RadioBus::reset() {
  if (!device_ || failed_) return false;
  gpio_set_level(GPIO_NUM_23, 0); vTaskDelay(pdMS_TO_TICKS(10));
  gpio_set_level(GPIO_NUM_23, 1); vTaskDelay(pdMS_TO_TICKS(20));
  return ready(20);
}
void RadioBus::off() { gpio_set_level(GPIO_NUM_23, 0); }
