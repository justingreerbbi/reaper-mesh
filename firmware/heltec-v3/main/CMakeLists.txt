# Board-specific radio bus, display and profile, plus the shared application in firmware/app/.
set(app "${CMAKE_CURRENT_LIST_DIR}/../../app")
idf_component_register(
  SRCS "${app}/main.cpp" "${app}/nvs_storage.cpp" "${app}/key_partition.cpp" "${app}/mesh_service.cpp"
       "${app}/status_display.cpp" "${app}/device_ui.cpp" "${app}/ble_link.cpp"
       "status_display.cpp" "radio_bus.cpp" "board_input.cpp" "board_power.cpp"
  INCLUDE_DIRS "." "${app}"
  REQUIRES bt esp_partition reaper_device reaper_radio esp_driver_spi nvs_flash esp_driver_uart esp_driver_gpio
           esp_driver_i2c esp_hw_support bootloader_support esp_system esp_timer esp_adc)
