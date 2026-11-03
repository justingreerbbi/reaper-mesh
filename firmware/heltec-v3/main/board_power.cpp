#include "board_power.hpp"
// The Heltec V3 battery voltage input is not verified on hardware yet, and it has no USB power
// sense signal, so both are reported as unknown.
Battery BoardPower::read(std::uint64_t) {
  return {};
}
