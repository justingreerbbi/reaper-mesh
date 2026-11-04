#include "board_power.hpp"
#include "power_fake.hpp"
#include <iostream>
#include <string>
#define CHECK(v)                                              \
  do {                                                        \
    if (!(v)) {                                               \
      std::cerr << "line " << __LINE__ << ": " << #v << '\n'; \
      return 1;                                               \
    }                                                         \
  } while (false)
int main(int argc, char** argv) {
  if (argc != 2)
    return 2;
  const std::string scenario = argv[1];
  BoardPower board;
  if (scenario == "low" || scenario == "high") {
    fake::enabled = scenario == "high";
    const auto battery = board.read(0);
    CHECK(battery.millivolts == 4067 && battery.percent == -1 && !battery.external);
    CHECK(fake::reads == 32 && fake::level != fake::enabled);
    CHECK(board.read(1999).millivolts == 4067 && fake::reads == 32);
    fake::voltage = 800;
    CHECK(board.read(2000).millivolts == 3920 && fake::reads == 64);
    fake::sample_ok = false;
    CHECK(board.read(4000).millivolts == -1);
  } else if (scenario == "init") {
    fake::initialize_ok = false;
    CHECK(board.read(0).millivolts == -1 && fake::reads == 0);
  } else if (scenario == "calibration") {
    fake::calibration_ok = false;
    CHECK(board.read(0).millivolts == -1 && fake::reads == 0);
  } else if (scenario == "bounds") {
    std::uint64_t now = 0;
    for (const int voltage : {0, 100, 500, 920, 1000}) {
      fake::voltage = voltage;
      const auto battery = board.read(now);
      CHECK(battery.millivolts == -1 && battery.percent == -1 && !battery.external);
      now += 2000;
    }
  } else
    return 3;
  std::cout << "ok " << scenario << '\n';
}
