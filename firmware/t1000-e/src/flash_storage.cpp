#include "flash_storage.hpp"
#include <zephyr/drivers/flash.h>
#include <zephyr/storage/flash_map.h>
#include <cerrno>
namespace d = reaper::device;
namespace {
constexpr std::uint16_t kConfig = 1, kBoot = 2;
}
FlashStorage::FlashStorage() {
  fs_.flash_device = PARTITION_DEVICE(reaper_nvs_partition);
  fs_.offset = PARTITION_OFFSET(reaper_nvs_partition);
  flash_pages_info page{};
  if (!device_is_ready(fs_.flash_device) ||
      flash_get_page_info_by_offs(fs_.flash_device, fs_.offset, &page) != 0)
    return;
  fs_.sector_size = page.size;
  fs_.sector_count = PARTITION_SIZE(reaper_nvs_partition) / page.size;
  // Never erase on a mount error, as on the ESP boards: preserve the evidence. A fresh install
  // erases this partition (tools/uf2-image.py).
  ready_ = nvs_mount(&fs_) == 0;
}
d::ReadStatus FlashStorage::read(std::uint8_t* output, std::size_t capacity,
                                 std::size_t& size) noexcept {
  size = 0;
  if (!ready_ || !output)
    return d::ReadStatus::Failed;
  const auto stored = nvs_read(&fs_, kConfig, output, 0);
  if (stored == -ENOENT)
    return d::ReadStatus::Missing;
  if (stored <= 0 || static_cast<std::size_t>(stored) > capacity ||
      static_cast<std::size_t>(stored) > d::kMaxRecord)
    return d::ReadStatus::Failed;
  if (nvs_read(&fs_, kConfig, output, static_cast<std::size_t>(stored)) != stored)
    return d::ReadStatus::Failed;
  size = static_cast<std::size_t>(stored);
  return d::ReadStatus::Loaded;
}
std::uint32_t FlashStorage::next_boot_counter(std::uint32_t first) noexcept {
  if (!ready_ || !first)
    return 0;
  std::uint32_t counter = 0;
  const auto stored = nvs_read(&fs_, kBoot, &counter, sizeof(counter));
  if (stored == -ENOENT)
    counter = first;
  else if (stored != sizeof(counter) || counter == 0xffffffff)
    return 0;
  else
    ++counter;
  if (nvs_write(&fs_, kBoot, &counter, sizeof(counter)) != sizeof(counter))
    return 0;
  return counter;
}
d::CommitStatus FlashStorage::commit(const std::uint8_t* data, std::size_t size) noexcept {
  if (!ready_ || !data || size == 0 || size > d::kMaxRecord)
    return d::CommitStatus::NotCommitted;
  // NVS writes a record and then its allocation entry, so a power cut leaves the old record.
  // Zero means the same bytes were already stored.
  const auto written = nvs_write(&fs_, kConfig, data, size);
  if (written != static_cast<ssize_t>(size) && written != 0)
    return d::CommitStatus::Indeterminate;
  return d::CommitStatus::Committed;
}
