idf_component_register(SRCS "crypto_mbedtls.cpp" INCLUDE_DIRS "include" PRIV_REQUIRES mbedtls)
target_compile_features(${COMPONENT_LIB} PUBLIC cxx_std_17)
