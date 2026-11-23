// Phase 0 bench spike for the signals add-on (D60): checks what the XIAO ESP32-C5 actually hears.
// Listen-only. It never transmits Wi-Fi frames, the capture filter delivers management frames
// only (data frames never reach this code), and Bluetooth scanning is passive, so no scan
// requests are sent. It prints counts, never addresses or network names: one JSON object a line.
#include <inttypes.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>
#include "esp_event.h"
#include "esp_idf_version.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "host/ble_gap.h"
#include "host/ble_hs.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"

#define DWELL_MS 250
#define BLE_MS 6000
#define COEX_MS 5000
#define MAX_APS 192
#define MAX_BLE 256

static const uint8_t kChannels24[] = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11};
static const uint8_t kChannels5[] = {36,  40,  44,  48,  52,  56,  60,  64,  100,
                                     104, 108, 112, 116, 120, 124, 128, 132, 136,
                                     140, 144, 149, 153, 157, 161, 165};

static portMUX_TYPE lock = portMUX_INITIALIZER_UNLOCKED;

typedef struct {
  uint32_t frames, beacons, probe_req, probe_resp, action, nan, rid;
  int8_t best;
} wifi_counts_t;
typedef struct {
  uint8_t bssid[6];
  uint8_t channel;
} ap_t;
static wifi_counts_t wifi;
static ap_t aps[MAX_APS];
static int ap_count;
static uint32_t ap_overflow;
static uint8_t listening;

typedef struct {
  uint32_t reports, legacy, extended, phy1m, coded, rid, incomplete;
  int8_t best;
} ble_counts_t;
static ble_counts_t ble;
static ble_addr_t seen[MAX_BLE];
static int seen_count;
static volatile bool ble_ready;

static int64_t now_ms(void) {
  return esp_timer_get_time() / 1000;
}

// Remote ID over a Wi-Fi beacon: a vendor IE with the ASTM OUI FA:0B:BC and type 0x0D.
static bool has_rid_ie(const uint8_t* ies, int length) {
  for (int i = 0; i + 2 <= length;) {
    const int id = ies[i], size = ies[i + 1];
    if (i + 2 + size > length)
      return false;
    if (id == 221 && size >= 4 && ies[i + 2] == 0xfa && ies[i + 3] == 0x0b && ies[i + 4] == 0xbc &&
        ies[i + 5] == 0x0d)
      return true;
    i += 2 + size;
  }
  return false;
}

static void remember_ap(const uint8_t* bssid) {
  for (int i = 0; i < ap_count; ++i)
    if (aps[i].channel == listening && !memcmp(aps[i].bssid, bssid, 6))
      return;
  if (ap_count == MAX_APS) {
    ++ap_overflow;
    return;
  }
  memcpy(aps[ap_count].bssid, bssid, 6);
  aps[ap_count++].channel = listening;
}

static void on_frame(void* buffer, wifi_promiscuous_pkt_type_t type) {
  if (type != WIFI_PKT_MGMT)
    return;
  const wifi_promiscuous_pkt_t* packet = buffer;
  const uint8_t* frame = packet->payload;
  const int length = packet->rx_ctrl.sig_len - 4;  // Without the FCS.
  if (length < 24)
    return;
  const int subtype = (frame[0] >> 4) & 15;
  portENTER_CRITICAL(&lock);
  ++wifi.frames;
  if (packet->rx_ctrl.rssi > wifi.best)
    wifi.best = packet->rx_ctrl.rssi;
  if (subtype == 8 || subtype == 5) {
    if (subtype == 8)
      ++wifi.beacons;
    else
      ++wifi.probe_resp;
    remember_ap(frame + 16);
    if (length > 36 && has_rid_ie(frame + 36, length - 36))
      ++wifi.rid;
  } else if (subtype == 4) {
    ++wifi.probe_req;
  } else if (subtype == 13) {
    ++wifi.action;
    // Public action, vendor specific, Wi-Fi Alliance OUI 50:6F:9A, type 0x13: a NAN frame.
    if (length >= 30 && frame[24] == 4 && frame[25] == 9 && frame[26] == 0x50 &&
        frame[27] == 0x6f && frame[28] == 0x9a && frame[29] == 0x13)
      ++wifi.nan;
  }
  portEXIT_CRITICAL(&lock);
}

static wifi_counts_t take_wifi(void) {
  portENTER_CRITICAL(&lock);
  const wifi_counts_t copy = wifi;
  memset(&wifi, 0, sizeof(wifi));
  wifi.best = -128;
  portEXIT_CRITICAL(&lock);
  return copy;
}

static int aps_on(int low, int high) {
  int count = 0;
  portENTER_CRITICAL(&lock);
  for (int i = 0; i < ap_count; ++i)
    if (aps[i].channel >= low && aps[i].channel <= high)
      ++count;
  portEXIT_CRITICAL(&lock);
  return count;
}

static void stage(const char* name);

static bool listen_on(uint8_t channel) {
  listening = channel;
  return esp_wifi_set_channel(channel, WIFI_SECOND_CHAN_NONE) == ESP_OK;
}

static void wifi_start(void) {
  stage("wifi-init");
  ESP_ERROR_CHECK(esp_event_loop_create_default());
  wifi_init_config_t config = WIFI_INIT_CONFIG_DEFAULT();
  config.nvs_enable = 0;
  ESP_ERROR_CHECK(esp_wifi_init(&config));
  ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));
  ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_NULL));
  ESP_ERROR_CHECK(esp_wifi_set_country_code("US", false));
  ESP_ERROR_CHECK(esp_wifi_start());
  const esp_err_t band = esp_wifi_set_band_mode(WIFI_BAND_MODE_AUTO);
  printf("{\"t\":\"wifi-init\",\"bandMode\":\"%s\"}\n", esp_err_to_name(band));
  const wifi_promiscuous_filter_t filter = {.filter_mask = WIFI_PROMIS_FILTER_MASK_MGMT};
  ESP_ERROR_CHECK(esp_wifi_set_promiscuous_filter(&filter));
  ESP_ERROR_CHECK(esp_wifi_set_promiscuous_rx_cb(on_frame));
}

static void sniff(bool on) {
  ESP_ERROR_CHECK(esp_wifi_set_promiscuous(on));
}

static void sweep(int cycle) {
  portENTER_CRITICAL(&lock);
  ap_count = 0;
  ap_overflow = 0;
  portEXIT_CRITICAL(&lock);
  sniff(true);
  const uint8_t* lists[] = {kChannels24, kChannels5};
  const size_t sizes[] = {sizeof(kChannels24), sizeof(kChannels5)};
  for (int band = 0; band < 2; ++band) {
    for (size_t i = 0; i < sizes[band]; ++i) {
      const uint8_t channel = lists[band][i];
      const bool ok = listen_on(channel);
      take_wifi();
      vTaskDelay(pdMS_TO_TICKS(DWELL_MS));
      const wifi_counts_t c = take_wifi();
      printf("{\"t\":\"wifi\",\"cycle\":%d,\"ch\":%u,\"ok\":%s,\"frames\":%" PRIu32
             ",\"beacons\":%" PRIu32 ",\"probeReq\":%" PRIu32 ",\"probeResp\":%" PRIu32
             ",\"action\":%" PRIu32 ",\"nan\":%" PRIu32 ",\"rid\":%" PRIu32
             ",\"aps\":%d,\"best\":%d}\n",
             cycle, channel, ok ? "true" : "false", c.frames, c.beacons, c.probe_req, c.probe_resp,
             c.action, c.nan, c.rid, aps_on(channel, channel), c.frames ? c.best : 0);
    }
  }
  sniff(false);
  printf("{\"t\":\"sweep\",\"cycle\":%d,\"aps24\":%d,\"aps5\":%d,\"overflow\":%" PRIu32
         ",\"dwellMs\":%d}\n",
         cycle, aps_on(1, 14), aps_on(32, 177), ap_overflow, DWELL_MS);
}

static bool rid_service_data(const uint8_t* data, int length) {
  // Remote ID over Bluetooth: 16-bit service data for UUID 0xFFFA with application code 0x0D.
  for (int i = 0; i + 1 < length;) {
    const int size = data[i];
    if (!size || i + 1 + size > length)
      return false;
    if (data[i + 1] == 0x16 && size >= 4 && data[i + 2] == 0xfa && data[i + 3] == 0xff &&
        data[i + 4] == 0x0d)
      return true;
    i += 1 + size;
  }
  return false;
}

static int on_gap(struct ble_gap_event* event, void* arg) {
  (void)arg;
  if (event->type != BLE_GAP_EVENT_EXT_DISC)
    return 0;
  const struct ble_gap_ext_disc_desc* d = &event->ext_disc;
  portENTER_CRITICAL(&lock);
  ++ble.reports;
  if (d->props & BLE_HCI_ADV_LEGACY_MASK)
    ++ble.legacy;
  else
    ++ble.extended;
  if (d->prim_phy == BLE_HCI_LE_PHY_CODED)
    ++ble.coded;
  else
    ++ble.phy1m;
  if (d->data_status != BLE_GAP_EXT_ADV_DATA_STATUS_COMPLETE)
    ++ble.incomplete;
  if (d->rssi != 127 && d->rssi > ble.best)
    ble.best = d->rssi;
  if (rid_service_data(d->data, d->length_data))
    ++ble.rid;
  bool known = false;
  for (int i = 0; i < seen_count && !known; ++i)
    known = !ble_addr_cmp(&seen[i], &d->addr);
  if (!known && seen_count < MAX_BLE)
    seen[seen_count++] = d->addr;
  portEXIT_CRITICAL(&lock);
  return 0;
}

static void ble_scan(bool uncoded, bool coded) {
  portENTER_CRITICAL(&lock);
  memset(&ble, 0, sizeof(ble));
  ble.best = -128;
  seen_count = 0;
  portEXIT_CRITICAL(&lock);
  // Equal interval and window: listen all the time on each PHY asked for.
  const struct ble_gap_ext_disc_params params = {.itvl = 0x60, .window = 0x60, .passive = 1};
  const int rc = ble_gap_ext_disc(BLE_OWN_ADDR_PUBLIC, 0, 0, 0, 0, 0, uncoded ? &params : NULL,
                                  coded ? &params : NULL, on_gap, NULL);
  if (rc)
    printf("{\"t\":\"error\",\"what\":\"ble_gap_ext_disc\",\"rc\":%d}\n", rc);
}

static ble_counts_t ble_stop(int* unique) {
  ble_gap_disc_cancel();
  portENTER_CRITICAL(&lock);
  const ble_counts_t copy = ble;
  *unique = seen_count;
  portEXIT_CRITICAL(&lock);
  return copy;
}

static void print_ble(const char* label, int cycle, int ms, ble_counts_t c, int unique) {
  printf("{\"t\":\"ble\",\"run\":\"%s\",\"cycle\":%d,\"ms\":%d,\"reports\":%" PRIu32
         ",\"legacy\":%" PRIu32 ",\"extended\":%" PRIu32 ",\"phy1m\":%" PRIu32 ",\"coded\":%" PRIu32
         ",\"incomplete\":%" PRIu32 ",\"rid\":%" PRIu32 ",\"devices\":%d,\"best\":%d}\n",
         label, cycle, ms, c.reports, c.legacy, c.extended, c.phy1m, c.coded, c.incomplete, c.rid,
         unique, c.reports ? c.best : 0);
}

static void ble_run(const char* label, int cycle, bool uncoded, bool coded, int ms) {
  ble_scan(uncoded, coded);
  vTaskDelay(pdMS_TO_TICKS(ms));
  int unique = 0;
  const ble_counts_t c = ble_stop(&unique);
  print_ble(label, cycle, ms, c, unique);
}

// The same channel and the same Bluetooth scan, apart and then together.
static void coexistence(int cycle) {
  listen_on(6);
  sniff(true);
  take_wifi();
  vTaskDelay(pdMS_TO_TICKS(COEX_MS));
  const wifi_counts_t alone = take_wifi();
  ble_scan(true, false);
  vTaskDelay(pdMS_TO_TICKS(COEX_MS));
  int unique = 0;
  const wifi_counts_t together = take_wifi();
  const ble_counts_t ble_together = ble_stop(&unique);
  sniff(false);
  print_ble("coex-together", cycle, COEX_MS, ble_together, unique);
  ble_run("coex-alone", cycle, true, false, COEX_MS);
  printf("{\"t\":\"coex\",\"cycle\":%d,\"ch\":6,\"ms\":%d,\"wifiAlone\":%" PRIu32
         ",\"wifiTogether\":%" PRIu32 "}\n",
         cycle, COEX_MS, alone.frames, together.frames);
}

static void on_sync(void) {
  ble_ready = true;
}

static void host_task(void* arg) {
  (void)arg;
  nimble_port_run();
  nimble_port_freertos_deinit();
}

static void stage(const char* name) {
  printf("{\"t\":\"stage\",\"name\":\"%s\",\"uptimeMs\":%" PRId64 "}\n", name, now_ms());
}

void app_main(void) {
  // Give a host time to reopen the port after the reset, so the first lines are not lost.
  vTaskDelay(pdMS_TO_TICKS(3000));
  printf("{\"t\":\"boot\",\"reset\":%d,\"idf\":\"%s\",\"uptimeMs\":%" PRId64 "}\n",
         (int)esp_reset_reason(), esp_get_idf_version(), now_ms());
  wifi_start();
  stage("wifi-started");
  ESP_ERROR_CHECK(nimble_port_init());
  stage("nimble-init");
  ble_hs_cfg.sync_cb = on_sync;
  nimble_port_freertos_init(host_task);
  for (int waited = 0; !ble_ready; waited += 10) {
    vTaskDelay(pdMS_TO_TICKS(10));
    if (waited && waited % 2000 == 0)
      stage("waiting-for-ble-sync");
  }
  printf("{\"t\":\"ready\",\"uptimeMs\":%" PRId64 "}\n", now_ms());
  for (int cycle = 1;; ++cycle) {
    const int64_t start = now_ms();
    sweep(cycle);
    ble_run("both-phys", cycle, true, true, BLE_MS);
    ble_run("coded-only", cycle, false, true, BLE_MS);
    coexistence(cycle);
    printf("{\"t\":\"cycle\",\"cycle\":%d,\"ms\":%" PRId64 ",\"heapFree\":%" PRIu32 "}\n", cycle,
           now_ms() - start, esp_get_free_heap_size());
  }
}
