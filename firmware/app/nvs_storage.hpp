#pragma once
#include "reaper/configuration.hpp"
#include "nvs.h"

class NvsStorage final : public reaper::device::Storage {
 public:
  NvsStorage();
  ~NvsStorage() override;
  reaper::device::ReadStatus read(std::uint8_t*, std::size_t, std::size_t&) noexcept override;
  reaper::device::CommitStatus commit(const std::uint8_t*, std::size_t) noexcept override;

 private:
  nvs_handle_t handle_ = 0;
  bool ready_ = false;
};
