idf_component_register(SRCS "radio_packet.cpp" "mesh.cpp" "regional.cpp" INCLUDE_DIRS "include" REQUIRES reaper_protocol)
target_compile_features(${COMPONENT_LIB} PUBLIC cxx_std_17)
