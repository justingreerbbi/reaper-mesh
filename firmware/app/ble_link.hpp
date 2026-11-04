#pragma once
#include "device_ui.hpp"
#include "reaper/host_links.hpp"
#include <cstddef>
#include <cstdint>
// Secure Bluetooth link (D47). The stack stays off until the first physical pairing, and only a
// bonded, passkey-authenticated phone can reach the host protocol. All methods run on the main
// task; the stack's own task only sets flags and fills the receive buffer.
class BleLink : public reaper::device::PairingControl {
 public:
  // Opens the pairing store and starts the stack only if something is already paired.
  void begin();
  // Physical actions: a button hold, or a USB host for hold(). Bluetooth can do neither.
  void hold(std::uint64_t now);
  void forget(std::uint64_t now);
  // Applies stack events, feeds received bytes to `links` and sends queued bytes.
  void tick(std::uint64_t now, reaper::device::HostLinks& links);
  // Queues one complete frame. False means the link cannot take it.
  bool write(const std::uint8_t* data, std::size_t size);
  reaper::ui::BleStatus status(std::uint64_t now) const;
  // The session's view of pairing. The session allows this only over USB.
  void open(std::uint64_t now) override { hold(now); }
  reaper::device::PairingView view(std::uint64_t now) const override;
};
