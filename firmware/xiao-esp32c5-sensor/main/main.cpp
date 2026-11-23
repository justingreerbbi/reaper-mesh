// The signals add-on firmware for the Seeed Studio XIAO ESP32-C5 (D60). It listens to Wi-Fi on
// 2.4 and 5 GHz, Bluetooth LE and drone Remote ID, and reports to an app over USB with the sensor
// protocol. It only listens: it never transmits Wi-Fi frames, its capture filter delivers
// management frames only, and Bluetooth scanning is passive. All parsing, tables, scheduling and
// protocol handling are in components/reaper_sensor, which host tests cover; this file connects
// the radios and USB to it.
#include <atomic>
#include <cstdio>
#include <cstring>
#include "driver/usb_serial_jtag.h"
#include "esp_event.h"
#include "esp_mac.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "host/ble_gap.h"
#include "host/ble_hs.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "reaper/sensor_scan.hpp"

namespace s = reaper::sensor;

namespace {
constexpr const char* kFirmware = "xiaoc5-reaper-sensor-v0.1.0";
constexpr std::uint32_t kCapabilities =
    s::capability::kWifi24 | s::capability::kWifi5 | s::capability::kBluetooth |
    s::capability::kBluetoothLongRange | s::capability::kRemoteId | s::capability::kProbeCapture;
constexpr std::uint64_t kStatusMs = 2000;
// USB is fast; this keeps one busy area from flooding the app.
constexpr std::uint32_t kReportBytesPerSecond = 8000;
constexpr std::size_t kQueueDepth = 24;

QueueHandle_t observations;
std::atomic<std::uint8_t> listening{6};
std::atomic<std::uint32_t> queue_drops{0};
std::atomic<bool> ble_ready{false};

std::uint64_t now_ms() {
  return static_cast<std::uint64_t>(esp_timer_get_time() / 1000);
}

void queue(const s::Observation& observation) {
  if (xQueueSend(observations, &observation, 0) != pdTRUE)
    ++queue_drops;
}

// Runs in the Wi-Fi task. Only management frames arrive (see the filter in start_wifi).
void on_frame(void* buffer, wifi_promiscuous_pkt_type_t type) {
  if (type != WIFI_PKT_MGMT)
    return;
  static s::Observation o;
  const auto* packet = static_cast<const wifi_promiscuous_pkt_t*>(buffer);
  const int length = static_cast<int>(packet->rx_ctrl.sig_len) - 4;  // Without the FCS.
  if (length < 24 || !s::parse_wifi(packet->payload, static_cast<std::size_t>(length), o.wifi))
    return;
  if (o.wifi.kind == s::WifiFrame::Kind::Nan && !o.wifi.remote_id.present)
    return;
  o.kind = o.wifi.kind == s::WifiFrame::Kind::ProbeRequest ? s::Observation::Kind::WifiProbe
                                                           : s::Observation::Kind::WifiAp;
  o.at_ms = now_ms();
  o.address = o.wifi.address;
  o.rssi = static_cast<std::int8_t>(packet->rx_ctrl.rssi);
  o.channel = listening.load();
  if (!s::valid_channel(o.channel, o.band))
    return;
  queue(o);
}

// Runs in the NimBLE host task.
int on_gap(ble_gap_event* event, void*) {
  if (event->type != BLE_GAP_EVENT_EXT_DISC)
    return 0;
  static s::Observation o;
  const auto& d = event->ext_disc;
  if (!s::parse_ble(d.data, d.length_data, o.ble))
    return 0;
  o.kind = s::Observation::Kind::Bluetooth;
  o.at_ms = now_ms();
  for (std::size_t i = 0; i < 6; ++i)  // NimBLE stores addresses least significant byte first.
    o.address[i] = d.addr.val[5 - i];
  o.rssi = d.rssi == 127 ? -128 : d.rssi;
  if (d.addr.type == BLE_ADDR_PUBLIC)
    o.address_type = 0;
  else  // Random: the top two bits say static (11), resolvable (01) or non-resolvable (00).
    o.address_type = (d.addr.val[5] >> 6) == 3 ? 1 : (d.addr.val[5] >> 6) == 1 ? 2 : 3;
  o.phy = d.prim_phy == BLE_HCI_LE_PHY_CODED ? s::Phy::Coded
          : d.sec_phy == BLE_HCI_LE_PHY_2M   ? s::Phy::Le2M
                                             : s::Phy::Le1M;
  queue(o);
  return 0;
}

void on_sync() {
  ble_ready = true;
}

void host_task(void*) {
  nimble_port_run();
  nimble_port_freertos_deinit();
}

void start_wifi() {
  ESP_ERROR_CHECK(esp_event_loop_create_default());
  wifi_init_config_t config = WIFI_INIT_CONFIG_DEFAULT();
  config.nvs_enable = 0;
  ESP_ERROR_CHECK(esp_wifi_init(&config));
  ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));
  ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_NULL));
  ESP_ERROR_CHECK(esp_wifi_set_country_code("US", false));
  ESP_ERROR_CHECK(esp_wifi_start());
  ESP_ERROR_CHECK(esp_wifi_set_band_mode(WIFI_BAND_MODE_AUTO));
  // Management frames only: data frames never reach this firmware.
  const wifi_promiscuous_filter_t filter = {.filter_mask = WIFI_PROMIS_FILTER_MASK_MGMT};
  ESP_ERROR_CHECK(esp_wifi_set_promiscuous_filter(&filter));
  ESP_ERROR_CHECK(esp_wifi_set_promiscuous_rx_cb(on_frame));
}

void start_bluetooth() {
  ESP_ERROR_CHECK(nimble_port_init());
  ble_hs_cfg.sync_cb = on_sync;
  nimble_port_freertos_init(host_task);
  while (!ble_ready)
    vTaskDelay(pdMS_TO_TICKS(10));
}

// Wi-Fi and Bluetooth never listen at the same time (see the Scheduler).
class Radio {
 public:
  void enter(const s::Slot& slot) {
    if (slot.kind == s::Slot::Kind::Wifi) {
      stop_bluetooth();
      listening = slot.channel;
      esp_wifi_set_channel(slot.channel, WIFI_SECOND_CHAN_NONE);
      if (!sniffing_) {
        esp_wifi_set_promiscuous(true);
        sniffing_ = true;
      }
      band_ = slot.band;
      channel_ = slot.channel;
      return;
    }
    if (sniffing_) {
      esp_wifi_set_promiscuous(false);
      sniffing_ = false;
    }
    if (!scanning_) {
      // Passive, so no scan requests are sent; both PHYs, so long range is heard too.
      const ble_gap_ext_disc_params params = {
          .itvl = 0x60, .window = 0x60, .passive = 1, .disable_observer_mode = 0};
      scanning_ = ble_gap_ext_disc(BLE_OWN_ADDR_PUBLIC, 0, 0, 0, 0, 0, &params, &params, on_gap,
                                   nullptr) == 0;
    }
  }
  s::Band band() const { return band_; }
  std::uint8_t channel() const { return sniffing_ ? channel_ : 0; }

 private:
  void stop_bluetooth() {
    if (scanning_) {
      ble_gap_disc_cancel();
      scanning_ = false;
    }
  }
  bool sniffing_ = false, scanning_ = false;
  s::Band band_ = s::Band::Ghz24;
  std::uint8_t channel_ = 0;
};

// usb_serial_jtag_is_connected() flaps on this board, so it is not used: a session lasts until
// the next hello (opening the port restarts the add-on), and a frame the host does not take
// within 20 ms is dropped and counted. The app's decoder discards a cut frame.
bool usb_write(const std::uint8_t* data, std::size_t size, void*) {
  return usb_serial_jtag_write_bytes(data, size, pdMS_TO_TICKS(20)) == static_cast<int>(size);
}

void text(s::Text64& out, const char* value) {
  out.assign(reinterpret_cast<const std::uint8_t*>(value), std::strlen(value));
}

// Large objects live here rather than on a task stack.
s::Scan scan;
s::Scheduler scheduler;
s::Observation drained;
}  // namespace

extern "C" void app_main() {
  observations = xQueueCreate(kQueueDepth, sizeof(s::Observation));
  usb_serial_jtag_driver_config_t usb = USB_SERIAL_JTAG_DRIVER_CONFIG_DEFAULT();
  usb.rx_buffer_size = 1024;
  usb.tx_buffer_size = 4096;
  ESP_ERROR_CHECK(usb_serial_jtag_driver_install(&usb));

  // The add-on is named from its MAC address; the boot ID is new on every start.
  std::uint8_t mac[6]{};
  esp_efuse_mac_get_default(mac);
  char sensor[20], boot[33];
  std::snprintf(sensor, sizeof(sensor), "sensor-%02x%02x%02x%02x%02x%02x", mac[0], mac[1], mac[2],
                mac[3], mac[4], mac[5]);
  std::uint8_t random[16];
  esp_fill_random(random, sizeof(random));
  for (std::size_t i = 0; i < sizeof(random); ++i)
    std::snprintf(boot + 2 * i, 3, "%02x", random[i]);
  s::Identity identity;
  text(identity.sensor, sensor);
  text(identity.boot, boot);
  text(identity.firmware, kFirmware);
  identity.capabilities = kCapabilities;
  static s::Session session(identity, usb_write, nullptr);

  start_wifi();
  start_bluetooth();
  scheduler.set(session.plan(), kCapabilities);
  scan.set_plan(session.plan());

  Radio radio;
  s::Budget budget(kReportBytesPerSecond);
  std::uint64_t slot_end = 0, next_status = 0;
  std::uint8_t input[256];
  for (;;) {
    const auto now = now_ms();
    const int read = usb_serial_jtag_read_bytes(input, sizeof(input), 0);
    if (read > 0)
      session.feed(input, static_cast<std::size_t>(read), now);
    if (session.take_started()) {
      scan.resend_all();
      next_status = now;
    }
    if (session.take_plan_changed()) {
      scheduler.set(session.plan(), kCapabilities);
      scan.set_plan(session.plan());
      slot_end = 0;
    }
    if (now >= slot_end) {
      const auto slot = scheduler.next();
      radio.enter(slot);
      slot_end = now + slot.duration_ms;
    }
    while (xQueueReceive(observations, &drained, 0) == pdTRUE)
      scan.observe(drained);
    scan.counters().dropped += queue_drops.exchange(0);
    if (session.active()) {
      if (now >= next_status) {
        next_status = now + kStatusMs;
        session.send(session.status(now, scan.counters(), radio.band(), radio.channel()));
      }
      s::Message report;
      while (budget.allows(now, 256) && scan.next(now, identity.boot, report)) {
        const auto size = session.send(report);
        if (!size) {
          ++scan.counters().dropped;
          break;
        }
        budget.spend(size);
      }
    }
    // One tick (10 ms at the default 100 Hz). pdMS_TO_TICKS(5) rounds to zero, which never
    // sleeps and starves the idle task (the task watchdog fired every 5 s).
    vTaskDelay(1);
  }
}
