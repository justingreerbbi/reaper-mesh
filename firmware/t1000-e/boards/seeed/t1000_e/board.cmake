# Flashing goes through the Adafruit nRF52 UF2 bootloader the T1000-E ships with. See
# tools/update-t1000e.py; this board has no debug probe connector.
board_runner_args(uf2 "--board-id=T1000-E")
include(${ZEPHYR_BASE}/boards/common/uf2.board.cmake)
