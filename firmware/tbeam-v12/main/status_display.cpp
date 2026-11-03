#include "status_display.hpp"
#include "reaper/version.hpp"
#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <cstdio>
bool tbeam_power_ready = false;
namespace {
// Original 3x5 uppercase bitmap alphabet: each octal digit is one three-pixel row.
constexpr std::uint16_t glyphs[] = {
    075557, 026227, 071747, 071717, 055711, 074717, 074757, 071111, 075757, 075717, 025755, 065656,
    034443, 065556, 074646, 074644, 034553, 055755, 072227, 011152, 055655, 044447, 057555, 075555,
    025552, 065644, 025573, 065655, 034217, 072222, 055557, 055552, 055575, 055255, 055222, 071247};
std::uint16_t glyph(char c) {
  if (c >= '0' && c <= '9')
    return glyphs[c - '0'];
  if (c >= 'A' && c <= 'Z')
    return glyphs[10 + c - 'A'];
  return 0;
}
}  // namespace
bool StatusDisplay::send(const std::uint8_t* bytes, std::size_t size) {
  // One bounded synchronous transfer. Any fault disables further display work.
  if (i2c_master_transmit(device_, bytes, size, 40) == ESP_OK)
    return true;
  ready_ = false;
  return false;
}
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
  vTaskDelay(pdMS_TO_TICKS(20));
  i2c_device_config_t device{};
  device.dev_addr_length = I2C_ADDR_BIT_LEN_7;
  device.device_address = 0x3c;
  device.scl_speed_hz = 400000;
  if (i2c_master_bus_add_device(bus_, &device, &device_) != ESP_OK)
    return;
  // SSD1306 command stream: display off, geometry/timing, charge pump, horizontal addressing.
  const std::uint8_t init[] = {0x00, 0xae, 0xd5, 0x80, 0xa8, 0x3f, 0xd3, 0x00, 0x40,
                               0x8d, 0x14, 0x20, 0x00, 0xa1, 0xc8, 0xda, 0x12, 0x81,
                               0x7f, 0xd9, 0xf1, 0xdb, 0x40, 0xa4, 0xa6, 0xaf};
  ready_ = send(init, sizeof(init));
  previous_.fill(0xff);
}
void StatusDisplay::text(unsigned row, const char* value) {
  for (unsigned column = 0; column < 16 && value[column]; ++column) {
    auto bits = glyph(value[column]);
    for (unsigned y = 0; y < 5; ++y)
      for (unsigned x = 0; x < 3; ++x) {
        if (!(bits & (1u << ((4 - y) * 3 + 2 - x))))
          continue;
        for (unsigned dy = 0; dy < 2; ++dy)
          for (unsigned dx = 0; dx < 2; ++dx) {
            unsigned px = column * 8 + x * 2 + dx, py = row * 12 + y * 2 + dy;
            pixels_[1 + (py / 8) * 128 + px] |= 1u << (py % 8);
          }
      }
  }
}
void StatusDisplay::update(const char* usb, bool healthy, std::uint32_t revision,
                           const char* radio) {
  if (!ready_)
    return;
  pixels_.fill(0);
  pixels_[0] = 0x40;
  text(0, reaper::device::kDisplayVersion);
  text(1, healthy ? usb : "USB BLOCKED");
  char line[17]{};
  if (healthy)
    std::snprintf(line, sizeof(line), "REV %lu", static_cast<unsigned long>(revision));
  else
    std::snprintf(line, sizeof(line), "REV UNKNOWN");
  text(2, line);
  text(3, healthy ? "STORE OK" : "STORE FAULT");
  text(4, radio);
  if (pixels_ == previous_)
    return;
  const std::uint8_t area[] = {0x00, 0x21, 0, 127, 0x22, 0, 7};
  if (send(area, sizeof(area)) && send(pixels_.data(), pixels_.size()))
    previous_ = pixels_;
}
