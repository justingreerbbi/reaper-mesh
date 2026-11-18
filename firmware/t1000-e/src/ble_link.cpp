// Secure Bluetooth link for the T1000-E (D47), on Zephyr's Bluetooth host. The rules match
// app/ble_link.cpp on the ESP boards: the stack stays off until the first physical pairing, a new
// pairing needs the window opened by a button hold or the portal over USB, the passkey is drawn
// without bias, and only a bonded, passkey-authenticated phone can reach the host protocol. The
// T1000-E has no screen, so the passkey is shown in the portal over USB.
#include "ble_link.hpp"
#include "ble_gatt.h"
#include "ble_io.hpp"
#include "reaper/pairing.hpp"
#include <zephyr/bluetooth/bluetooth.h>
#include <zephyr/bluetooth/conn.h>
#include <zephyr/bluetooth/gatt.h>
#include <zephyr/drivers/entropy.h>
#include <zephyr/kernel.h>
#include <zephyr/settings/settings.h>
#include <zephyr/sys/ring_buffer.h>
#include <algorithm>
#include <array>
#include <atomic>
#include <cstdio>
#include <cstring>

namespace d = reaper::device;
namespace ui = reaper::ui;
namespace {
// Identity 0 is the chip's factory address and is never used; identity 1 is a random static
// address that "forget" replaces, so a forgotten phone cannot recognize this device.
constexpr std::uint8_t kId = 1;
constexpr std::size_t kMaxChunk = 244;
constexpr std::uint64_t kNoticeMs = 5000;
constexpr std::size_t kReplyReserve = 2 * (reaper::protocol::kMaxEncoded + 1);
RING_BUF_DECLARE(input, 4096);
RING_BUF_DECLARE(output, 8192);

K_MUTEX_DEFINE(connection_lock);
bt_conn* connection = nullptr;  // Guarded by connection_lock; holds a reference.
std::atomic<bool> trusted{false}, subscribed{false}, connected_event{false}, closed_event{false};
std::atomic<bool> paired_event{false}, failed_event{false}, window_open{false};
std::atomic<int> shown_passkey{-1}, disconnect_reason{0}, notify_error{0};
std::atomic<std::size_t> bond_count{0};

bool available = true, started = false;
d::PairingWindow window;
std::uint64_t connected_at = 0, unavailable_until = 0;
char advertised_name[16] = "Reaper";
enum class Advertising { Off, Paired, Pairing } advertising = Advertising::Off;
// Owned by the send work item (pump below) while a link is up.
std::array<std::uint8_t, kMaxChunk> pending{};
std::size_t pending_size = 0;
std::int64_t blocked_since = -1;
std::atomic<bool> output_fault{false};

bt_conn* take_connection() {
  k_mutex_lock(&connection_lock, K_FOREVER);
  bt_conn* conn = connection ? bt_conn_ref(connection) : nullptr;
  k_mutex_unlock(&connection_lock);
  return conn;
}
void count_bond(const bt_bond_info*, void* count) {
  ++*static_cast<std::size_t*>(count);
}
void update_bonds() {
  std::size_t count = 0;
  bt_foreach_bond(kId, count_bond, &count);
  bond_count = count;
}
struct BondSearch {
  const bt_addr_le_t* peer;
  bool found;
};
void find_bond(const bt_bond_info* info, void* search) {
  auto& s = *static_cast<BondSearch*>(search);
  s.found = s.found || bt_addr_le_eq(&info->addr, s.peer);
}
d::LinkSecurity security(bt_conn* conn) {
  bt_conn_info info{};
  if (!conn || bt_conn_get_info(conn, &info) != 0 || info.id != kId)
    return {};
  BondSearch search{bt_conn_get_dst(conn), false};
  bt_foreach_bond(kId, find_bond, &search);
  const auto level = bt_conn_get_security(conn);
  return {level >= BT_SECURITY_L2, level >= BT_SECURITY_L3, search.found,
          bt_conn_enc_key_size(conn)};
}
void refuse(bt_conn* conn) {
  bt_conn_disconnect(conn, BT_HCI_ERR_AUTH_FAIL);
}
void update_name() {
  bt_addr_le_t addresses[CONFIG_BT_ID_MAX]{};
  std::size_t count = CONFIG_BT_ID_MAX;
  bt_id_get(addresses, &count);
  if (count > kId)
    std::snprintf(advertised_name, sizeof(advertised_name), "Reaper-%02X%02X",
                  addresses[kId].a.val[1], addresses[kId].a.val[0]);
}
// Stored bonds are read straight from settings, so the stack is not started just to find none.
int note_bond(const char*, std::size_t, settings_read_cb, void*, void* found) {
  *static_cast<bool*>(found) = true;
  return 1;  // Stop at the first.
}
bool has_bonds() {
  bool found = false;
  settings_load_subtree_direct("bt/keys", note_bond, &found);
  return found;
}
bool start_stack() {
  if (started)
    return true;
  if (!available)
    return false;
  if (bt_enable(nullptr) != 0 || settings_load() != 0 || reaper_ble_register() != 0) {
    available = false;
    return false;
  }
  std::size_t count = CONFIG_BT_ID_MAX;
  bt_addr_le_t addresses[CONFIG_BT_ID_MAX]{};
  bt_id_get(addresses, &count);
  if (count <= kId && bt_id_create(nullptr, nullptr) != kId) {
    available = false;
    return false;
  }
  update_name();
  update_bonds();
  started = true;
  return true;
}
void advertise() {
  bt_conn* conn = take_connection();
  const auto want = conn             ? Advertising::Off
                    : window.open()  ? Advertising::Pairing
                    : bond_count > 0 ? Advertising::Paired
                                     : Advertising::Off;
  if (conn)
    bt_conn_unref(conn);
  if (want == advertising)
    return;
  bt_le_adv_stop();
  advertising = want;
  if (want == Advertising::Off)
    return;
  static const std::uint8_t flags = BT_LE_AD_GENERAL | BT_LE_AD_NO_BREDR;
  const bt_data ad[] = {{BT_DATA_FLAGS, 1, &flags},
                        {BT_DATA_UUID128_ALL, 16, reaper_ble_service_uuid}};
  // The short random name appears only while the window is open; it is not the node ID.
  const bt_data sd[] = {{BT_DATA_NAME_COMPLETE,
                         static_cast<std::uint8_t>(std::strlen(advertised_name)),
                         reinterpret_cast<const std::uint8_t*>(advertised_name)}};
  bt_le_adv_param params{};
  params.id = kId;
  params.options = BT_LE_ADV_OPT_CONN;
  params.interval_min = params.interval_max = want == Advertising::Pairing ? 160 : 1600;
  if (bt_le_adv_start(&params, ad, ARRAY_SIZE(ad), want == Advertising::Pairing ? sd : nullptr,
                      want == Advertising::Pairing ? 1 : 0) != 0)
    advertising = Advertising::Off;  // Tried again on the next tick.
}
// Notifications are sent from the system work queue, where Zephyr never waits for a buffer: it
// returns -ENOMEM and this runs again shortly. From any other thread bt_gatt_notify() waits forever
// for one, which could stall the main loop and with it USB and the radio. The ESP boards' NimBLE
// link is non-blocking for the same reason. The main thread only fills `output`.
void pump(k_work* work);
K_WORK_DELAYABLE_DEFINE(pump_work, pump);
k_work_sync pump_sync;
void pump(k_work*) {
  bt_conn* conn = take_connection();
  if (!conn)
    return;
  const auto now = k_uptime_get();
  for (int sent = 0; sent < 8; ++sent) {
    if (!trusted || !reaper_ble_subscribed(conn))
      break;
    if (!pending_size) {
      const auto mtu = bt_gatt_get_mtu(conn);
      const std::size_t limit = std::min<std::size_t>(kMaxChunk, mtu > 3 ? mtu - 3 : 20);
      pending_size = ring_buf_get(&output, pending.data(), static_cast<std::uint32_t>(limit));
    }
    if (!pending_size)
      break;
    const int error =
        reaper_ble_notify(conn, pending.data(), static_cast<std::uint16_t>(pending_size));
    if (error != 0) {
      notify_error = error;
      if (blocked_since < 0)
        blocked_since = now;
      // Only transient resource errors are retried, and only for five seconds.
      if ((error != -ENOMEM && error != -EAGAIN && error != -ENOBUFS) ||
          now - blocked_since >= 5000)
        output_fault = true;
      else
        k_work_schedule(&pump_work, K_MSEC(10));
      break;
    }
    pending_size = 0;
    blocked_since = -1;
  }
  if (pending_size || ring_buf_size_get(&output))
    k_work_schedule(&pump_work, K_MSEC(pending_size ? 10 : 0));
  bt_conn_unref(conn);
}
}  // namespace

extern "C" {
bool reaper_ble_trusted(bt_conn* conn) {
  return d::link_trusted(security(conn));
}
bool reaper_ble_on_write(const void* data, std::uint16_t size) {
  return reaper::ble::accept(
      static_cast<const std::uint8_t*>(data), size, [] { return ring_buf_space_get(&input); },
      [](const std::uint8_t* bytes, std::size_t count) {
        return static_cast<std::size_t>(
            ring_buf_put(&input, bytes, static_cast<std::uint32_t>(count)));
      });
}
void reaper_ble_on_subscribe(bool enabled) {
  subscribed = enabled;
}
void reaper_ble_on_connected(bt_conn* conn) {
  k_mutex_lock(&connection_lock, K_FOREVER);
  if (!connection) {
    connection = bt_conn_ref(conn);
    connected_event = true;
  }
  k_mutex_unlock(&connection_lock);
}
void reaper_ble_on_disconnected(bt_conn* conn, std::uint8_t reason) {
  k_mutex_lock(&connection_lock, K_FOREVER);
  if (connection == conn) {
    bt_conn_unref(connection);
    connection = nullptr;
    disconnect_reason = reason;
    trusted = subscribed = false;
    closed_event = true;
  }
  k_mutex_unlock(&connection_lock);
}
// Zephyr reports encryption before a new pairing has stored its bond, so a new pairing is judged
// when it completes. Encryption without a pairing in progress reuses stored keys: judge it now.
void reaper_ble_on_security(bt_conn* conn, bool ok) {
  if (shown_passkey >= 0)
    return;
  if (ok && d::link_trusted(security(conn))) {
    trusted = true;
    return;
  }
  refuse(conn);
}
bool reaper_ble_window_open(void) {
  return window_open;
}
void reaper_ble_on_passkey(unsigned int passkey) {
  if (!window_open)
    return;
  shown_passkey = static_cast<int>(passkey);
}
std::uint32_t reaper_ble_new_passkey(void) {
  const device* entropy = DEVICE_DT_GET(DT_CHOSEN(zephyr_entropy));
  std::uint32_t key = 0;
  for (;;) {
    std::uint32_t random = 0;
    if (entropy_get_entropy(entropy, reinterpret_cast<std::uint8_t*>(&random), sizeof(random)) ==
            0 &&
        d::passkey_from_random(random, key))
      return key;
  }
}
void reaper_ble_on_pairing_done(bt_conn* conn, bool bonded) {
  const bool pairing = shown_passkey.exchange(-1) >= 0;
  const auto link = security(conn);
  if (bonded && d::link_trusted(link)) {
    trusted = true;
    if (pairing)
      paired_event = true;
    update_bonds();
    return;
  }
  // Not good enough, for example an unauthenticated bond: keep no keys from it and end the link.
  if (bonded && !link.authenticated)
    bt_unpair(kId, bt_conn_get_dst(conn));
  if (pairing)
    failed_event = true;
  update_bonds();
  refuse(conn);
}
}

void BleLink::begin() {
  // Settings hold only Bluetooth identities and bonds, never device settings.
  available = settings_subsys_init() == 0;
  if (available && has_bonds())
    start_stack();
}
void BleLink::hold(std::uint64_t now) {
  if (!start_stack()) {
    unavailable_until = now + kNoticeMs;
    return;
  }
  update_bonds();
  window.hold(now, bond_count);
  window_open = window.open();
}
void BleLink::forget(std::uint64_t now) {
  window.forgotten(now);
  window_open = false;
  if (!started)
    return;
  if (bt_conn* conn = take_connection()) {
    bt_conn_disconnect(conn, BT_HCI_ERR_REMOTE_USER_TERM_CONN);
    bt_conn_unref(conn);
  }
  bt_le_adv_stop();
  advertising = Advertising::Off;
  bt_unpair(kId, nullptr);
  update_bonds();
  // A new address too, so a forgotten phone cannot recognize this device.
  bt_id_reset(kId, nullptr, nullptr);
  update_name();
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
    if (shown_passkey.exchange(-1) >= 0)
      window.failed(now);
    window_open = window.open();
    // Stop the sender before clearing what it owns.
    k_work_cancel_delayable_sync(&pump_work, &pump_sync);
    ring_buf_reset(&input);
    ring_buf_reset(&output);
    pending_size = 0;
    links.closed(d::HostLink::Ble);
    output_fault = false;
    blocked_since = -1;
    advertising = Advertising::Off;  // Connecting stopped it; start it again below.
  }
  if (bt_conn* conn = take_connection()) {
    if (output_fault.exchange(false)) {
      // A permanent notification error cannot be repaired by replaying the same chunk.
      bt_conn_disconnect(conn, BT_HCI_ERR_REMOTE_USER_TERM_CONN);
    } else {
      if (!trusted && now - connected_at > window.connection_deadline())
        refuse(conn);
      reaper::ble::drain(
          [&](std::uint8_t* data, std::size_t) -> std::size_t {
            // Stop before consuming a frame's final byte unless its reply fits.
            if (output_fault || ring_buf_space_get(&output) < kReplyReserve) {
              links.paused(d::HostLink::Ble, now);
              return 0;
            }
            return ring_buf_get(&input, data, 1);
          },
          [&](const std::uint8_t* data, std::size_t size) {
            links.feed(d::HostLink::Ble, data, size, now);
          },
          [] { k_work_schedule(&pump_work, K_NO_WAIT); }, 4096);
    }
    bt_conn_unref(conn);
  }
  advertise();
}
bool BleLink::write(const std::uint8_t* data, std::size_t size) {
  if (!started || !trusted || !subscribed || ring_buf_space_get(&output) < size)
    return false;
  bt_conn* conn = take_connection();
  if (!conn)
    return false;
  bt_conn_unref(conn);
  return ring_buf_put(&output, data, static_cast<std::uint32_t>(size)) == size;
}
ui::BleStatus BleLink::status(std::uint64_t now) const {
  ui::BleStatus status;
  status.disconnect = disconnect_reason;
  status.notify = notify_error;
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
