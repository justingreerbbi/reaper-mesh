#include "key_partition.hpp"
namespace {
constexpr std::size_t kSectorBytes = 0x1000;
}
bool KeyPartition::begin() {
  partition_ = esp_partition_find_first(ESP_PARTITION_TYPE_DATA,
                                        static_cast<esp_partition_subtype_t>(0x40), "reaper_keys");
  return partition_ && partition_->size >= kSectors * kSectorBytes;
}
bool KeyPartition::read(unsigned sector, std::uint8_t* out, std::size_t size) {
  return partition_ && sector < kSectors &&
         esp_partition_read(partition_, sector * kSectorBytes, out, size) == ESP_OK;
}
bool KeyPartition::erase(unsigned sector) {
  return partition_ && sector < kSectors &&
         esp_partition_erase_range(partition_, sector * kSectorBytes, kSectorBytes) == ESP_OK;
}
bool KeyPartition::write(unsigned sector, const std::uint8_t* bytes, std::size_t size) {
  return partition_ && sector < kSectors &&
         esp_partition_write(partition_, sector * kSectorBytes, bytes, size) == ESP_OK;
}
