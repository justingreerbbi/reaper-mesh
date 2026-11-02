#pragma once
#include "radio_bus.hpp"
#ifdef REAPER_TBEAM_V12
#include "reaper/sx1276.hpp"
#endif
#include "reaper/session.hpp"
#include "reaper/mesh.hpp"
class MeshService {
 public:
  MeshService(reaper::device::MessageQueue&, reaper::device::Inbox&, reaper::device::RadioInfo&,
    reaper::device::Text<64> device, std::array<std::uint8_t, 16> boot, std::uint64_t node, bool antenna_verified = false);
  void begin();
  void tick(const reaper::device::Snapshot*, std::uint64_t now);
 private:
  reaper::device::MessageQueue& messages_;
  reaper::device::Inbox& inbox_;
  reaper::device::RadioInfo& info_;
  reaper::device::Text<64> device_{};
  std::array<std::uint8_t, 16> boot_{};
  std::uint64_t node_;
  const bool antenna_verified_;
  RadioBus bus_{};
#ifdef REAPER_TBEAM_V12
  reaper::radio::Sx1276 radio_;
#else
  reaper::radio::Radio radio_;
#endif
  reaper::mesh::Mesh mesh_;
  reaper::device::Settings settings_{};
  bool configured_ = false, pending_ = false, tx_ = false;
  reaper::mesh::Packet packet_{};
  std::uint64_t pending_at_ = 0;
  std::array<reaper::mesh::MessageKey, 8> reported_{};
};
