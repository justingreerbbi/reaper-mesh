#include "reaper/lr1110.hpp"
#include "lr11xx_radio.h"
#include "lr11xx_regmem.h"
#include "lr11xx_system.h"
namespace reaper::radio {
namespace {
lr11xx_radio_pkt_params_lora_t packet(std::uint8_t size) {
  return {8, LR11XX_RADIO_LORA_PKT_EXPLICIT, size, LR11XX_RADIO_LORA_CRC_ON,
          LR11XX_RADIO_LORA_IQ_STANDARD};
}
// Never returns: continuous receive.
constexpr std::uint32_t kRxContinuous = 0xffffff;
constexpr lr11xx_system_irq_mask_t kIrq =
    LR11XX_SYSTEM_IRQ_TX_DONE | LR11XX_SYSTEM_IRQ_RX_DONE | LR11XX_SYSTEM_IRQ_CRC_ERROR |
    LR11XX_SYSTEM_IRQ_HEADER_ERROR | LR11XX_SYSTEM_IRQ_TIMEOUT;
}  // namespace
bool Lr1110::check(int status) {
  if (status == LR11XX_STATUS_OK)
    return true;
  stop();
  return false;
}
void Lr1110::stop() {
  bus_.off();
  healthy_ = receive_ = allow_tx_ = transmitting_ = false;
}
bool Lr1110::listen() {
  const auto params = packet(mesh::kMaxPacketBytes);
  return check(lr11xx_radio_set_lora_pkt_params(&bus_, &params)) &&
         check(lr11xx_radio_set_rx_with_timeout_in_rtc_step(&bus_, kRxContinuous));
}
bool Lr1110::configure(mesh::TxLevel level, bool boost, bool receive, bool transmit) {
  healthy_ = receive_ = allow_tx_ = transmitting_ = false;
  if (boost || level > mesh::TxLevel::High) {
    stop();
    return false;
  }
  lr11xx_system_version_t version{};
  if (!check(lr11xx_system_reset(&bus_)) || !check(lr11xx_system_get_version(&bus_, &version)))
    return false;
  chip_type_ = version.type;
  firmware_ = version.fw;
  // Setting the 0x52 sync word needs chip firmware 0x0303 or later. Older chips only offer the two
  // LoRaWAN sync words, which would leave this board unable to hear the others.
  if (version.type != LR11XX_SYSTEM_VERSION_TYPE_LR1110 || version.fw < kMinFirmware) {
    stop();
    return false;
  }
  const lr11xx_system_rfswitch_cfg_t rf_switch{
      wiring_.switch_enable, wiring_.switch_standby, wiring_.switch_rx,   wiring_.switch_tx,
      wiring_.switch_tx_hp,  wiring_.switch_tx_hf,   wiring_.switch_gnss, wiring_.switch_wifi};
  // The TCXO must run before calibration, so errors are cleared and read only afterwards. A wrong
  // TCXO supply shows up here as HF_XOSC_START, and the radio stays off.
  lr11xx_system_errors_t errors = 0;
  if (!check(lr11xx_system_set_reg_mode(&bus_, LR11XX_SYSTEM_REG_MODE_DCDC)) ||
      !check(lr11xx_system_set_dio_as_rf_switch(&bus_, &rf_switch)) ||
      !check(lr11xx_system_set_tcxo_mode(
          &bus_, static_cast<lr11xx_system_tcxo_supply_voltage_t>(wiring_.tcxo_supply),
          wiring_.tcxo_startup_steps)) ||
      !check(lr11xx_system_clear_errors(&bus_)) ||
      !check(lr11xx_system_calibrate(
          &bus_, LR11XX_SYSTEM_CALIB_LF_RC_MASK | LR11XX_SYSTEM_CALIB_HF_RC_MASK |
                     LR11XX_SYSTEM_CALIB_PLL_MASK | LR11XX_SYSTEM_CALIB_ADC_MASK |
                     LR11XX_SYSTEM_CALIB_IMG_MASK | LR11XX_SYSTEM_CALIB_PLL_TX_MASK)) ||
      !check(lr11xx_system_calibrate_image_in_mhz(&bus_, 902, 928)) ||
      !check(lr11xx_system_get_errors(&bus_, &errors)))
    return false;
  errors_ = errors;
  if (errors) {
    stop();
    return false;
  }
  lr11xx_system_stat1_t stat1{};
  lr11xx_system_stat2_t stat2{};
  if (!check(lr11xx_system_get_status(&bus_, &stat1, &stat2, nullptr)))
    return false;
  command_status_ = stat1.command_status;
  if (stat2.chip_mode != LR11XX_SYSTEM_CHIP_MODE_STBY_RC ||
      stat1.command_status == LR11XX_SYSTEM_CMD_STATUS_FAIL ||
      stat1.command_status == LR11XX_SYSTEM_CMD_STATUS_PERR) {
    stop();
    return false;
  }
  const lr11xx_radio_mod_params_lora_t modulation{LR11XX_RADIO_LORA_SF7, LR11XX_RADIO_LORA_BW_500,
                                                  LR11XX_RADIO_LORA_CR_4_5, 0};
  const auto params = packet(mesh::kMaxPacketBytes);
  // Semtech's recommended high-power PA setting for +22 dBm; lower levels only lower the power.
  const lr11xx_radio_pa_cfg_t pa{LR11XX_RADIO_PA_SEL_HP, LR11XX_RADIO_PA_REG_SUPPLY_VBAT, 0x04,
                                 0x07};
  if (!check(lr11xx_radio_set_pkt_type(&bus_, LR11XX_RADIO_PKT_TYPE_LORA)) ||
      !check(lr11xx_radio_set_rf_freq(&bus_, mesh::kUs915Lab1.frequency_hz)) ||
      !check(lr11xx_radio_set_lora_mod_params(&bus_, &modulation)) ||
      !check(lr11xx_radio_set_lora_pkt_params(&bus_, &params)) ||
      !check(lr11xx_radio_set_pa_cfg(&bus_, &pa)) ||
      !check(lr11xx_radio_set_tx_params(&bus_, static_cast<std::int8_t>(dbm(level)),
                                        LR11XX_RADIO_RAMP_48_US)) ||
      // The same one-byte LoRa sync word as the SX1262 and SX1276 boards.
      !check(lr11xx_radio_set_lora_sync_word(&bus_, 0x52)) ||
      !check(lr11xx_system_set_dio_irq_params(&bus_, kIrq, 0)) ||
      !check(lr11xx_system_clear_irq_status(&bus_, LR11XX_SYSTEM_IRQ_ALL_MASK)) ||
      !check(lr11xx_radio_set_rx_tx_fallback_mode(&bus_, LR11XX_RADIO_FALLBACK_STDBY_RC)))
    return false;
  healthy_ = true;
  receive_ = receive;
  allow_tx_ = transmit && receive;
  return !receive || listen();
}
Start Lr1110::transmit(const std::uint8_t* bytes, std::size_t size, std::uint64_t now) {
  if (!healthy_)
    return Start::Fault;
  if (!allow_tx_ || !mesh::valid_frame_layout(bytes, size))
    return Start::Rejected;
  if (transmitting_)
    return Start::Wait;
  if (!budget_.reserve(now, mesh::airtime_us(size) + 1000))
    return Start::Wait;
  const auto params = packet(static_cast<std::uint8_t>(size));
  if (!check(lr11xx_system_set_standby(&bus_, LR11XX_SYSTEM_STANDBY_CFG_RC)) ||
      !check(lr11xx_radio_set_lora_pkt_params(&bus_, &params)) ||
      !check(lr11xx_regmem_write_buffer8(&bus_, bytes, static_cast<std::uint8_t>(size))) ||
      !check(lr11xx_system_clear_irq_status(&bus_, LR11XX_SYSTEM_IRQ_ALL_MASK)) ||
      !check(lr11xx_radio_set_tx(&bus_, 1000)))
    return Start::Fault;
  transmitting_ = true;
  deadline_ = now + 1100;
  return Start::Started;
}
Event Lr1110::poll(std::uint64_t now) {
  Event event{};
  if (!healthy_)
    return event;
  lr11xx_system_irq_mask_t irq = 0;
  const bool was_transmitting = transmitting_;
  if (!check(lr11xx_system_get_and_clear_irq_status(&bus_, &irq))) {
    event.tx_done = was_transmitting;
    return event;
  }
  if (transmitting_ &&
      (irq & (LR11XX_SYSTEM_IRQ_TX_DONE | LR11XX_SYSTEM_IRQ_TIMEOUT) || now >= deadline_)) {
    event.tx_done = true;
    event.tx_success =
        (irq & LR11XX_SYSTEM_IRQ_TX_DONE) && !(irq & LR11XX_SYSTEM_IRQ_TIMEOUT) && now < deadline_;
    transmitting_ = false;
    if (receive_)
      listen();
  } else if (!transmitting_ && (irq & LR11XX_SYSTEM_IRQ_RX_DONE) &&
             !(irq & (LR11XX_SYSTEM_IRQ_CRC_ERROR | LR11XX_SYSTEM_IRQ_HEADER_ERROR))) {
    lr11xx_radio_rx_buffer_status_t buffer{};
    if (check(lr11xx_radio_get_rx_buffer_status(&bus_, &buffer)) &&
        buffer.pld_len_in_bytes >= mesh::kMinFrameBytes &&
        buffer.pld_len_in_bytes <= mesh::kMaxPacketBytes &&
        check(lr11xx_regmem_read_buffer8(&bus_, event.bytes.data(), buffer.buffer_start_pointer,
                                         buffer.pld_len_in_bytes))) {
      if (mesh::valid_frame_layout(event.bytes.data(), buffer.pld_len_in_bytes)) {
        event.size = buffer.pld_len_in_bytes;
        event.received = true;
      }
    }
  }
  return event;
}
}  // namespace reaper::radio
