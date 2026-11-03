#include "reaper/session.hpp"
#include "nvs_storage.hpp"
#include "status_display.hpp"
#include "mesh_service.hpp"
#ifdef REAPER_TBEAM_V12
#include "tbeam_profile.hpp"
#else
#include "board_profile.hpp"
#endif
#include "driver/uart.h"
#include "driver/gpio.h"
#include "esp_mac.h"
#include "esp_random.h"
#include "bootloader_random.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_timer.h"
#include "esp_system.h"
#include <cstdio>
#include <cstring>

namespace p = reaper::protocol;
namespace d = reaper::device;
namespace {
constexpr auto kUart = UART_NUM_0;
#ifdef REAPER_TBEAM_V12
constexpr int kTx = 1, kRx = 3;
#else
constexpr int kTx = 43, kRx = 44;
#endif
static p::FrameDecoder decoder;
static p::Message reply;
static std::int64_t last_reply = 0;
static std::array<std::uint8_t, p::kMaxEncoded + 1> output;
bool write_frame(const p::Message& message) {
  std::size_t size = 0;
  return p::encode_frame(message, output.data(), output.size(), size) &&
         uart_write_bytes(kUart, output.data(), size) == static_cast<int>(size) &&
         uart_wait_tx_done(kUart, pdMS_TO_TICKS(500)) == ESP_OK;
}
void received(const p::Message& request, void* context) {
  auto& session = *static_cast<d::Session*>(context);
  if (session.handle(request, reply)) {
    if (!write_frame(reply)) {
      session.reset();
      return;
    }
    last_reply = esp_timer_get_time();
  }
  if (session.take_error(reply))
    write_frame(reply);
}
const char* radio_line(const d::RadioInfo& info) {
  auto is = [&](const char* state) {
    return info.state.length == std::strlen(state) &&
           !std::memcmp(info.state.bytes.data(), state, info.state.length);
  };
  return is("receiving")      ? "RADIO RX"
         : is("transmitting") ? "RADIO TX"
         : is("fault")        ? "RADIO FAULT"
                              : "RADIO OFF";
}
void halt() {
  for (;;)
    vTaskDelay(pdMS_TO_TICKS(1000));
}
}  // namespace

extern "C" void app_main() {
  // Hold the board radio in reset until its adapter initializes.
#ifdef REAPER_TBEAM_V12
  constexpr auto reset_pin = GPIO_NUM_23;
#else
  constexpr auto reset_pin = GPIO_NUM_12;
#endif
  gpio_set_level(reset_pin, 0);
  if (gpio_set_direction(reset_pin, GPIO_MODE_OUTPUT) != ESP_OK)
    halt();
  uart_config_t uart{};
  uart.baud_rate = 115200;
  uart.data_bits = UART_DATA_8_BITS;
  uart.parity = UART_PARITY_DISABLE;
  uart.stop_bits = UART_STOP_BITS_1;
  uart.flow_ctrl = UART_HW_FLOWCTRL_DISABLE;
  uart.source_clk = UART_SCLK_DEFAULT;
  QueueHandle_t events = nullptr;
  if (uart_param_config(kUart, &uart) != ESP_OK ||
      uart_set_pin(kUart, kTx, kRx, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE) != ESP_OK ||
      uart_driver_install(kUart, 4096, 4096, 16, &events, 0) != ESP_OK)
    halt();
  const std::uint8_t delimiter = 0;
  uart_write_bytes(kUart, &delimiter, 1);  // Align after unavoidable ROM startup output.

  // Use the non-RF entropy source before ADC/radio use. No radio is initialized.
  std::array<std::uint8_t, 16> random{};
  bootloader_random_enable();
  esp_fill_random(random.data(), random.size());
  bootloader_random_disable();
  char boot_string[33]{};
  for (std::size_t i = 0; i < random.size(); ++i)
    std::snprintf(boot_string + 2 * i, 3, "%02x", random[i]);
  std::array<std::uint8_t, 6> mac{};
  if (esp_efuse_mac_get_default(mac.data()) != ESP_OK)
    halt();
  char device_string[32]{};
#ifdef REAPER_TBEAM_V12
  std::snprintf(device_string, sizeof(device_string), "node-0000%02x%02x%02x%02x%02x%02x",
#else
  std::snprintf(device_string, sizeof(device_string), "heltec-%02x%02x%02x%02x%02x%02x",
#endif
                mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  d::Text<64> boot{}, device{};
  boot.assign(reinterpret_cast<const std::uint8_t*>(boot_string), 32);
  std::size_t device_length = 0;
  while (device_string[device_length])
    ++device_length;
  device.assign(reinterpret_cast<const std::uint8_t*>(device_string), device_length);
  static NvsStorage storage;
  static d::Configuration authority(storage, boot);
  static d::MessageQueue messages(boot);
  static d::Inbox inbox;
  static d::RadioInfo radio_info;
  static StatusDisplay display;
  display.begin();
  std::uint64_t node = 0;
  for (auto byte : mac)
    node = (node << 8) | byte;
  static MeshService mesh(messages, inbox, radio_info, device, random, node,
                          reaper::board::kUsBandOwnerConfirmed && reaper::board::kAntennaVerified);
  static d::Session session(authority, device, boot, &messages, &radio_info, &inbox,
                            &mesh.discovery());
  mesh.begin();
  std::int64_t next_display = 0;
  std::array<std::uint8_t, 256> input{};
  std::int64_t last_read = 0;
  for (;;) {
    session.tick(static_cast<std::uint64_t>(esp_timer_get_time() / 1000));
    uart_event_t event{};
    if (xQueueReceive(events, &event, pdMS_TO_TICKS(10))) {
      if (event.type == UART_DATA) {
        for (;;) {
          const int size = uart_read_bytes(kUart, input.data(), input.size(), 0);
          if (size <= 0)
            break;
          last_read = esp_timer_get_time();
          decoder.feed(input.data(), static_cast<std::size_t>(size), received, &session);
        }
      } else if (event.type == UART_FIFO_OVF || event.type == UART_BUFFER_FULL ||
                 event.type == UART_PARITY_ERR || event.type == UART_FRAME_ERR) {
        uart_flush_input(kUart);
        xQueueReset(events);
        decoder.reset();
        session.reset();
      }
    }
    if (decoder.buffered_bytes() && esp_timer_get_time() - last_read > 1000000) {
      decoder.reset();
      session.reset();
    }
    d::Snapshot current{};
    const bool storage_ok = authority.snapshot(current);
    mesh.tick(storage_ok ? &current : nullptr,
              static_cast<std::uint64_t>(esp_timer_get_time() / 1000));
    radio_info.heap_free = esp_get_free_heap_size();
    radio_info.stack_free = uxTaskGetStackHighWaterMark(nullptr);  // ESP-IDF reports bytes.
    const auto now = esp_timer_get_time();
    if (now >= next_display) {
      next_display = now + 500000;
      d::Snapshot snapshot{};
      const bool healthy = authority.snapshot(snapshot);
      display.update(
          session.synchronized() && now - last_reply < 8000000 ? "USB READY" : "USB IDLE", healthy,
          snapshot.revision, radio_line(radio_info));
    }
    vTaskDelay(1);  // Yield even under continuous malformed input; keep the idle watchdog healthy.
  }
}
