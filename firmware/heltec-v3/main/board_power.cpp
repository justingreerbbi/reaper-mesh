#include "board_power.hpp"
// The Heltec V3 battery voltage input is not verified on hardware yet, and it has no charge
// status signal, so the battery is reported as unknown.
Battery BoardPower::read(std::uint64_t) {
  return {};
}
