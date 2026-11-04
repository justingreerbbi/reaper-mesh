#pragma once
#include "reaper/protocol.hpp"
#include "reaper/session.hpp"
#include <array>
#include <cstddef>
#include <cstdint>

namespace reaper::device {
enum class HostLink : std::uint8_t { Usb, Ble };

// Carries one Session over USB and Bluetooth. Each link has its own frame decoder. Replies go to
// the link that asked, and the link that last sent a hello owns the session (D47).
class HostLinks {
 public:
  using Writer = bool (*)(HostLink, const std::uint8_t*, std::size_t, void*);
  // A partial frame older than this is dropped. Bluetooth writes can pause between packets.
  static constexpr std::uint64_t kUsbStallMs = 1000, kBleStallMs = 5000;
  // How recently a reply must have gone out for a link to count as in use.
  static constexpr std::uint64_t kActiveMs = 8000;

  HostLinks(Session& session, Writer writer, void* context)
      : session_(session), writer_(writer), context_(context) {}
  void feed(HostLink, const std::uint8_t* data, std::size_t size, std::uint64_t now);
  void tick(std::uint64_t now);
  // Local output backpressure is not a peer abandoning a partial input frame.
  void paused(HostLink link, std::uint64_t now) { slot(link).last_read = now; }
  // The link failed or went away. Ends the session only if that link owns it.
  void closed(HostLink);
  bool ready(HostLink, std::uint64_t now) const;

 private:
  struct Slot {
    protocol::FrameDecoder decoder;
    std::uint64_t last_read = 0, last_reply = 0;
    bool replied = false;
  };
  static void received(const protocol::Message&, void*);
  bool write(const protocol::Message&);
  Slot& slot(HostLink link) { return slots_[static_cast<std::size_t>(link)]; }
  const Slot& slot(HostLink link) const { return slots_[static_cast<std::size_t>(link)]; }
  bool owns(HostLink link) const { return owned_ && owner_ == link; }
  void release(HostLink);

  Session& session_;
  Writer writer_;
  void* context_;
  std::array<Slot, 2> slots_{};
  protocol::Message reply_{};
  std::array<std::uint8_t, protocol::kMaxEncoded + 1> output_{};
  HostLink current_ = HostLink::Usb, owner_ = HostLink::Usb;
  bool owned_ = false;
  std::uint64_t now_ = 0;
};
}  // namespace reaper::device
