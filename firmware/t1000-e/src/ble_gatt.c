/*
 * The Reaper GATT service and Bluetooth stack callbacks for the T1000-E (D47). Zephyr's GATT
 * macros are C only, so the declarations live here and every event is forwarded to
 * ble_link.cpp, which holds the rules. The UUIDs and permissions match app/ble_link.cpp:
 * 5d7e00NN-8b3a-4f6c-9e21-3c1a7f42b9d0 with 01 service, 02 host to device, 03 device to host and
 * 04 a protected read that makes a client pair before it starts a session.
 */
#include "ble_gatt.h"
#include <zephyr/bluetooth/bluetooth.h>
#include <zephyr/bluetooth/conn.h>
#include <zephyr/bluetooth/gatt.h>
#include <zephyr/bluetooth/uuid.h>

#define REAPER_UUID(id) \
  BT_UUID_128_ENCODE(0x5d7e0000 | (id), 0x8b3a, 0x4f6c, 0x9e21, 0x3c1a7f42b9d0)

static const struct bt_uuid_128 service_uuid = BT_UUID_INIT_128(REAPER_UUID(1));
static const struct bt_uuid_128 input_uuid = BT_UUID_INIT_128(REAPER_UUID(2));
static const struct bt_uuid_128 output_uuid = BT_UUID_INIT_128(REAPER_UUID(3));
static const struct bt_uuid_128 pair_uuid = BT_UUID_INIT_128(REAPER_UUID(4));
const uint8_t reaper_ble_service_uuid[16] = {
    BT_UUID_128_ENCODE(0x5d7e0001, 0x8b3a, 0x4f6c, 0x9e21, 0x3c1a7f42b9d0)};

static ssize_t on_write(struct bt_conn* conn, const struct bt_gatt_attr* attr, const void* buf,
                        uint16_t len, uint16_t offset, uint8_t flags) {
  ARG_UNUSED(attr);
  ARG_UNUSED(flags);
  if (offset != 0U) {
    return BT_GATT_ERR(BT_ATT_ERR_INVALID_OFFSET);
  }
  /* The permissions already demand this; the check keeps the rule in one visible place. */
  if (!reaper_ble_trusted(conn)) {
    return BT_GATT_ERR(BT_ATT_ERR_AUTHENTICATION);
  }
  /* Reject a whole write without consuming any of it when there is no room: the peer can
   * retry, and congestion is not an authentication failure.
   */
  if (!reaper_ble_on_write(buf, len)) {
    return BT_GATT_ERR(BT_ATT_ERR_INSUFFICIENT_RESOURCES);
  }
  return len;
}

static ssize_t on_read(struct bt_conn* conn, const struct bt_gatt_attr* attr, void* buf,
                       uint16_t len, uint16_t offset) {
  static const uint8_t version = 1U;

  if (!reaper_ble_trusted(conn)) {
    return BT_GATT_ERR(BT_ATT_ERR_AUTHENTICATION);
  }
  return bt_gatt_attr_read(conn, attr, buf, len, offset, &version, sizeof(version));
}

static void on_subscribe(const struct bt_gatt_attr* attr, uint16_t value) {
  ARG_UNUSED(attr);
  reaper_ble_on_subscribe(value == BT_GATT_CCC_NOTIFY);
}

BT_GATT_SERVICE_DEFINE(reaper_service, BT_GATT_PRIMARY_SERVICE(&service_uuid),
                       BT_GATT_CHARACTERISTIC(&input_uuid.uuid, BT_GATT_CHRC_WRITE,
                                              BT_GATT_PERM_WRITE_AUTHEN | BT_GATT_PERM_WRITE_LESC,
                                              NULL, on_write, NULL),
                       BT_GATT_CHARACTERISTIC(&output_uuid.uuid, BT_GATT_CHRC_NOTIFY,
                                              BT_GATT_PERM_NONE, NULL, NULL, NULL),
                       BT_GATT_CCC(on_subscribe, BT_GATT_PERM_READ | BT_GATT_PERM_WRITE_AUTHEN),
                       BT_GATT_CHARACTERISTIC(&pair_uuid.uuid, BT_GATT_CHRC_READ,
                                              BT_GATT_PERM_READ_AUTHEN | BT_GATT_PERM_READ_LESC,
                                              on_read, NULL, NULL));

int reaper_ble_notify(struct bt_conn* conn, const uint8_t* data, uint16_t size) {
  return bt_gatt_notify(conn, &reaper_service.attrs[3], data, size);
}

bool reaper_ble_subscribed(struct bt_conn* conn) {
  return bt_gatt_is_subscribed(conn, &reaper_service.attrs[3], BT_GATT_CCC_NOTIFY);
}

static void connected(struct bt_conn* conn, uint8_t err) {
  if (err == 0U) {
    reaper_ble_on_connected(conn);
  }
}

static void disconnected(struct bt_conn* conn, uint8_t reason) {
  reaper_ble_on_disconnected(conn, reason);
}

static void security_changed(struct bt_conn* conn, bt_security_t level, enum bt_security_err err) {
  ARG_UNUSED(level);
  reaper_ble_on_security(conn, err == BT_SECURITY_ERR_SUCCESS);
}

BT_CONN_CB_DEFINE(reaper_conn_callbacks) = {
    .connected = connected,
    .disconnected = disconnected,
    .security_changed = security_changed,
};

/* Without physical access nobody sees a passkey, so pairing is refused unless the window is
 * open. Display-only I/O with Secure Connections only means Just Works cannot complete.
 */
static enum bt_security_err pairing_accept(struct bt_conn* conn,
                                           const struct bt_conn_pairing_feat* const feat) {
  ARG_UNUSED(conn);
  ARG_UNUSED(feat);
  return reaper_ble_window_open() ? BT_SECURITY_ERR_SUCCESS : BT_SECURITY_ERR_PAIR_NOT_ALLOWED;
}

static void passkey_display(struct bt_conn* conn, unsigned int passkey) {
  ARG_UNUSED(conn);
  reaper_ble_on_passkey(passkey);
}

static uint32_t app_passkey(struct bt_conn* conn) {
  ARG_UNUSED(conn);
  return reaper_ble_new_passkey();
}

static void cancel(struct bt_conn* conn) {
  reaper_ble_on_pairing_done(conn, false);
}

static void pairing_complete(struct bt_conn* conn, bool bonded) {
  reaper_ble_on_pairing_done(conn, bonded);
}

static void pairing_failed(struct bt_conn* conn, enum bt_security_err reason) {
  ARG_UNUSED(reason);
  reaper_ble_on_pairing_done(conn, false);
}

static struct bt_conn_auth_cb auth_callbacks = {
    .pairing_accept = pairing_accept,
    .passkey_display = passkey_display,
    .cancel = cancel,
    .app_passkey = app_passkey,
};

static struct bt_conn_auth_info_cb auth_info_callbacks = {
    .pairing_complete = pairing_complete,
    .pairing_failed = pairing_failed,
};

int reaper_ble_register(void) {
  int err = bt_conn_auth_cb_register(&auth_callbacks);

  if (err == 0) {
    err = bt_conn_auth_info_cb_register(&auth_info_callbacks);
  }
  return err;
}
