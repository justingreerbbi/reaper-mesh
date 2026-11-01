#include "nvs_storage.hpp"
#include "nvs_flash.h"

namespace d = reaper::device;
NvsStorage::NvsStorage() {
  // Never use the common example's erase-on-init-error fallback. Preserve evidence.
  if (nvs_flash_init_partition("reaper_nvs") != ESP_OK) return;
  ready_ = nvs_open_from_partition("reaper_nvs", "reaper", NVS_READWRITE, &handle_) == ESP_OK;
}
NvsStorage::~NvsStorage() { if (ready_) nvs_close(handle_); }
d::ReadStatus NvsStorage::read(std::uint8_t* output, std::size_t capacity, std::size_t& size) noexcept {
  size = 0;
  if (!ready_ || !output) return d::ReadStatus::Failed;
  std::size_t stored = 0;
  auto status = nvs_get_blob(handle_, "config", nullptr, &stored);
  if (status == ESP_ERR_NVS_NOT_FOUND) return d::ReadStatus::Missing;
  if (status != ESP_OK || stored > capacity || stored > d::kMaxRecord) return d::ReadStatus::Failed;
  status = nvs_get_blob(handle_, "config", output, &stored);
  if (status != ESP_OK || stored > capacity) return d::ReadStatus::Failed;
  size = stored; return d::ReadStatus::Loaded;
}
d::CommitStatus NvsStorage::commit(const std::uint8_t* data, std::size_t size) noexcept {
  if (!ready_ || !data || size == 0 || size > d::kMaxRecord) return d::CommitStatus::NotCommitted;
  if (nvs_set_blob(handle_, "config", data, size) != ESP_OK) return d::CommitStatus::Indeterminate;
  if (nvs_commit(handle_) != ESP_OK) return d::CommitStatus::Indeterminate;
  return d::CommitStatus::Committed;
}
