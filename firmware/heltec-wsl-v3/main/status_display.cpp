#include "status_display.hpp"
#include "driver/gpio.h"
void StatusDisplay::begin() {
  // No screen on this board, so the display stays not ready and every draw does nothing. Vext
  // (GPIO36, active low) is turned on as on the WiFi LoRa 32 V3, so the board's 3.3 V rail
  // behaves the same on both.
  gpio_set_level(GPIO_NUM_36, 0);
  gpio_set_direction(GPIO_NUM_36, GPIO_MODE_OUTPUT);
}
