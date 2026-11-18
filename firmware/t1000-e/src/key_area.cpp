#include "key_area.hpp"
namespace {
constexpr std::size_t kSectorBytes = 0x1000;
}
bool KeyArea::begin() {
  if (flash_area_open(PARTITION_ID(reaper_keys_partition), &area_) != 0) {
    area_ = nullptr;
    return false;
  }
  return area_->fa_size >= kSectors * kSectorBytes;
}
bool KeyArea::read(unsigned sector, std::uint8_t* out, std::size_t size) {
  return area_ && sector < kSectors && size <= kSectorBytes &&
         flash_area_read(area_, sector * kSectorBytes, out, size) == 0;
}
bool KeyArea::erase(unsigned sector) {
  return area_ && sector < kSectors &&
         flash_area_erase(area_, sector * kSectorBytes, kSectorBytes) == 0;
}
// The key record is not a whole number of 32-bit words, so the build enables the flash driver's
// byte-write emulation (CONFIG_SOC_FLASH_NRF_EMULATE_ONE_BYTE_WRITE_ACCESS).
bool KeyArea::write(unsigned sector, const std::uint8_t* bytes, std::size_t size) {
  return area_ && sector < kSectors && size <= kSectorBytes &&
         flash_area_write(area_, sector * kSectorBytes, bytes, size) == 0;
}
