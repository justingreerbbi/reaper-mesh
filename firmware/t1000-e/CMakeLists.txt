# Zephyr application for the Seeed SenseCAP T1000-E (nRF52840, LR1110), decision D57. It builds the
# portable components and the shared mesh service from firmware/, with T1000-E adapters in src/.
cmake_minimum_required(VERSION 3.20.0)
list(APPEND BOARD_ROOT ${CMAKE_CURRENT_LIST_DIR})
set(BOARD t1000_e)
find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(reaper_t1000_e LANGUAGES C CXX)

set(fw ${CMAKE_CURRENT_LIST_DIR}/..)
set(components ${fw}/components)
target_compile_definitions(app PRIVATE REAPER_T1000_E=1 LR11XX_DISABLE_WARNINGS)
# tools/build-firmware.sh sets this for the desk relay test build only.
if(REAPER_TEST_RELAYED_ONLY)
  target_compile_definitions(app PRIVATE REAPER_TEST_RELAYED_ONLY=1)
endif()
target_sources(app PRIVATE
  src/main.cpp src/t1000e_radio_bus.cpp src/flash_storage.cpp src/key_area.cpp src/board_io.cpp
  src/usb_serial.cpp src/ble_link.cpp src/ble_gatt.c
  ${fw}/app/mesh_service.cpp ${fw}/app/device_ui.cpp
  ${components}/reaper_protocol/protocol.cpp
  ${components}/reaper_device/discovery.cpp ${components}/reaper_device/configuration.cpp
  ${components}/reaper_device/session.cpp ${components}/reaper_device/messages.cpp
  ${components}/reaper_device/inbox.cpp ${components}/reaper_device/host_links.cpp
  ${components}/reaper_device/network.cpp
  ${components}/reaper_mesh/radio_packet.cpp ${components}/reaper_mesh/frame.cpp
  ${components}/reaper_mesh/mesh.cpp ${components}/reaper_mesh/regional.cpp
  ${components}/reaper_radio/lr1110.cpp ${components}/reaper_radio/lr11xx_hal.cpp
  ${components}/reaper_radio/lr11xx/lr11xx_radio.c ${components}/reaper_radio/lr11xx/lr11xx_system.c
  ${components}/reaper_radio/lr11xx/lr11xx_regmem.c
  ${components}/reaper_crypto/crypto_psa.cpp)
target_include_directories(app PRIVATE
  src ${fw}/app
  ${components}/reaper_protocol/include ${components}/reaper_device/include
  ${components}/reaper_mesh/include ${components}/reaper_radio/include
  ${components}/reaper_radio/lr11xx ${components}/reaper_crypto/include)
