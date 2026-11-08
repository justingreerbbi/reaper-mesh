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
#ifdef REAPER_DISPLAY_64X32
// 0.49-inch panel: 32-row multiplex; columns 32-95, pages 0-3 of the frame's top-left corner.
constexpr std::size_t kFrameWrite = 1 + 64 * 4;
constexpr std::uint8_t kMultiplex = 0x1f;
const std::vector<std::uint8_t> kArea{0x00, 0x21, 32, 95, 0x22, 0, 3};
#else
constexpr std::size_t kFrameWrite = 1 + 128 * 8;
constexpr std::uint8_t kMultiplex = 0x3f;
const std::vector<std::uint8_t> kArea{0x00, 0x21, 0, 127, 0x22, 0, 7};
#endif
int main(int argc, char** argv) {
  if (argc != 2)
    return 2;
  const std::string scenario = argv[1];
  StatusDisplay display;
  reaper::ui::Frame a{}, b{};
  a[0] = 1;
  b[1] = 0x80;  // inside both geometries: column 1, page 0
  if (scenario == "init-failure") {
    fail_bus = true;
    display.begin();
    display.show(a);
    display.power(false);
    CHECK(writes.empty() && !display.ready());
  } else {
    display.begin();
    CHECK(writes.size() == 1 && display.ready());
    CHECK(writes[0].size() > 5 && writes[0][4] == 0xa8 && writes[0][5] == kMultiplex);
    display.show(a);
    CHECK(writes.size() == 3 && writes[1] == kArea);
    CHECK(writes.back().size() == kFrameWrite && writes.back()[0] == 0x40 && writes.back()[1] == 1);
    if (scenario == "updates") {
      display.show(a);
      CHECK(writes.size() == 3);  // unchanged frames are not sent
      display.show(b);
      CHECK(writes.size() == 5 && writes.back()[2] == 0x80);
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
