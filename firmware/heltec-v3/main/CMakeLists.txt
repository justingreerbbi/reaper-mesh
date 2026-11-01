idf_component_register(SRCS "main.cpp" "nvs_storage.cpp" INCLUDE_DIRS "."
  REQUIRES reaper_device nvs_flash esp_driver_uart esp_driver_gpio esp_hw_support bootloader_support esp_system esp_timer)
