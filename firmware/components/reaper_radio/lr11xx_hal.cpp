#include "reaper/radio.hpp"
#include "lr11xx_hal.h"
#include <array>
#include <cstring>
// Connects Semtech's LR11xx driver to the board's bounded Bus. Every LR11xx command waits for
// BUSY low first; reads are two transactions: the command, then the status byte and the reply.
// Only zero bytes are clocked out while reading, as the driver requires.
namespace {
constexpr std::size_t kMaxTransfer = 260;
// Calibration and image calibration keep BUSY high far longer than an ordinary command.
constexpr std::uint32_t kBusyMs = 100;
reaper::radio::Bus& bus(const void* context) {
  return *static_cast<reaper::radio::Bus*>(const_cast<void*>(context));
}
}  // namespace
extern "C" lr11xx_hal_status_t lr11xx_hal_write(const void* context, const std::uint8_t* command,
                                                const std::uint16_t command_length,
                                                const std::uint8_t* data,
                                                const std::uint16_t data_length) {
  if (!context || !command || !command_length || command_length + data_length > kMaxTransfer)
    return LR11XX_HAL_STATUS_ERROR;
  std::array<std::uint8_t, kMaxTransfer> tx{}, rx{};
  std::memcpy(tx.data(), command, command_length);
  if (data && data_length)
    std::memcpy(tx.data() + command_length, data, data_length);
  auto& b = bus(context);
  return b.ready(kBusyMs) && b.transfer(tx.data(), rx.data(), command_length + data_length)
             ? LR11XX_HAL_STATUS_OK
             : LR11XX_HAL_STATUS_ERROR;
}
extern "C" lr11xx_hal_status_t lr11xx_hal_read(const void* context, const std::uint8_t* command,
                                               const std::uint16_t command_length,
                                               std::uint8_t* data,
                                               const std::uint16_t data_length) {
  if (!context || !command || !command_length || command_length > kMaxTransfer ||
      data_length + 1u > kMaxTransfer || (data_length && !data))
    return LR11XX_HAL_STATUS_ERROR;
  std::array<std::uint8_t, kMaxTransfer> tx{}, rx{};
  std::memcpy(tx.data(), command, command_length);
  auto& b = bus(context);
  if (!b.ready(kBusyMs) || !b.transfer(tx.data(), rx.data(), command_length))
    return LR11XX_HAL_STATUS_ERROR;
  if (!data_length)
    return LR11XX_HAL_STATUS_OK;
  tx.fill(0);
  if (!b.ready(kBusyMs) || !b.transfer(tx.data(), rx.data(), data_length + 1u))
    return LR11XX_HAL_STATUS_ERROR;
  std::memcpy(data, rx.data() + 1, data_length);  // rx[0] is the Stat1 byte.
  return LR11XX_HAL_STATUS_OK;
}
extern "C" lr11xx_hal_status_t lr11xx_hal_direct_read(const void* context, std::uint8_t* data,
                                                      const std::uint16_t data_length) {
  if (!context || !data || !data_length || data_length > kMaxTransfer)
    return LR11XX_HAL_STATUS_ERROR;
  std::array<std::uint8_t, kMaxTransfer> tx{}, rx{};
  auto& b = bus(context);
  if (!b.ready(kBusyMs) || !b.transfer(tx.data(), rx.data(), data_length))
    return LR11XX_HAL_STATUS_ERROR;
  std::memcpy(data, rx.data(), data_length);
  return LR11XX_HAL_STATUS_OK;
}
extern "C" lr11xx_hal_status_t lr11xx_hal_reset(const void* context) {
  return context && bus(context).reset() ? LR11XX_HAL_STATUS_OK : LR11XX_HAL_STATUS_ERROR;
}
// Reaper never puts the LR1110 to sleep, so waking it is only waiting until it is free.
extern "C" lr11xx_hal_status_t lr11xx_hal_wakeup(const void* context) {
  return context && bus(context).ready(kBusyMs) ? LR11XX_HAL_STATUS_OK : LR11XX_HAL_STATUS_ERROR;
}
// Only GNSS and Wi-Fi scans block; Reaper runs neither.
extern "C" lr11xx_hal_status_t lr11xx_hal_abort_blocking_cmd(const void*) {
  return LR11XX_HAL_STATUS_ERROR;
}
