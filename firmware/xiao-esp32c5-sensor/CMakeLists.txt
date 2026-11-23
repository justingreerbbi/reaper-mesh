cmake_minimum_required(VERSION 3.16)
# The signals add-on for the Seeed Studio XIAO ESP32-C5 (D60). It speaks the sensor protocol, not
# the node protocol, and has no LoRa radio.
set(IDF_TARGET esp32c5)
set(EXTRA_COMPONENT_DIRS "${CMAKE_CURRENT_LIST_DIR}/../components/reaper_protocol" "${CMAKE_CURRENT_LIST_DIR}/../components/reaper_sensor")
set(COMPONENTS main)
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(reaper_sensor_xiao_c5 VERSION 0.1.0)
