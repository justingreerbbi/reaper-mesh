#pragma once
#include <cstddef>
#include <cstdint>

namespace reaper::device {
// Bluetooth pairing rules (D47). No Bluetooth stack here, so the rules run in host tests.

// A new pairing needs someone at the device: only a physical action opens the window, one
// failed attempt closes it, and existing pairings are never replaced to make room.
enum class PairingState : std::uint8_t { Closed, Open, Full, Paired, Failed, Forgotten };

class PairingWindow {
 public:
  static constexpr std::uint64_t kOpenMs = 120000, kNoticeMs = 5000;
  static constexpr std::size_t kMaxBonds = 4;
  // How long a connection may stay without a trusted link, so it cannot hold the only connection.
  static constexpr std::uint64_t kIdleDeadlineMs = 5000, kPairingDeadlineMs = 60000;

  void hold(std::uint64_t now, std::size_t bonds) {
    show(bonds >= kMaxBonds ? PairingState::Full : PairingState::Open, now);
  }
  void paired(std::uint64_t now) {
    if (open())
      show(PairingState::Paired, now);
  }
  void failed(std::uint64_t now) {
    if (open())
      show(PairingState::Failed, now);
  }
  void forgotten(std::uint64_t now) { show(PairingState::Forgotten, now); }
  void tick(std::uint64_t now) {
    if (state_ == PairingState::Closed)
      return;
    if (now - since_ >= (open() ? kOpenMs : kNoticeMs))
      state_ = PairingState::Closed;
  }
  bool open() const { return state_ == PairingState::Open; }
  PairingState state() const { return state_; }
  std::uint32_t seconds_left(std::uint64_t now) const {
    const auto used = now - since_;
    return !open() || used >= kOpenMs ? 0 : static_cast<std::uint32_t>((kOpenMs - used + 999) / 1000);
  }
  std::uint64_t connection_deadline() const { return open() ? kPairingDeadlineMs : kIdleDeadlineMs; }

 private:
  void show(PairingState state, std::uint64_t now) {
    state_ = state;
    since_ = now;
  }
  PairingState state_ = PairingState::Closed;
  std::uint64_t since_ = 0;
};

// What a host may use: encrypted with a full-size key, authenticated by passkey and bonded.
struct LinkSecurity {
  bool encrypted = false, authenticated = false, bonded = false;
  std::uint8_t key_size = 0;
};
inline bool link_trusted(const LinkSecurity& link) {
  return link.encrypted && link.authenticated && link.bonded && link.key_size == 16;
}

// Maps 32 random bits to an unbiased passkey below 1,000,000. False means draw again.
inline bool passkey_from_random(std::uint32_t random, std::uint32_t& passkey) {
  constexpr std::uint32_t kLimit = 4294000000u;  // Largest multiple of 1,000,000 that fits.
  if (random >= kLimit)
    return false;
  passkey = random % 1000000u;
  return true;
}
}  // namespace reaper::device
