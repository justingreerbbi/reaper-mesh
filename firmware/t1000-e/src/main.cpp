// T1000-E entry point (D57): the same session, host links and mesh service as the ESP boards,
// on Zephyr. There is no screen; the LED, the button gestures and the portal show the state.
#include "ble_link.hpp"
#include "board_input.hpp"
#include "board_led.hpp"
#include "board_power.hpp"
#include "device_ui.hpp"
#include "flash_storage.hpp"
#include "key_area.hpp"
#include "mesh_service.hpp"
#include "reaper/host_links.hpp"
#include "reaper/session.hpp"
#include "usb_serial.hpp"
#include <zephyr/drivers/entropy.h>
#include <zephyr/drivers/hwinfo.h>
#include <zephyr/kernel.h>
#include <zephyr/sys/reboot.h>
#include <zephyr/sys/sys_heap.h>
#include <hal/nrf_power.h>
#include <array>
#include <cstdio>
#include <cstring>

// Zephyr's libc heap statistics (lib/libc/common); it has no public header.
extern "C" int malloc_runtime_stats_get(sys_memory_stats* stats);

namespace d = reaper::device;
// If the main loop stops for 30 seconds, a timer interrupt restarts the board, like the ESP boards'
// watchdog. Nothing in the loop should wait that long; this keeps a fault from leaving the T1000-E
// unreachable until someone resets it.
namespace {
volatile std::uint32_t heartbeat = 0;
void check_loop(k_timer*) {
  static std::uint32_t last = 0, stalled = 0;
  if (heartbeat != last) {
    last = heartbeat;
    stalled = 0;
  } else if (++stalled >= 30) {
    sys_reboot(SYS_REBOOT_COLD);
  }
}
K_TIMER_DEFINE(loop_timer, check_loop, nullptr);
}  // namespace
namespace {
UsbSerial usb;
BleLink ble;
bool write_link(d::HostLink link, const std::uint8_t* data, std::size_t size, void*) {
  return link == d::HostLink::Ble ? ble.write(data, size) : usb.write(data, size);
}
std::uint64_t now_ms() {
  return static_cast<std::uint64_t>(k_uptime_get());
}
[[noreturn]] void halt() {
  for (;;)
    k_sleep(K_SECONDS(1));
}
// The Adafruit nRF52 bootloader starts its serial DFU mode after a reset with this retained value.
// That is what the browser installer talks to, and what other nRF52 firmware's 1200-baud reset
// opens, so the installer works the same whatever the T1000-E was running.
[[noreturn]] void enter_bootloader() {
  nrf_power_gpregret_set(NRF_POWER, 0, 0x4e);
  sys_reboot(SYS_REBOOT_COLD);
  halt();
}
bool random_bytes(std::uint8_t* out, std::size_t size) {
  const device* entropy = DEVICE_DT_GET(DT_CHOSEN(zephyr_entropy));
  return device_is_ready(entropy) &&
         entropy_get_entropy(entropy, out, static_cast<std::uint16_t>(size)) == 0;
}
}  // namespace

int main() {
  k_timer_start(&loop_timer, K_SECONDS(1), K_SECONDS(1));
  if (!usb.begin())
    halt();
  // The nRF52840's hardware random generator; no radio is running yet.
  std::array<std::uint8_t, 16> random{};
  reaper::crypto::Key nonce_seed{};
  if (!random_bytes(random.data(), random.size()) ||
      !random_bytes(nonce_seed.data(), nonce_seed.size()))
    halt();
  char boot_string[33]{};
  for (std::size_t i = 0; i < random.size(); ++i)
    std::snprintf(boot_string + 2 * i, 3, "%02x", random[i]);
  // The node ID: 48 bits of the chip's factory device ID. Bluetooth advertises a separate random
  // address, so the radio's identity is not broadcast over Bluetooth.
  std::array<std::uint8_t, 8> id{};
  if (hwinfo_get_device_id(id.data(), id.size()) < 6)
    halt();
  std::uint64_t node = 0;
  for (std::size_t i = 0; i < 6; ++i)
    node = (node << 8) | id[i];
  char device_string[32]{};
  std::snprintf(device_string, sizeof(device_string), "node-0000%012llx",
                static_cast<unsigned long long>(node));
  d::Text<64> boot{}, device{};
  boot.assign(reinterpret_cast<const std::uint8_t*>(boot_string), 32);
  device.assign(reinterpret_cast<const std::uint8_t*>(device_string), std::strlen(device_string));

  static FlashStorage storage;
  static d::Configuration authority(storage, boot);
  std::uint32_t first_boot = 1;
  for (unsigned i = 0; i < 4; ++i)
    first_boot |= std::uint32_t(random[i]) << (i * 8);
  const auto boot_counter = storage.next_boot_counter(first_boot & 0x7fffffff);
  static d::MessageQueue messages(d::boot_identity(boot_counter));
  static d::Inbox inbox;
  static d::RadioInfo radio_info;
  static BoardInput buttons;
  buttons.begin();
  static BoardLed status_led;
  status_led.begin();
  static BoardPower power;
  static reaper::ui::Indicator indicator;
  static reaper::ui::ButtonGestures gestures;
  bool led_enabled = false;
  static KeyArea key_area;
  static d::Network network(key_area);
  // A missing or unreadable key area leaves the radio with no network, which keeps it silent.
  if (key_area.begin())
    network.begin();
  static MeshService mesh(messages, inbox, radio_info, network, device, boot_counter, nonce_seed,
                          node,
                          reaper::board::kUsBandOwnerConfirmed && reaper::board::kAntennaVerified);
  static d::Session session(authority, device, boot, &messages, &radio_info, &inbox,
                            &mesh.discovery(), &ble, &network);
  static d::HostLinks links(session, write_link, nullptr);
  mesh.begin();
  ble.begin();
  std::array<std::uint8_t, 256> input{};
  for (;;) {
    const auto now = now_ms();
    session.tick(now);
    if (usb.bootloader_requested())
      enter_bootloader();
    if (usb.take_closed())
      links.closed(d::HostLink::Usb);
    for (;;) {
      const auto size = usb.read(input.data(), input.size());
      if (!size)
        break;
      links.feed(d::HostLink::Usb, input.data(), size, now_ms());
    }
    links.tick(now_ms());
    ble.tick(now_ms(), links);
    d::Snapshot current{};
    const bool storage_ok = authority.snapshot(current);
    const auto mesh_now = now_ms();
    mesh.tick(storage_ok ? &current : nullptr, mesh_now, links.attached(mesh_now));
    // Free bytes in the libc heap (used by PSA Crypto and Bluetooth), and this thread's unused
    // stack.
    sys_memory_stats heap{};
    if (malloc_runtime_stats_get(&heap) == 0)
      radio_info.heap_free = static_cast<std::uint32_t>(heap.free_bytes);
    std::size_t unused = 0;
    if (k_thread_stack_space_get(k_current_get(), &unused) == 0)
      radio_info.stack_free = static_cast<std::uint32_t>(unused);
    const auto at = now_ms();
    const auto press = gestures.sample(buttons.main_pressed(), at);
    if (press == reaper::ui::Press::PairHold)
      ble.hold(at);
    else if (press == reaper::ui::Press::ForgetHold)
      ble.forget(at);
    if (storage_ok)
      led_enabled = current.settings.led;
    reaper::ui::Indicator::Input led_input;
    led_input.enabled = led_enabled;
    led_input.activity = static_cast<std::uint32_t>(radio_info.transmitted + radio_info.received);
    led_input.latest = inbox.latest();
    led_input.seen = press != reaper::ui::Press::None || links.attached(at);
    status_led.set(indicator.update(led_input, at));
    (void)power.read(at);
    heartbeat = heartbeat + 1;
    k_msleep(2);  // The radio is polled; this keeps the loop responsive without spinning.
  }
}
