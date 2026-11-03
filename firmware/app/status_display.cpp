#include "status_display.hpp"
#include <algorithm>
bool StatusDisplay::send(const std::uint8_t* bytes, std::size_t size) {
  // One bounded synchronous transfer. Any fault disables further display work.
  if (i2c_master_transmit(device_, bytes, size, 40) == ESP_OK)
    return true;
  ready_ = false;
  return false;
}
void StatusDisplay::configure() {
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
  on_ = true;
  drawn_ = false;
}
void StatusDisplay::power(bool on) {
  if (!ready_ || on == on_)
    return;
  // Charge pump on, then display on; display off, then charge pump off.
  const std::uint8_t wake[] = {0x00, 0x8d, 0x14, 0xaf};
  const std::uint8_t sleep[] = {0x00, 0xae, 0x8d, 0x10};
  if (send(on ? wake : sleep, 4))
    on_ = on;
}
void StatusDisplay::show(const reaper::ui::Frame& frame) {
  if (!ready_ || !on_ || (drawn_ && frame == previous_))
    return;
  buffer_[0] = 0x40;
  std::copy(frame.begin(), frame.end(), buffer_.begin() + 1);
  const std::uint8_t area[] = {0x00, 0x21, 0, 127, 0x22, 0, 7};
  drawn_ = send(area, sizeof(area)) && send(buffer_.data(), buffer_.size());
  if (drawn_)
    previous_ = frame;
}
