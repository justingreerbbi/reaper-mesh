idf_component_register(SRCS "discovery.cpp" "configuration.cpp" "session.cpp" "messages.cpp" "inbox.cpp" "host_links.cpp" INCLUDE_DIRS "include" REQUIRES reaper_protocol reaper_mesh)
target_compile_features(${COMPONENT_LIB} PUBLIC cxx_std_17)
