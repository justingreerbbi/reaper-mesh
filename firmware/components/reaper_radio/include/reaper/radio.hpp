#pragma once
#include "reaper/regional.hpp"
#include <array>
#include <cstddef>
#include <cstdint>
namespace reaper::radio {
// Each operation must return within its bound, or permanently fail until reset.
struct Bus {
  virtual ~Bus() = default;
  virtual bool ready(std::uint32_t timeout_ms) = 0;
  virtual bool transfer(const std::uint8_t* tx, std::uint8_t* rx, std::size_t size) = 0;
  virtual bool reset() = 0;
  virtual void off() = 0;
};
enum class Start { Started, Wait, Rejected, Fault };
struct Event {
  bool received = false, tx_done = false, tx_success = false;
  std::size_t size = 0;
  std::array<std::uint8_t, mesh::kMaxPacketBytes> bytes{};
};
class Radio {
 public:
  explicit Radio(Bus& bus) : bus_(bus) {}
  bool configure(std::uint8_t power, bool receive, bool transmit);
  void stop();
  Start transmit(const std::uint8_t*, std::size_t, std::uint64_t now_ms);
  Event poll(std::uint64_t now_ms);
  bool healthy() const { return healthy_; }
  bool transmitting() const { return transmitting_; }
  bool receiving() const { return receive_; }
 private:
  Bus& bus_; mesh::AirtimeBudget budget_{};
  bool healthy_ = false, receive_ = false, allow_tx_ = false, transmitting_ = false;
  std::uint64_t deadline_ = 0;
  bool check(int status);
  bool listen();
};
} // namespace reaper::radio
