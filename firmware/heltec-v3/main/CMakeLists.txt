idf_component_register(SRCS "main.cpp" "nvs_storage.cpp" "status_display.cpp" "radio_bus.cpp" "mesh_service.cpp" INCLUDE_DIRS "."
  REQUIRES reaper_device reaper_radio esp_driver_spi nvs_flash esp_driver_uart esp_driver_gpio esp_driver_i2c esp_hw_support bootloader_support esp_system esp_timer)
