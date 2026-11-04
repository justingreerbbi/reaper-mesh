#include "reaper/session.hpp"
#include "nvs_storage.hpp"
#include "status_display.hpp"
#include "board_input.hpp"
#include "board_power.hpp"
#include "device_ui.hpp"
#include "ble_link.hpp"
#include "reaper/host_links.hpp"
#include "reaper/version.hpp"
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
static BleLink ble;
bool write_link(d::HostLink link, const std::uint8_t* data, std::size_t size, void*) {
  if (link == d::HostLink::Ble)
    return ble.write(data, size);
  return uart_write_bytes(kUart, data, size) == static_cast<int>(size) &&
         uart_wait_tx_done(kUart, pdMS_TO_TICKS(500)) == ESP_OK;
}
const char* radio_state(const d::RadioInfo& info) {
  auto is = [&](const char* state) {
    return info.state.length == std::strlen(state) &&
           !std::memcmp(info.state.bytes.data(), state, info.state.length);
  };
  return is("receiving") ? "RX" : is("transmitting") ? "TX" : is("fault") ? "FAULT" : "OFF";
}
const char* mode_name(d::RadioMode mode) {
  return mode == d::RadioMode::Mesh ? "MESH" : mode == d::RadioMode::Receive ? "RECV" : "OFF";
}
template <std::size_t N>
void copy_text(const d::Text<N>& value, char (&out)[N + 1]) {
  std::memcpy(out, value.bytes.data(), value.length);
  out[value.length] = 0;
}
void halt() {
  for (;;)
    vTaskDelay(pdMS_TO_TICKS(1000));
}
}  // namespace

// The firmware's own task. Bluetooth reserves early memory on the classic ESP32, so the startup
// task cannot get a stack this large: the rest of the heap only becomes usable after it exists.
static void run(void*) {
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
  static BoardInput buttons;
  buttons.begin();
  static BoardPower power;
  static reaper::ui::ButtonGestures gestures;
  static reaper::ui::Screen screen;
  static reaper::ui::Frame frame;
  screen.start(static_cast<std::uint64_t>(esp_timer_get_time() / 1000));
  std::uint64_t node = 0;
  for (auto byte : mac)
    node = (node << 8) | byte;
  static MeshService mesh(messages, inbox, radio_info, device, random, node,
                          reaper::board::kUsBandOwnerConfirmed && reaper::board::kAntennaVerified);
  static d::Session session(authority, device, boot, &messages, &radio_info, &inbox,
                            &mesh.discovery(), &ble);
  static d::HostLinks links(session, write_link, nullptr);
  mesh.begin();
  ble.begin();
  std::int64_t next_display = 0;
  std::array<std::uint8_t, 256> input{};
  for (;;) {
    session.tick(static_cast<std::uint64_t>(esp_timer_get_time() / 1000));
    uart_event_t event{};
    if (xQueueReceive(events, &event, pdMS_TO_TICKS(10))) {
      if (event.type == UART_DATA) {
        for (;;) {
          const int size = uart_read_bytes(kUart, input.data(), input.size(), 0);
          if (size <= 0)
            break;
          links.feed(d::HostLink::Usb, input.data(), static_cast<std::size_t>(size),
                     static_cast<std::uint64_t>(esp_timer_get_time() / 1000));
        }
      } else if (event.type == UART_FIFO_OVF || event.type == UART_BUFFER_FULL ||
                 event.type == UART_PARITY_ERR || event.type == UART_FRAME_ERR) {
        uart_flush_input(kUart);
        xQueueReset(events);
        links.closed(d::HostLink::Usb);
      }
    }
    links.tick(static_cast<std::uint64_t>(esp_timer_get_time() / 1000));
    ble.tick(static_cast<std::uint64_t>(esp_timer_get_time() / 1000), links);
    d::Snapshot current{};
    const bool storage_ok = authority.snapshot(current);
    mesh.tick(storage_ok ? &current : nullptr,
              static_cast<std::uint64_t>(esp_timer_get_time() / 1000));
    radio_info.heap_free = esp_get_free_heap_size();
    radio_info.stack_free = uxTaskGetStackHighWaterMark(nullptr);  // ESP-IDF reports bytes.
    const auto now = esp_timer_get_time();
    const auto now_ms = static_cast<std::uint64_t>(now / 1000);
    switch (gestures.sample(buttons.main_pressed(), now_ms)) {
      case reaper::ui::Press::Single:
        screen.input(reaper::ui::Input::Toggle, now_ms);
        break;
      case reaper::ui::Press::Double:
        screen.input(reaper::ui::Input::NextPage, now_ms);
        break;
      case reaper::ui::Press::Long:
        screen.input(reaper::ui::Input::Home, now_ms);
        break;
      case reaper::ui::Press::PairHold:
        ble.hold(now_ms);
        break;
      case reaper::ui::Press::ForgetHold:
        ble.forget(now_ms);
        break;
      case reaper::ui::Press::None:
        break;
    }
    if (buttons.take_next_page(now_ms))
      screen.input(reaper::ui::Input::NextPage, now_ms);
    if (storage_ok)
      screen.settings(current.settings.screen.timeout * 1000ull, current.settings.screen.wake);
    screen.inbox(inbox.latest(), now_ms);
    const auto ble_status = ble.status(now_ms);
    if (ble_status.notice != reaper::ui::BleNotice::None)
      screen.attention(now_ms);
    screen.tick(now_ms);
    if (now >= next_display) {
      // At most ten frames a second; show() skips frames that did not change.
      next_display = now + 100000;
      display.power(screen.on());
      if (screen.on()) {
        d::Snapshot snapshot{};
        const bool healthy = authority.snapshot(snapshot);
        static char label[65];
        static char peer_names[5][65];
        copy_text(snapshot.settings.label, label);
        reaper::ui::Status status;
        status.name = label;
        status.node = device_string;
        status.version = d::kDisplayVersion;
        status.radio = radio_state(radio_info);
        const auto battery = power.read(now_ms);
        status.battery = battery.percent;
        status.external = battery.external;
        status.rx = radio_info.received;
        status.tx = radio_info.transmitted;
        const auto& discovery = mesh.discovery();
        status.nodes = static_cast<std::uint32_t>(discovery.count());
        for (std::size_t i = 0; i < status.rows.size(); ++i) {
          const auto* peer = discovery.peer(i);
          if (!peer)
            break;
          if (peer->name.length)
            copy_text(peer->name, peer_names[i]);
          else
            std::snprintf(peer_names[i], sizeof(peer_names[i]), "node-%016llx",
                          static_cast<unsigned long long>(peer->key.origin));
          status.rows[i].name = peer_names[i];
          status.rows[i].age_s =
              static_cast<std::uint32_t>(now_ms > peer->seen ? (now_ms - peer->seen) / 1000 : 0);
          status.rows[i].position = peer->position.source != 0;
          status.row_count = i + 1;
        }
        status.ble = ble_status;
        status.usb = !healthy                                ? "USB BLOCKED"
                     : links.ready(d::HostLink::Usb, now_ms) ? "USB READY"
                     : links.ready(d::HostLink::Ble, now_ms) ? "BLE READY"
                                                             : "USB IDLE";
        status.storage_ok = healthy;
        status.revision = snapshot.revision;
        status.mode = mode_name(snapshot.settings.radio.mode);
        status.power_dbm =
            MeshService::Driver::dbm(snapshot.settings.radio.level, snapshot.settings.radio.boost);
        status.heap = radio_info.heap_free;
        status.stack = radio_info.stack_free;
        status.uptime_s = now_ms / 1000;
        reaper::ui::render(screen, status, frame);
        display.show(frame);
      }
    }
    vTaskDelay(1);  // Yield even under continuous malformed input; keep the idle watchdog healthy.
  }
}

extern "C" void app_main() {
  constexpr std::uint32_t kStackBytes = 24576;
  if (xTaskCreatePinnedToCore(run, "reaper", kStackBytes, nullptr, uxTaskPriorityGet(nullptr),
                              nullptr, xPortGetCoreID()) != pdPASS)
    halt();
}
