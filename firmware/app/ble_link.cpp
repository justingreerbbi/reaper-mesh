#include "ble_link.hpp"
#include "reaper/pairing.hpp"
#include "esp_random.h"
#include "freertos/FreeRTOS.h"
#include "freertos/stream_buffer.h"
#include "host/ble_hs.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"
#include <algorithm>
#include <array>
#include <atomic>
#include <cstdio>
#include <cstring>

extern "C" void ble_store_config_init(void);

namespace d = reaper::device;
namespace ui = reaper::ui;
namespace {
constexpr std::size_t kBufferBytes = 4096, kMaxChunk = 244;
constexpr std::uint64_t kNoticeMs = 5000;
// 5d7e00NN-8b3a-4f6c-9e21-3c1a7f42b9d0: 01 service, 02 host to device, 03 device to host,
// 04 protected read that makes a client pair before it starts a session.
ble_uuid128_t uuid(std::uint8_t id) {
  ble_uuid128_t value{};
  value.u.type = BLE_UUID_TYPE_128;
  const std::uint8_t bytes[16] = {0xd0, 0xb9, 0x42, 0x7f, 0x1a, 0x3c, 0x21, 0x9e,
                                  0x6c, 0x4f, 0x3a, 0x8b, id,   0x00, 0x7e, 0x5d};
  std::memcpy(value.value, bytes, sizeof(bytes));
  return value;
}
ble_uuid128_t service_id, input_id, output_id, pair_id;
std::uint16_t output_handle = 0;

StreamBufferHandle_t input = nullptr, output = nullptr;
std::atomic<std::uint16_t> connection{BLE_HS_CONN_HANDLE_NONE};
std::atomic<std::uint16_t> att_mtu{BLE_ATT_MTU_DFLT};
std::atomic<bool> synced{false}, trusted{false}, subscribed{false};
std::atomic<bool> connected_event{false}, closed_event{false}, overflow_event{false};
std::atomic<bool> paired_event{false}, failed_event{false};
std::atomic<bool> window_open{false};
std::atomic<int> shown_passkey{-1};
std::atomic<std::size_t> bond_count{0};

bool available = false, started = false, address_set = false;
d::PairingWindow window;
std::uint64_t connected_at = 0, unavailable_until = 0;
std::array<std::uint8_t, 6> address{};
char advertised_name[16] = "Reaper";
enum class Advertising { Off, Paired, Pairing } advertising = Advertising::Off;
std::array<std::uint8_t, kMaxChunk> pending{};
std::size_t pending_size = 0;

void update_bonds() {
  int count = 0;
  bond_count = ble_store_util_count(BLE_STORE_OBJ_TYPE_PEER_SEC, &count) == 0
                   ? static_cast<std::size_t>(count)
                   : d::PairingWindow::kMaxBonds;  // Unknown: open nothing new.
}
// Lost or corrupt pairing data fails closed: the phone must pair again at the device.
bool store_address(bool fresh) {
  nvs_handle_t handle;
  if (nvs_open("reaper_ble", NVS_READWRITE, &handle) != ESP_OK)
    return false;
  std::size_t size = address.size();
  bool ok = !fresh && nvs_get_blob(handle, "address", address.data(), &size) == ESP_OK &&
            size == address.size();
  if (!ok) {
    // A random static address, so advertising does not reveal the MAC behind the node ID.
    esp_fill_random(address.data(), address.size());
    address[5] |= 0xc0;
    ok = nvs_set_blob(handle, "address", address.data(), address.size()) == ESP_OK &&
         nvs_commit(handle) == ESP_OK;
  }
  nvs_close(handle);
  std::snprintf(advertised_name, sizeof(advertised_name), "Reaper-%02X%02X", address[1],
                address[0]);
  return ok;
}
bool has_bonds() {
  nvs_handle_t handle;
  if (nvs_open("nimble_bond", NVS_READONLY, &handle) != ESP_OK)
    return false;
  // Only a stored peer key counts. The stack also keeps other records here after it has run.
  bool found = false;
  for (std::size_t index = 1; index <= d::PairingWindow::kMaxBonds && !found; ++index) {
    char key[16];
    std::snprintf(key, sizeof(key), "peer_sec_%u", static_cast<unsigned>(index));
    std::size_t size = 0;
    found = nvs_get_blob(handle, key, nullptr, &size) == ESP_OK && size > 0;
  }
  nvs_close(handle);
  return found;
}
d::LinkSecurity security(std::uint16_t handle, ble_addr_t* peer = nullptr) {
  ble_gap_conn_desc desc{};
  if (ble_gap_conn_find(handle, &desc) != 0)
    return {};
  if (peer)
    *peer = desc.peer_id_addr;
  return {desc.sec_state.encrypted != 0, desc.sec_state.authenticated != 0,
          desc.sec_state.bonded != 0, static_cast<std::uint8_t>(desc.sec_state.key_size)};
}
void refuse(std::uint16_t handle) {
  ble_gap_terminate(handle, BLE_ERR_AUTH_FAIL);
}
int on_passkey(const ble_gap_event& event) {
  const auto handle = event.passkey.conn_handle;
  // Without physical access nobody sees a passkey. Anything but a displayed passkey is refused.
  if (!window_open || event.passkey.params.action != BLE_SM_IOACT_DISP) {
    refuse(handle);
    return 0;
  }
  ble_sm_io io{};
  io.action = BLE_SM_IOACT_DISP;
  std::uint32_t key = 0;
  while (!d::passkey_from_random(esp_random(), key)) {
  }
  io.passkey = key;
  shown_passkey = static_cast<int>(key);
  if (ble_sm_inject_io(handle, &io) != 0)
    refuse(handle);
  return 0;
}
int on_encryption(const ble_gap_event& event) {
  const auto handle = event.enc_change.conn_handle;
  const bool pairing = shown_passkey >= 0;
  ble_addr_t peer{};
  const auto link = security(handle, &peer);
  if (event.enc_change.status == 0 && d::link_trusted(link)) {
    trusted = true;
    if (pairing) {
      shown_passkey = -1;
      paired_event = true;
    }
    update_bonds();
    return 0;
  }
  // Not good enough, for example Just Works: keep no keys from it and end the link.
  if (event.enc_change.status == 0 && link.bonded && !link.authenticated)
    ble_store_util_delete_peer(&peer);
  if (pairing) {
    shown_passkey = -1;
    failed_event = true;
  }
  update_bonds();
  refuse(handle);
  return 0;
}
int on_gap(ble_gap_event* event, void*) {
  switch (event->type) {
    case BLE_GAP_EVENT_CONNECT:
      if (event->connect.status == 0) {
        connection = event->connect.conn_handle;
        connected_event = true;
      }
      return 0;
    case BLE_GAP_EVENT_DISCONNECT:
      connection = BLE_HS_CONN_HANDLE_NONE;
      trusted = subscribed = false;
      att_mtu = BLE_ATT_MTU_DFLT;
      closed_event = true;
      return 0;
    case BLE_GAP_EVENT_PASSKEY_ACTION:
      return on_passkey(*event);
    case BLE_GAP_EVENT_ENC_CHANGE:
      return on_encryption(*event);
    case BLE_GAP_EVENT_REPEAT_PAIRING: {
      // A paired phone that lost its keys can pair again only with the window open. Otherwise an
      // impostor using a paired phone's address could replace or destroy its keys.
      if (!window_open)
        return BLE_GAP_REPEAT_PAIRING_IGNORE;
      ble_addr_t peer{};
      security(event->repeat_pairing.conn_handle, &peer);
      ble_store_util_delete_peer(&peer);
      return BLE_GAP_REPEAT_PAIRING_RETRY;
    }
    case BLE_GAP_EVENT_SUBSCRIBE:
      if (event->subscribe.attr_handle == output_handle)
        subscribed = event->subscribe.cur_notify != 0;
      return 0;
    case BLE_GAP_EVENT_MTU:
      att_mtu = event->mtu.value;
      return 0;
    default:
      return 0;
  }
}
int on_access(std::uint16_t handle, std::uint16_t, ble_gatt_access_ctxt* context, void* arg) {
  // The characteristic flags already demand this; the check keeps the rule in one visible place.
  if (!d::link_trusted(security(handle)))
    return BLE_ATT_ERR_INSUFFICIENT_AUTHEN;
  if (context->op == BLE_GATT_ACCESS_OP_READ_CHR) {
    const std::uint8_t version = 1;
    return os_mbuf_append(context->om, &version, sizeof(version)) == 0
               ? 0
               : BLE_ATT_ERR_INSUFFICIENT_RES;
  }
  if (context->op != BLE_GATT_ACCESS_OP_WRITE_CHR || arg)
    return BLE_ATT_ERR_UNLIKELY;
  std::array<std::uint8_t, BLE_ATT_ATTR_MAX_LEN> bytes;
  std::uint16_t size = 0;
  if (ble_hs_mbuf_to_flat(context->om, bytes.data(), bytes.size(), &size) != 0)
    return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
  if (xStreamBufferSpacesAvailable(input) < size) {
    overflow_event = true;
    return BLE_ATT_ERR_INSUFFICIENT_RES;
  }
  xStreamBufferSend(input, bytes.data(), size, 0);
  return 0;
}
ble_gatt_chr_def characteristics[4]{};
ble_gatt_svc_def services[2]{};
bool register_service() {
  service_id = uuid(1);
  input_id = uuid(2);
  output_id = uuid(3);
  pair_id = uuid(4);
  characteristics[0].uuid = &input_id.u;
  characteristics[0].access_cb = on_access;
  characteristics[0].flags = BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_WRITE_AUTHEN;
  characteristics[0].min_key_size = 16;
  characteristics[1].uuid = &output_id.u;
  characteristics[1].access_cb = on_access;
  characteristics[1].flags = BLE_GATT_CHR_F_NOTIFY;
  characteristics[1].val_handle = &output_handle;
  characteristics[2].uuid = &pair_id.u;
  characteristics[2].access_cb = on_access;
  characteristics[2].flags = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_READ_AUTHEN;
  characteristics[2].min_key_size = 16;
  services[0].type = BLE_GATT_SVC_TYPE_PRIMARY;
  services[0].uuid = &service_id.u;
  services[0].characteristics = characteristics;
  return ble_gatts_count_cfg(services) == 0 && ble_gatts_add_svcs(services) == 0;
}
void host_task(void*) {
  nimble_port_run();
  nimble_port_freertos_deinit();
}
// A full list refuses new pairings; the default handler would evict an existing phone.
int on_store_status(ble_store_status_event*, void*) {
  return BLE_HS_ESTORE_CAP;
}
bool start_stack() {
  if (started)
    return true;
  if (!available)
    return false;
  input = xStreamBufferCreate(kBufferBytes, 1);
  output = xStreamBufferCreate(kBufferBytes, 1);
  if (!input || !output || nimble_port_init() != ESP_OK) {
    available = false;
    return false;
  }
  ble_hs_cfg.sync_cb = [] {
    update_bonds();
    synced = true;
  };
  ble_hs_cfg.reset_cb = [](int) {
    synced = false;
    address_set = false;
  };
  ble_hs_cfg.store_status_cb = on_store_status;
  ble_hs_cfg.sm_io_cap = BLE_SM_IO_CAP_DISP_ONLY;
  ble_hs_cfg.sm_bonding = 1;
  ble_hs_cfg.sm_mitm = 1;
  ble_hs_cfg.sm_sc = 1;
  ble_hs_cfg.sm_our_key_dist = BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID;
  ble_hs_cfg.sm_their_key_dist = BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID;
  ble_svc_gap_init();
  ble_svc_gatt_init();
  ble_store_config_init();
  if (ble_svc_gap_device_name_set("Reaper") != 0 || !register_service()) {
    available = false;
    return false;
  }
  nimble_port_freertos_init(host_task);
  started = true;
  return true;
}
void advertise() {
  if (!synced)
    return;
  if (!address_set) {
    if (ble_gap_adv_active())
      ble_gap_adv_stop();
    if (ble_hs_id_set_rnd(address.data()) != 0)
      return;
    address_set = true;
  }
  const auto want = connection != BLE_HS_CONN_HANDLE_NONE ? Advertising::Off
                    : window.open()                       ? Advertising::Pairing
                    : bond_count > 0                      ? Advertising::Paired
                                                          : Advertising::Off;
  if (want == advertising && (want == Advertising::Off || ble_gap_adv_active()))
    return;
  if (ble_gap_adv_active())
    ble_gap_adv_stop();
  advertising = want;
  if (want == Advertising::Off)
    return;
  ble_hs_adv_fields fields{};
  fields.flags = BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP;
  fields.uuids128 = &service_id;
  fields.num_uuids128 = 1;
  fields.uuids128_is_complete = 1;
  ble_hs_adv_fields response{};
  // The short random name appears only while the window is open; it is not the node ID.
  if (want == Advertising::Pairing) {
    response.name = reinterpret_cast<const std::uint8_t*>(advertised_name);
    response.name_len = static_cast<std::uint8_t>(std::strlen(advertised_name));
    response.name_is_complete = 1;
  }
  ble_gap_adv_params params{};
  params.conn_mode = BLE_GAP_CONN_MODE_UND;
  params.disc_mode = BLE_GAP_DISC_MODE_GEN;
  params.itvl_min = params.itvl_max = want == Advertising::Pairing ? 160 : 1600;  // 100 ms, 1 s
  if (ble_gap_adv_set_fields(&fields) != 0 || ble_gap_adv_rsp_set_fields(&response) != 0 ||
      ble_gap_adv_start(BLE_OWN_ADDR_RANDOM, nullptr, BLE_HS_FOREVER, &params, on_gap, nullptr) !=
          0)
    advertising = Advertising::Off;  // Tried again on the next tick.
}
void pump_output() {
  for (int sent = 0; sent < 8; ++sent) {
    const auto handle = connection.load();
    if (handle == BLE_HS_CONN_HANDLE_NONE || !trusted || !subscribed)
      return;
    if (!pending_size)
      pending_size = xStreamBufferReceive(output, pending.data(),
                                          std::min<std::size_t>(kMaxChunk, att_mtu - 3), 0);
    if (!pending_size)
      return;
    os_mbuf* chunk = ble_hs_mbuf_from_flat(pending.data(), pending_size);
    if (!chunk || ble_gatts_notify_custom(handle, output_handle, chunk) != 0)
      return;  // Out of buffers: keep the chunk and try again on the next tick.
    pending_size = 0;
  }
}
}  // namespace

void BleLink::begin() {
  // This partition holds only Bluetooth keys and calibration, never device settings, so a blank
  // or unreadable one is safe to reset: at worst a phone must pair again at the device.
  auto status = nvs_flash_init();
  if (status == ESP_ERR_NVS_NO_FREE_PAGES || status == ESP_ERR_NVS_NEW_VERSION_FOUND) {
    if (nvs_flash_erase() == ESP_OK)
      status = nvs_flash_init();
  }
  available = status == ESP_OK && store_address(false);
  if (available && has_bonds())
    start_stack();
}
void BleLink::hold(std::uint64_t now) {
  if (!start_stack()) {
    unavailable_until = now + kNoticeMs;
    return;
  }
  window.hold(now, bond_count);
  window_open = window.open();
}
void BleLink::forget(std::uint64_t now) {
  window.forgotten(now);
  window_open = false;
  if (!started)
    return;
  const auto handle = connection.load();
  if (handle != BLE_HS_CONN_HANDLE_NONE)
    ble_gap_terminate(handle, BLE_ERR_REM_USER_CONN_TERM);
  if (ble_gap_adv_active())
    ble_gap_adv_stop();
  advertising = Advertising::Off;
  ble_store_clear();
  update_bonds();
  // A new address too, so a forgotten phone cannot recognize this device.
  store_address(true);
  address_set = false;
}
void BleLink::tick(std::uint64_t now, d::HostLinks& links) {
  window.tick(now);
  if (paired_event.exchange(false))
    window.paired(now);
  if (failed_event.exchange(false))
    window.failed(now);
  window_open = window.open();
  if (!started)
    return;
  if (connected_event.exchange(false))
    connected_at = now;
  if (closed_event.exchange(false)) {
    // The next connection cannot start until advertising resumes below, so nothing races this.
    if (shown_passkey.exchange(-1) >= 0)
      window.failed(now);
    window_open = window.open();
    overflow_event = false;
    xStreamBufferReset(input);
    xStreamBufferReset(output);
    pending_size = 0;
    links.closed(d::HostLink::Ble);
  }
  const auto handle = connection.load();
  if (handle != BLE_HS_CONN_HANDLE_NONE) {
    if (overflow_event.exchange(false) ||
        (!trusted && now - connected_at > window.connection_deadline()))
      refuse(handle);
    std::array<std::uint8_t, 256> bytes;
    for (;;) {
      const auto size = xStreamBufferReceive(input, bytes.data(), bytes.size(), 0);
      if (!size)
        break;
      links.feed(d::HostLink::Ble, bytes.data(), size, now);
    }
    pump_output();
  }
  advertise();
}
bool BleLink::write(const std::uint8_t* data, std::size_t size) {
  if (!started || connection == BLE_HS_CONN_HANDLE_NONE || !trusted || !subscribed ||
      xStreamBufferSpacesAvailable(output) < size)
    return false;
  return xStreamBufferSend(output, data, size, 0) == size;
}
ui::BleStatus BleLink::status(std::uint64_t now) const {
  ui::BleStatus status;
  status.name = advertised_name;
  status.seconds = window.seconds_left(now);
  if (now < unavailable_until) {
    status.notice = ui::BleNotice::Unavailable;
    return status;
  }
  switch (window.state()) {
    case d::PairingState::Open: {
      const int key = shown_passkey;
      status.notice = key >= 0 ? ui::BleNotice::Passkey : ui::BleNotice::Open;
      status.passkey = key >= 0 ? static_cast<std::uint32_t>(key) : 0;
      break;
    }
    case d::PairingState::Full:
      status.notice = ui::BleNotice::Full;
      break;
    case d::PairingState::Paired:
      status.notice = ui::BleNotice::Paired;
      break;
    case d::PairingState::Failed:
      status.notice = ui::BleNotice::Failed;
      break;
    case d::PairingState::Forgotten:
      status.notice = ui::BleNotice::Forgotten;
      break;
    default:
      break;
  }
  return status;
}
d::PairingView BleLink::view(std::uint64_t now) const {
  d::PairingView view;
  const auto shown = status(now);
  view.seconds = shown.seconds;
  view.bonds = static_cast<std::uint32_t>(bond_count.load());
  switch (shown.notice) {
    case ui::BleNotice::Open:
      view.state = "open";
      view.name = shown.name;
      break;
    case ui::BleNotice::Passkey:
      view.state = "passkey";
      view.name = shown.name;
      view.passkey = static_cast<int>(shown.passkey);
      break;
    case ui::BleNotice::Full:
      view.state = "full";
      break;
    case ui::BleNotice::Paired:
      view.state = "paired";
      break;
    case ui::BleNotice::Failed:
      view.state = "failed";
      break;
    case ui::BleNotice::Forgotten:
      view.state = "forgotten";
      break;
    case ui::BleNotice::Unavailable:
      view.state = "unavailable";
      break;
    default:
      break;
  }
  return view;
}
