#pragma once
#include "reaper/radio.hpp"
namespace reaper::radio {
// How a board wires the LR1110: the TCXO supply the chip drives on DIO3, and the RFSW0-RFSW3
// outputs (DIO5-DIO8) it sets for each mode to steer its RF switch. Board profiles fill this in.
struct Lr1110Wiring {
  std::uint8_t tcxo_supply = 0;          // lr11xx_system_tcxo_supply_voltage_t
  std::uint32_t tcxo_startup_steps = 0;  // 30.52 µs steps
  std::uint8_t switch_enable = 0;        // RFSW outputs the chip drives at all
  std::uint8_t switch_standby = 0, switch_rx = 0, switch_tx = 0, switch_tx_hp = 0;
  std::uint8_t switch_tx_hf = 0, switch_gnss = 0, switch_wifi = 0;
};
// Wraps Semtech's pinned LR11xx driver with the same Reaper modem and profile as the SX1262, so
// LR1110 and SX126x boards hear each other. Uses the high-power PA, like the SX1262.
class Lr1110 {
 public:
  Lr1110(Bus& bus, const Lr1110Wiring& wiring) : bus_(bus), wiring_(wiring) {}
  // High-power PA: -9 to +22 dBm, with no boost mode.
  static constexpr bool kHasBoost = false;
  // Oldest LR1110 firmware that can set a custom LoRa sync word.
  static constexpr std::uint16_t kMinFirmware = 0x0303;
  static constexpr int dbm(mesh::TxLevel level, bool = false) {
    return mesh::tx_level_dbm(level, -9, 22);
  }
  static_assert(22 <= mesh::kUs915Lab1.max_power_dbm);
  bool configure(mesh::TxLevel level, bool boost, bool receive, bool transmit);
  void stop();
  Start transmit(const std::uint8_t*, std::size_t, std::uint64_t now_ms);
  Event poll(std::uint64_t now_ms);
  bool healthy() const { return healthy_; }
  bool transmitting() const { return transmitting_; }
  bool receiving() const { return receive_; }
  // For the probe fault reason: chip type (1 is the LR1110), last command status, error flags.
  std::uint8_t chip_mode() const { return chip_type_; }
  std::uint8_t command_status() const { return command_status_; }
  std::uint16_t device_errors() const { return errors_; }
  std::uint16_t firmware() const { return firmware_; }

 private:
  Bus& bus_;
  Lr1110Wiring wiring_;
  mesh::AirtimeBudget budget_{};
  bool healthy_ = false, receive_ = false, allow_tx_ = false, transmitting_ = false;
  std::uint8_t chip_type_ = 0, command_status_ = 0;
  std::uint16_t errors_ = 0, firmware_ = 0;
  std::uint64_t deadline_ = 0;
  bool check(int status);
  bool listen();
};
}  // namespace reaper::radio
