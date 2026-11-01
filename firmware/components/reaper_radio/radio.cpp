#include "reaper/radio.hpp"
#include "sx126x.h"
namespace reaper::radio {
namespace {
sx126x_pkt_params_lora_t packet(std::uint8_t size) { return {8, SX126X_LORA_PKT_EXPLICIT, size, true, false}; }
}
bool Radio::check(int status) { if (status == SX126X_STATUS_OK) return true; stop(); return false; }
void Radio::stop() { bus_.off(); healthy_ = receive_ = allow_tx_ = transmitting_ = false; }
bool Radio::listen() {
  const auto params = packet(mesh::kMaxPacketBytes);
  return check(sx126x_set_lora_pkt_params(&bus_, &params)) && check(sx126x_set_rx_with_timeout_in_rtc_step(&bus_, SX126X_RX_CONTINUOUS));
}
bool Radio::configure(std::uint8_t power, bool receive, bool transmit) {
  healthy_ = receive_ = allow_tx_ = transmitting_ = false;
  if (power > mesh::kUs915Lab1.max_power_dbm) { stop(); return false; }
  const sx126x_pa_cfg_params_t pa{4, 7, 0, 1};
  const sx126x_mod_params_lora_t modulation{SX126X_LORA_SF7, SX126X_LORA_BW_500, SX126X_LORA_CR_4_5, 0};
  const auto params = packet(mesh::kMaxPacketBytes);
  sx126x_chip_status_t status{}; sx126x_errors_mask_t errors = 0;
  const auto irq = SX126X_IRQ_TX_DONE | SX126X_IRQ_RX_DONE | SX126X_IRQ_CRC_ERROR | SX126X_IRQ_HEADER_ERROR | SX126X_IRQ_TIMEOUT;
  if (!check(sx126x_reset(&bus_)) || !check(sx126x_set_standby(&bus_, SX126X_STANDBY_CFG_RC)) ||
      !check(sx126x_get_status(&bus_, &status))) return false;
  chip_mode_ = status.chip_mode; command_status_ = status.cmd_status;
  if (status.chip_mode != SX126X_CHIP_MODE_STBY_RC || status.cmd_status == SX126X_CMD_STATUS_CMD_TIMEOUT ||
      status.cmd_status == SX126X_CMD_STATUS_CMD_PROCESS_ERROR || status.cmd_status == SX126X_CMD_STATUS_CMD_EXEC_FAILURE) { stop(); return false; }
  if (!check(sx126x_clear_device_errors(&bus_)) || !check(sx126x_set_reg_mode(&bus_, SX126X_REG_MODE_DCDC)) ||
      !check(sx126x_set_dio3_as_tcxo_ctrl(&bus_, SX126X_TCXO_CTRL_1_8V, 320)) ||
      !check(sx126x_cal(&bus_, SX126X_CAL_ALL)) || !check(sx126x_cal_img_in_mhz(&bus_, 902, 928)) ||
      !check(sx126x_set_pkt_type(&bus_, SX126X_PKT_TYPE_LORA)) ||
      !check(sx126x_set_rf_freq(&bus_, mesh::kUs915Lab1.frequency_hz)) || !check(sx126x_set_buffer_base_address(&bus_, 0, 0)) ||
      !check(sx126x_set_pa_cfg(&bus_, &pa)) || !check(sx126x_cfg_tx_clamp(&bus_)) ||
      !check(sx126x_set_ocp_value(&bus_, 0x38)) || !check(sx126x_set_tx_params(&bus_, power, SX126X_RAMP_200_US)) ||
      !check(sx126x_set_lora_mod_params(&bus_, &modulation)) || !check(sx126x_set_lora_pkt_params(&bus_, &params)) ||
      !check(sx126x_set_lora_sync_word(&bus_, 0x52)) || !check(sx126x_set_dio2_as_rf_sw_ctrl(&bus_, true)) ||
      !check(sx126x_set_dio_irq_params(&bus_, irq, irq, 0, 0)) || !check(sx126x_clear_irq_status(&bus_, SX126X_IRQ_ALL)) ||
      !check(sx126x_set_rx_tx_fallback_mode(&bus_, SX126X_FALLBACK_STDBY_RC)) ||
      !check(sx126x_get_device_errors(&bus_, &errors))) return false;
  errors_ = errors;
  if (errors) { stop(); return false; }
  healthy_ = true; receive_ = receive; allow_tx_ = transmit && receive;
  return !receive || listen();
}
Start Radio::transmit(const std::uint8_t* bytes, std::size_t size, std::uint64_t now) {
  if (!healthy_) return Start::Fault;
  mesh::Packet decoded{};
  if (!allow_tx_ || !mesh::decode_packet(bytes, size, decoded)) return Start::Rejected;
  if (transmitting_) return Start::Wait;
  if (!budget_.reserve(now, mesh::airtime_us(size) + 1000)) return Start::Wait;
  const auto params = packet(size);
  if (!check(sx126x_set_standby(&bus_, SX126X_STANDBY_CFG_RC)) ||
      !check(sx126x_set_lora_pkt_params(&bus_, &params)) || !check(sx126x_write_buffer(&bus_, 0, bytes, size)) ||
      !check(sx126x_clear_irq_status(&bus_, SX126X_IRQ_ALL)) || !check(sx126x_set_tx(&bus_, 1000))) return Start::Fault;
  transmitting_ = true; deadline_ = now + 1100; return Start::Started;
}
Event Radio::poll(std::uint64_t now) {
  Event event{}; if (!healthy_) return event;
  sx126x_irq_mask_t irq = 0;
  const bool was_transmitting = transmitting_;
  if (!check(sx126x_get_and_clear_irq_status(&bus_, &irq))) { event.tx_done = was_transmitting; return event; }
  if (transmitting_ && (irq & (SX126X_IRQ_TX_DONE | SX126X_IRQ_TIMEOUT) || now >= deadline_)) {
    event.tx_done = true; event.tx_success = (irq & SX126X_IRQ_TX_DONE) && !(irq & SX126X_IRQ_TIMEOUT) && now < deadline_;
    transmitting_ = false; if (receive_) listen();
  } else if (!transmitting_ && (irq & SX126X_IRQ_RX_DONE) && !(irq & (SX126X_IRQ_CRC_ERROR | SX126X_IRQ_HEADER_ERROR))) {
    sx126x_rx_buffer_status_t buffer{};
    if (check(sx126x_get_rx_buffer_status(&bus_, &buffer)) && buffer.pld_len_in_bytes >= 54 && buffer.pld_len_in_bytes <= mesh::kMaxPacketBytes &&
        check(sx126x_read_buffer(&bus_, buffer.buffer_start_pointer, event.bytes.data(), buffer.pld_len_in_bytes))) {
      mesh::Packet decoded{};
      if (mesh::decode_packet(event.bytes.data(), buffer.pld_len_in_bytes, decoded)) { event.size = buffer.pld_len_in_bytes; event.received = true; }
    }
  }
  return event;
}
} // namespace reaper::radio
