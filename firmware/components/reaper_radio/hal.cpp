#include "reaper/radio.hpp"
#include "sx126x_hal.h"
#include <cstring>
namespace {
reaper::radio::Bus& bus(const void* context) {
  return *static_cast<reaper::radio::Bus*>(const_cast<void*>(context));
}
sx126x_hal_status_t transfer(const void* context, const std::uint8_t* command,
                             std::uint16_t command_size, const std::uint8_t* write,
                             std::uint8_t* read, std::uint16_t data_size) {
  if (!context || !command || !command_size || command_size + data_size > 260)
    return SX126X_HAL_STATUS_ERROR;
  std::array<std::uint8_t, 260> tx{}, rx{};
  std::memcpy(tx.data(), command, command_size);
  if (write && data_size)
    std::memcpy(tx.data() + command_size, write, data_size);
  auto& b = bus(context);
  if (!b.ready(20) || !b.transfer(tx.data(), rx.data(), command_size + data_size) || !b.ready(20))
    return SX126X_HAL_STATUS_ERROR;
  if (read && data_size)
    std::memcpy(read, rx.data() + command_size, data_size);
  return SX126X_HAL_STATUS_OK;
}
}  // namespace
extern "C" sx126x_hal_status_t sx126x_hal_write(const void* context, const std::uint8_t* command,
                                                std::uint16_t command_size,
                                                const std::uint8_t* bytes, std::uint16_t size) {
  return transfer(context, command, command_size, bytes, nullptr, size);
}
extern "C" sx126x_hal_status_t sx126x_hal_read(const void* context, const std::uint8_t* command,
                                               std::uint16_t command_size, std::uint8_t* bytes,
                                               std::uint16_t size) {
  return transfer(context, command, command_size, nullptr, bytes, size);
}
extern "C" sx126x_hal_status_t sx126x_hal_reset(const void* context) {
  return context && bus(context).reset() ? SX126X_HAL_STATUS_OK : SX126X_HAL_STATUS_ERROR;
}
extern "C" sx126x_hal_status_t sx126x_hal_wakeup(const void* context) {
  const std::uint8_t command[] = {0xc0};
  std::uint8_t status = 0;
  return transfer(context, command, 1, nullptr, &status, 1);
}
