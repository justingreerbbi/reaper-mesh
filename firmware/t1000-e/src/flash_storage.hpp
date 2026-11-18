#pragma once
#include "reaper/configuration.hpp"
#include <zephyr/kvss/nvs.h>
// Settings and the boot counter in Zephyr NVS on the reaper_nvs partition: the T1000-E's
// counterpart of app/nvs_storage.cpp, with the same rules.
class FlashStorage final : public reaper::device::Storage {
 public:
  FlashStorage();
  reaper::device::ReadStatus read(std::uint8_t*, std::size_t, std::size_t&) noexcept override;
  reaper::device::CommitStatus commit(const std::uint8_t*, std::size_t) noexcept override;
  // As NvsStorage::next_boot_counter: zero means it could not be saved and nothing may transmit.
  std::uint32_t next_boot_counter(std::uint32_t first) noexcept;
  bool ready() const { return ready_; }

 private:
  nvs_fs fs_{};
  bool ready_ = false;
};
