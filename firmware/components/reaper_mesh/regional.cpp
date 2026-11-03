#include "reaper/regional.hpp"
namespace reaper::mesh {
std::uint32_t airtime_us(std::size_t size, const RegionalProfile& p) {
  if (!size || size > kMaxPacketBytes || p.spreading_factor < 7 || p.spreading_factor > 12 ||
      (p.bandwidth_hz != 125000 && p.bandwidth_hz != 250000 && p.bandwidth_hz != 500000) ||
      p.coding_rate < 1 || p.coding_rate > 4 || p.preamble < 6 || p.preamble > 65500)
    return 0;
  const auto sf = p.spreading_factor;
  const bool low_rate = (std::uint64_t(1) << sf) * 1000000 / p.bandwidth_hz >= 16000;
  const int numerator = static_cast<int>(8 * size) - 4 * sf + 28 + 16;
  const int denominator = 4 * (sf - (low_rate ? 2 : 0));
  const auto symbols =
      8 + (numerator > 0 ? (numerator + denominator - 1) / denominator * (p.coding_rate + 4) : 0);
  const std::uint64_t quarter_symbols = 4 * (p.preamble + symbols) + 17;
  const std::uint64_t numerator_us = quarter_symbols * (std::uint64_t(1) << sf) * 1000000;
  const auto denominator_us = std::uint64_t(4) * p.bandwidth_hz;
  return static_cast<std::uint32_t>((numerator_us + denominator_us - 1) / denominator_us);
}
bool AirtimeBudget::update(std::uint64_t now) {
  if (now < time_)
    return false;
  const auto elapsed = now - time_;
  time_ = now;
  if (elapsed >= 100000 || elapsed * 10 >= 1000000 - tokens_)
    tokens_ = 1000000;
  else
    tokens_ += elapsed * 10;
  return true;
}
bool AirtimeBudget::reserve(std::uint64_t now, std::uint32_t cost) {
  if (!update(now) || !cost || cost > tokens_)
    return false;
  tokens_ -= cost;
  return true;
}
std::uint32_t AirtimeBudget::available(std::uint64_t now) {
  return update(now) ? tokens_ : 0;
}
}  // namespace reaper::mesh
