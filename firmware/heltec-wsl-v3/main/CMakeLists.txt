# The Wireless Stick Lite V3 is wired like the WiFi LoRa 32 V3 for everything Reaper uses (radio,
# PRG button, battery sense, LED and Vext), so it reuses those board files. Only the profile and the
# display differ: it has no screen.
set(app "${CMAKE_CURRENT_LIST_DIR}/../../app")
set(heltec "${CMAKE_CURRENT_LIST_DIR}/../../heltec-v3/main")
idf_component_register(
  SRCS "${app}/main.cpp" "${app}/nvs_storage.cpp" "${app}/key_partition.cpp" "${app}/mesh_service.cpp"
       "${app}/status_display.cpp" "${app}/device_ui.cpp" "${app}/ble_link.cpp"
       "status_display.cpp" "${heltec}/radio_bus.cpp" "${heltec}/board_input.cpp"
       "${heltec}/board_power.cpp" "${heltec}/board_led.cpp"
  INCLUDE_DIRS "." "${app}"
  REQUIRES bt esp_partition reaper_device reaper_radio esp_driver_spi nvs_flash esp_driver_uart esp_driver_gpio
           esp_driver_i2c esp_hw_support bootloader_support esp_system esp_timer esp_adc)
