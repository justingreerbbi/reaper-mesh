#pragma once
#include "nvs.h"
esp_err_t nvs_flash_init_partition(const char*);
// No erase API is provided: an accidental erase-on-error fallback fails compilation.
