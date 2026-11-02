set(shared "${CMAKE_CURRENT_LIST_DIR}/../../heltec-v3/main")
idf_component_register(SRCS "${shared}/main.cpp" "${shared}/nvs_storage.cpp" "${shared}/mesh_service.cpp" "status_display.cpp" "radio_bus.cpp"
  INCLUDE_DIRS "." "${shared}"
  REQUIRES reaper_device reaper_radio esp_driver_spi nvs_flash esp_driver_uart esp_driver_gpio esp_driver_i2c esp_hw_support bootloader_support esp_system esp_timer)
