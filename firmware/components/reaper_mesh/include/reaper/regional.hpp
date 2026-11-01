#pragma once
#include "reaper/radio_packet.hpp"
#include <cstdint>
namespace reaper::mesh {
struct RegionalProfile {
  std::uint32_t frequency_hz = 915000000;
  std::uint32_t bandwidth_hz = 500000;
  std::uint8_t spreading_factor = 7, coding_rate = 1, max_power_dbm = 10;
  std::uint16_t preamble = 8;
};
inline constexpr RegionalProfile kUs915Lab1{};
// Rounded up in microseconds, explicit header, CRC on, non-inverted IQ.
std::uint32_t airtime_us(std::size_t packet_bytes, const RegionalProfile& = kUs915Lab1);
// Project courtesy budget (1% replenishment, one-second burst), not a claim of
// regional compliance. Charge all original/relay/retry/ACK transmissions equally.
class AirtimeBudget {
 public:
  bool reserve(std::uint64_t now_ms, std::uint32_t airtime_us);
  std::uint32_t available(std::uint64_t now_ms);
 private:
  std::uint64_t time_ = 0;
  std::uint32_t tokens_ = 1000000;
  bool update(std::uint64_t now_ms);
};
} // namespace reaper::mesh
