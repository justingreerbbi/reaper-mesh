#pragma once
#include "reaper/network.hpp"
#include <zephyr/storage/flash_map.h>
// The reaper_keys partition: two flash sectors, explicitly erased rather than log-structured, as
// app/key_partition.cpp does on the ESP boards.
class KeyArea final : public reaper::device::KeySectors {
 public:
  bool begin();
  bool read(unsigned sector, std::uint8_t*, std::size_t) override;
  bool erase(unsigned sector) override;
  bool write(unsigned sector, const std::uint8_t*, std::size_t) override;

 private:
  const flash_area* area_ = nullptr;
};
