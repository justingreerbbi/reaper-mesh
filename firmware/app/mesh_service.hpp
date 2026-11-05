#pragma once
#include "radio_bus.hpp"
#ifdef REAPER_TBEAM_V12
#include "reaper/sx1276.hpp"
#endif
#include "reaper/session.hpp"
#include "reaper/network.hpp"
#include "reaper/mesh.hpp"
class MeshService {
 public:
#ifdef REAPER_TBEAM_V12
  using Driver = reaper::radio::Sx1276;
#else
  using Driver = reaper::radio::Radio;
#endif
  MeshService(reaper::device::MessageQueue&, reaper::device::Inbox&, reaper::device::RadioInfo&,
              reaper::device::Network&, reaper::device::Text<64> device, std::uint32_t boot,
              const reaper::crypto::Key& nonce_seed, std::uint64_t node,
              bool antenna_verified = false);
  reaper::device::Discovery& discovery() { return discovery_; }
  void begin();
  // `attached` means an agent is connected. Without one, the radio relays and sends nothing of its
  // own (D50).
  void tick(const reaper::device::Snapshot*, std::uint64_t now, bool attached = true);

 private:
  reaper::device::MessageQueue& messages_;
  reaper::device::Inbox& inbox_;
  reaper::device::RadioInfo& info_;
  reaper::device::Network& network_;
  std::uint32_t applied_network_ = 0;
  reaper::device::Text<64> device_{};
  std::uint32_t boot_ = 0;  // Zero means the boot counter could not be saved: nothing transmits.
  reaper::crypto::Key nonce_seed_{};
  std::uint64_t node_;
  const bool antenna_verified_;
  RadioBus bus_{};
  Driver radio_;
  reaper::mesh::Mesh mesh_;
  reaper::device::Discovery discovery_;
  bool control_ = false;
  reaper::device::Settings settings_{};
  bool configured_ = false, pending_ = false, tx_ = false;
  reaper::mesh::Frame frame_{};
  std::uint64_t pending_at_ = 0;
  std::array<reaper::mesh::MessageKey, 8> reported_{};
};
