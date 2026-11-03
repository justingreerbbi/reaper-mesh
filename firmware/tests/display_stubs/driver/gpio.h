#pragma once
inline constexpr int GPIO_NUM_17 = 17, GPIO_NUM_18 = 18, GPIO_NUM_21 = 21, GPIO_NUM_36 = 36,
                     GPIO_MODE_OUTPUT = 1;
inline int gpio_set_level(int, int) {
  return 0;
}
inline int gpio_set_direction(int, int) {
  return 0;
}
