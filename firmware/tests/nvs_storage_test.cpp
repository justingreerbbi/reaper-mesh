#include "nvs_storage.hpp"
#include <cstring>
#include <iostream>
#include <string>

namespace d = reaper::device;
namespace {
int init_error = 0, open_error = 0, get_error = 0, set_error = 0, commit_error = 0;
unsigned set_calls = 0, commit_calls = 0, close_calls = 0, get_calls = 0;
bool missing = false, second_get_fails = false;
std::size_t stored_size = 16;
bool arguments_valid = true;
bool boot_saved = false;
std::uint32_t boot_value = 0;
}  // namespace
esp_err_t nvs_flash_init_partition(const char* partition) {
  arguments_valid &= std::strcmp(partition, "reaper_nvs") == 0;
  return init_error;
}
esp_err_t nvs_open_from_partition(const char* partition, const char* ns, int mode,
                                  nvs_handle_t* handle) {
  arguments_valid &= std::strcmp(partition, "reaper_nvs") == 0 && std::strcmp(ns, "reaper") == 0 &&
                     mode == NVS_READWRITE;
  *handle = 1;
  return open_error;
}
void nvs_close(nvs_handle_t handle) {
  arguments_valid &= handle == 1;
  ++close_calls;
}
esp_err_t nvs_get_blob(nvs_handle_t handle, const char* key, void* output, std::size_t* size) {
  if (!std::strcmp(key, "boot")) {
    if (get_error)
      return get_error;
    if (!boot_saved)
      return ESP_ERR_NVS_NOT_FOUND;
    std::memcpy(output, &boot_value, sizeof(boot_value));
    *size = sizeof(boot_value);
    return ESP_OK;
  }
  arguments_valid &= handle == 1 && std::strcmp(key, "config") == 0;
  ++get_calls;
  if (missing)
    return ESP_ERR_NVS_NOT_FOUND;
  if (get_error || (second_get_fails && output))
    return -1;
  if (output) {
    if (*size < stored_size)
      return -1;
    std::memset(output, 42, stored_size);
  }
  *size = stored_size;
  return ESP_OK;
}
esp_err_t nvs_set_blob(nvs_handle_t handle, const char* key, const void* data, std::size_t size) {
  if (!std::strcmp(key, "boot")) {
    ++set_calls;
    if (set_error)
      return set_error;
    std::memcpy(&boot_value, data, size);
    boot_saved = true;
    return ESP_OK;
  }
  arguments_valid &= handle == 1 && std::strcmp(key, "config") == 0;
  ++set_calls;
  return set_error;
}
esp_err_t nvs_commit(nvs_handle_t handle) {
  arguments_valid &= handle == 1;
  ++commit_calls;
  return commit_error;
}
#define CHECK(value)                                              \
  do {                                                            \
    if (!(value)) {                                               \
      std::cerr << "line " << __LINE__ << ": " << #value << '\n'; \
      return 1;                                                   \
    }                                                             \
  } while (false)
int main(int argc, char** argv) {
  if (argc != 2)
    return 2;
  const std::string scenario = argv[1];
  std::array<std::uint8_t, d::kMaxRecord> record{};
  std::size_t size = 99;
  if (scenario == "init") {
    init_error = -1;
    {
      NvsStorage storage;
      CHECK(storage.read(record.data(), record.size(), size) == d::ReadStatus::Failed && size == 0);
      CHECK(storage.commit(record.data(), 16) == d::CommitStatus::NotCommitted);
    }
    CHECK(set_calls == 0 && close_calls == 0);
    init_error = 0;
    open_error = -1;
    {
      NvsStorage storage;
      CHECK(storage.read(record.data(), record.size(), size) == d::ReadStatus::Failed);
    }
    CHECK(close_calls == 0);
  } else if (scenario == "reads") {
    NvsStorage storage;
    CHECK(storage.read(record.data(), record.size(), size) == d::ReadStatus::Loaded && size == 16 &&
          record[0] == 42);
    missing = true;
    CHECK(storage.read(record.data(), record.size(), size) == d::ReadStatus::Missing && size == 0);
    missing = false;
    get_error = -1;
    CHECK(storage.read(record.data(), record.size(), size) == d::ReadStatus::Failed && size == 0);
    get_error = 0;
    second_get_fails = true;
    CHECK(storage.read(record.data(), record.size(), size) == d::ReadStatus::Failed && size == 0);
  } else if (scenario == "bounds") {
    NvsStorage storage;
    stored_size = d::kMaxRecord + 1;
    CHECK(storage.read(record.data(), record.size(), size) == d::ReadStatus::Failed && size == 0 &&
          get_calls == 1);
    CHECK(storage.commit(record.data(), d::kMaxRecord + 1) == d::CommitStatus::NotCommitted);
    CHECK(storage.commit(nullptr, 16) == d::CommitStatus::NotCommitted);
    CHECK(storage.commit(record.data(), 0) == d::CommitStatus::NotCommitted && set_calls == 0);
  } else if (scenario == "commit") {
    {
      NvsStorage storage;
      CHECK(storage.commit(record.data(), 16) == d::CommitStatus::Committed);
    }
    CHECK(set_calls == 1 && commit_calls == 1 && close_calls == 1);
  } else if (scenario == "bootcounter") {
    NvsStorage storage;
    CHECK(storage.next_boot_counter(0) == 0);
    CHECK(storage.next_boot_counter(500) == 500);
    CHECK(commit_calls == 1);
    CHECK(storage.next_boot_counter(900) == 501);  // Only a board with no saved value uses it.
    // Any failure to save returns zero, and the radio then refuses to transmit.
    set_error = -1;
    CHECK(storage.next_boot_counter(1) == 0);
    set_error = 0;
    commit_error = -1;
    CHECK(storage.next_boot_counter(1) == 0);
    commit_error = 0;
    get_error = -1;
    CHECK(storage.next_boot_counter(1) == 0);
    get_error = 0;
    boot_value = 0xffffffff;  // It never wraps around to a value used before.
    CHECK(storage.next_boot_counter(1) == 0);
  } else if (scenario == "uncertain") {
    NvsStorage storage;
    set_error = -1;
    CHECK(storage.commit(record.data(), 16) == d::CommitStatus::Indeterminate && commit_calls == 0);
    set_error = 0;
    commit_error = -1;
    CHECK(storage.commit(record.data(), 16) == d::CommitStatus::Indeterminate && commit_calls == 1);
  } else
    return 3;
  CHECK(arguments_valid);
  std::cout << "ok " << scenario << '\n';
}
