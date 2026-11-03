#include "status_display.hpp"
#include <iostream>
#include <vector>
#include <string>
#include <cstdlib>
#define CHECK(value)                                              \
  do {                                                            \
    if (!(value)) {                                               \
      std::cerr << "line " << __LINE__ << ": " << #value << '\n'; \
      std::exit(1);                                               \
    }                                                             \
  } while (false)
static bool fail_bus = false, fail_tx = false;
static std::vector<std::vector<std::uint8_t>> writes;
esp_err_t i2c_new_master_bus(const i2c_master_bus_config_t* c, i2c_master_bus_handle_t* out) {
  CHECK(c->sda_io_num == 17 && c->scl_io_num == 18);
  *out = reinterpret_cast<void*>(1);
  return fail_bus ? -1 : 0;
}
esp_err_t i2c_master_bus_add_device(i2c_master_bus_handle_t, const i2c_device_config_t* c,
                                    i2c_master_dev_handle_t* out) {
  CHECK(c->device_address == 0x3c && c->scl_speed_hz == 400000);
  *out = reinterpret_cast<void*>(2);
  return 0;
}
esp_err_t i2c_master_transmit(i2c_master_dev_handle_t, const std::uint8_t* bytes, std::size_t size,
                              int timeout) {
  CHECK(timeout == 40);
  writes.emplace_back(bytes, bytes + size);
  return fail_tx ? -1 : 0;
}
int main(int argc, char** argv) {
  if (argc != 2)
    return 2;
  const std::string scenario = argv[1];
  StatusDisplay display;
  reaper::ui::Frame a{}, b{};
  a[0] = 1;
  b[1023] = 0x80;
  if (scenario == "init-failure") {
    fail_bus = true;
    display.begin();
    display.show(a);
    display.power(false);
    CHECK(writes.empty() && !display.ready());
  } else {
    display.begin();
    CHECK(writes.size() == 1 && display.ready());
    display.show(a);
    CHECK(writes.size() == 3);
    CHECK(writes.back().size() == 1025 && writes.back()[0] == 0x40 && writes.back()[1] == 1);
    if (scenario == "updates") {
      display.show(a);
      CHECK(writes.size() == 3);  // unchanged frames are not sent
      display.show(b);
      CHECK(writes.size() == 5 && writes.back()[1024] == 0x80);
    } else if (scenario == "power") {
      display.power(false);
      CHECK(writes.size() == 4);
      CHECK((writes.back() == std::vector<std::uint8_t>{0x00, 0xae, 0x8d, 0x10}));
      display.power(false);
      display.show(b);
      CHECK(writes.size() == 4);  // nothing is drawn while the panel is off
      display.power(true);
      CHECK(writes.size() == 5);
      CHECK((writes.back() == std::vector<std::uint8_t>{0x00, 0x8d, 0x14, 0xaf}));
      display.show(b);
      CHECK(writes.size() == 7);
    } else if (scenario == "tx-failure") {
      fail_tx = true;
      display.show(b);
      CHECK(writes.size() == 4 && !display.ready());
      fail_tx = false;
      display.show(a);
      display.power(false);
      CHECK(writes.size() == 4);
    } else
      return 3;
  }
  std::cout << "ok " << scenario << '\n';
}
