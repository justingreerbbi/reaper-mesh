cmake_minimum_required(VERSION 3.16)
# Phase 0 bench spike for the signals add-on (D60). Throwaway: not a product build.
set(IDF_TARGET esp32c5)
set(COMPONENTS main)
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(xiao_c5_phase0)
