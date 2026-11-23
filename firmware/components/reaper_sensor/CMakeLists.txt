# The sensor codec lives in reaper_protocol but is compiled here, so node firmware does not build it.
idf_component_register(SRCS "sensor_parse.cpp" "sensor_scan.cpp" "../reaper_protocol/sensor_protocol.cpp"
                       INCLUDE_DIRS "include" REQUIRES reaper_protocol)
target_compile_features(${COMPONENT_LIB} PUBLIC cxx_std_17)
