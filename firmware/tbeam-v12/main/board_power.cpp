#include "board_power.hpp"
#include "driver/i2c_master.h"
// AXP2101 handle, set by status_display.cpp once the PMU is identified; null otherwise.
extern i2c_master_dev_handle_t tbeam_pmu;
Battery BoardPower::read(std::uint64_t now_ms) {
  if (!tbeam_pmu || now_ms < next_poll_)
    return last_;
  next_poll_ = now_ms + 2000;
  const auto get = [](std::uint8_t reg, std::uint8_t& value) {
    return i2c_master_transmit_receive(tbeam_pmu, &reg, 1, &value, 1, 40) == ESP_OK;
  };
  // Read-only. STATUS1 0x00 bit 5: VBUS good (plugged in); bit 3: battery present.
  // 0x18 bit 3: fuel gauge enabled. 0xA4: fuel-gauge percent.
  std::uint8_t status1 = 0, control = 0, percent = 0;
  last_ = {};
  if (!get(0x00, status1))
    return last_;
  last_.external = status1 & 0x20;
  if ((status1 & 0x08) && get(0x18, control) && (control & 0x08) && get(0xa4, percent) &&
      percent <= 100)
    last_.percent = percent;
  return last_;
}
