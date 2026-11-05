#pragma once
#include "reaper/network.hpp"
#include "esp_partition.h"
// The reaper_keys partition: two flash sectors, explicitly erased rather than log-structured.
class KeyPartition final : public reaper::device::KeySectors {
 public:
  bool begin();
  bool read(unsigned sector, std::uint8_t*, std::size_t) override;
  bool erase(unsigned sector) override;
  bool write(unsigned sector, const std::uint8_t*, std::size_t) override;

 private:
  const esp_partition_t* partition_ = nullptr;
};
