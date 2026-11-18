#include "t1000e_radio_bus.hpp"
#include <zephyr/drivers/gpio.h>
#include <zephyr/drivers/spi.h>
#include <zephyr/kernel.h>
namespace {
#define LR1110 DT_NODELABEL(lr1110)
const spi_dt_spec spi = SPI_DT_SPEC_GET(LR1110, SPI_OP_MODE_CONTROLLER | SPI_WORD_SET(8));
const gpio_dt_spec reset_pin = GPIO_DT_SPEC_GET(LR1110, reset_gpios);
const gpio_dt_spec busy_pin = GPIO_DT_SPEC_GET(LR1110, busy_gpios);
// After reset the LR1110 boots from its own flash before BUSY falls.
constexpr std::uint32_t kBootMs = 500;
}  // namespace
bool RadioBus::begin() {
  started_ = spi_is_ready_dt(&spi) && gpio_is_ready_dt(&reset_pin) && gpio_is_ready_dt(&busy_pin) &&
             gpio_pin_configure_dt(&reset_pin, GPIO_OUTPUT_INACTIVE) == 0 &&
             gpio_pin_configure_dt(&busy_pin, GPIO_INPUT) == 0;
  failed_ = !started_;
  return started_;
}
bool RadioBus::ready(std::uint32_t timeout_ms) {
  if (failed_)
    return false;
  const auto deadline = k_uptime_get() + timeout_ms;
  while (gpio_pin_get_dt(&busy_pin) == 1) {
    if (k_uptime_get() >= deadline) {
      failed_ = true;
      return false;
    }
    k_busy_wait(50);
  }
  return true;
}
bool RadioBus::transfer(const std::uint8_t* tx, std::uint8_t* rx, std::size_t size) {
  if (failed_ || !size)
    return false;
  last_command_ = tx[0] ? tx[0] : tx[size > 1 ? 1 : 0];
  const spi_buf tx_buf{const_cast<std::uint8_t*>(tx), size};
  const spi_buf rx_buf{rx, size};
  const spi_buf_set tx_set{&tx_buf, 1};
  const spi_buf_set rx_set{&rx_buf, 1};
  if (spi_transceive_dt(&spi, &tx_set, &rx_set) != 0) {
    failed_ = true;
    return false;
  }
  return true;
}
bool RadioBus::reset() {
  if (!started_)
    return false;
  failed_ = false;
  if (gpio_pin_set_dt(&reset_pin, 1) != 0)
    return failed_ = true, false;
  k_busy_wait(1000);
  if (gpio_pin_set_dt(&reset_pin, 0) != 0)
    return failed_ = true, false;
  k_msleep(1);
  return ready(kBootMs);
}
// Holds the chip in reset, so it neither receives nor transmits.
void RadioBus::off() {
  if (started_)
    gpio_pin_set_dt(&reset_pin, 1);
}
