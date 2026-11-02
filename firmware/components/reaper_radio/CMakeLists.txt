idf_component_register(SRCS "sx1276.cpp" "radio.cpp" "hal.cpp" "vendor/sx126x.c" INCLUDE_DIRS "include" PRIV_INCLUDE_DIRS "vendor" REQUIRES reaper_mesh)
target_compile_features(${COMPONENT_LIB} PUBLIC cxx_std_17)
