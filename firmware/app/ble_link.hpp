#pragma once
#include "device_ui.hpp"
#include "reaper/host_links.hpp"
#include <cstddef>
#include <cstdint>
// Secure Bluetooth link (D47). The stack stays off until the first physical pairing, and only a
// bonded, passkey-authenticated phone can reach the host protocol. All methods run on the main
// task; the stack's own task only sets flags and fills the receive buffer.
class BleLink {
 public:
  // Opens the pairing store and starts the stack only if something is already paired.
  void begin();
  // Physical actions: the only ways to open pairing or clear the pairing list.
  void hold(std::uint64_t now);
  void forget(std::uint64_t now);
  // Applies stack events, feeds received bytes to `links` and sends queued bytes.
  void tick(std::uint64_t now, reaper::device::HostLinks& links);
  // Queues one complete frame. False means the link cannot take it.
  bool write(const std::uint8_t* data, std::size_t size);
  reaper::ui::BleStatus status(std::uint64_t now) const;
};
