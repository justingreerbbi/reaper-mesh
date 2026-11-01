idf_component_register(SRCS "configuration.cpp" "session.cpp" "messages.cpp" INCLUDE_DIRS "include" REQUIRES reaper_protocol)
target_compile_features(${COMPONENT_LIB} PUBLIC cxx_std_17)
