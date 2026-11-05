#pragma once
#include "reaper/configuration.hpp"
#include "nvs.h"

class NvsStorage final : public reaper::device::Storage {
 public:
  NvsStorage();
  ~NvsStorage() override;
  reaper::device::ReadStatus read(std::uint8_t*, std::size_t, std::size_t&) noexcept override;
  reaper::device::CommitStatus commit(const std::uint8_t*, std::size_t) noexcept override;
  // Saves and returns the next boot counter. Zero means it could not be saved, and the radio must
  // not transmit: a repeated counter could look like a replay of this radio's earlier frames.
  // A board with no saved counter begins at `first`, so erasing storage does not repeat old message
  // IDs, which a recipient could discard as duplicates. Pass a random value.
  std::uint32_t next_boot_counter(std::uint32_t first) noexcept;

 private:
  nvs_handle_t handle_ = 0;
  bool ready_ = false;
};
