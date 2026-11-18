#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
/* Glue between the C GATT declarations (ble_gatt.c) and the link logic (ble_link.cpp). */
#ifdef __cplusplus
extern "C" {
#endif
struct bt_conn;
extern const uint8_t reaper_ble_service_uuid[16];
int reaper_ble_register(void);
int reaper_ble_notify(struct bt_conn* conn, const uint8_t* data, uint16_t size);
bool reaper_ble_subscribed(struct bt_conn* conn);
/* Implemented in ble_link.cpp; called from the Bluetooth stack's threads. */
bool reaper_ble_trusted(struct bt_conn* conn);
bool reaper_ble_on_write(const void* data, uint16_t size);
void reaper_ble_on_subscribe(bool enabled);
void reaper_ble_on_connected(struct bt_conn* conn);
void reaper_ble_on_disconnected(struct bt_conn* conn, uint8_t reason);
void reaper_ble_on_security(struct bt_conn* conn, bool ok);
bool reaper_ble_window_open(void);
void reaper_ble_on_passkey(unsigned int passkey);
uint32_t reaper_ble_new_passkey(void);
void reaper_ble_on_pairing_done(struct bt_conn* conn, bool bonded);
#ifdef __cplusplus
}
#endif
