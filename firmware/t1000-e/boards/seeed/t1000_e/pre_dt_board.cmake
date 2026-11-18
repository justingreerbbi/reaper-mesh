# The nRF52840 maps several peripherals at one address (power/clock/bprot, acl/flash).
list(APPEND EXTRA_DTC_FLAGS "-Wno-unique_unit_address_if_enabled")
