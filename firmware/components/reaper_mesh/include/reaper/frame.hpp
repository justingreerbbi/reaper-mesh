#pragma once
#include "reaper/crypto.hpp"
#include "reaper/radio_packet.hpp"
// Radio version 2 (D50): docs/reference/radio-protocol.md. Portable and heap-free. A radio holding
// only the relay key can check and forward a frame, but cannot read it or originate one.
namespace reaper::mesh {
inline constexpr std::size_t kFrameClearBytes = 14, kFrameHeaderBytes = 32, kFrameTeamTagBytes = 8,
                             kFrameRelayTagBytes = 4,
                             kFrameOverheadBytes = kFrameClearBytes + kFrameHeaderBytes +
                                                   kFrameTeamTagBytes + kFrameRelayTagBytes,
                             kMaxFrameBytes = kFrameOverheadBytes + kFragmentBytes;
static_assert(kFrameOverheadBytes == kMinPacketBytes && kMaxFrameBytes == kMaxPacketBytes);
struct RelayKeys {
  crypto::Key tag{};
  std::array<std::uint8_t, 2> hint{};
};
struct FrameRoute {
  std::uint16_t epoch = 0;
  std::uint8_t hops = 0, limit = 0;
  std::array<std::uint8_t, 8> nonce{};
};
struct Frame {
  std::array<std::uint8_t, kMaxFrameBytes> bytes{};
  std::size_t size = 0;
};
bool ratchet_chain(crypto::Key& chain);
bool derive_relay_keys(const crypto::Key& relay_chain, RelayKeys& out);
bool derive_frame_key(const crypto::Key& team_chain, crypto::Key& out);
// Published chains for Open mode, which provide no secrecy.
bool open_mode_chains(crypto::Key& relay_chain, crypto::Key& team_chain);
// The packet's hops set both the remaining hops and the authenticated hop limit.
bool seal_frame(const Packet&, std::uint16_t epoch, const std::array<std::uint8_t, 8>& nonce,
                const RelayKeys&, const crypto::Key& frame_key, std::uint8_t* out,
                std::size_t capacity, std::size_t& size);
// Layout checks only, before any cryptography. The result is unauthenticated.
bool parse_route(const std::uint8_t*, std::size_t, FrameRoute&);
bool verify_relay_tag(const std::uint8_t*, std::size_t, const RelayKeys&);
// Publishes `out` only after authentication and validation both pass.
bool open_frame(const std::uint8_t*, std::size_t, const crypto::Key& frame_key, Packet& out);
// The relay tag and team tag exclude current hops, so both stay valid.
bool decrement_hops(std::uint8_t*, std::size_t);
enum class FrameResult { Rejected, RelayOnly, Opened };
// The keys this radio holds, and its source of frame nonces.
class FrameLink {
 public:
  // Needs true entropy from boot. Nonces are HMAC(seed, counter), so they do not depend on the
  // hardware random generator's state later, while the radios are running.
  void seed(const crypto::Key&);
  bool set_chains(const crypto::Key& relay_chain, const crypto::Key* team_chain,
                  std::uint16_t epoch);
  bool use_open_mode();
  // Holds no keys: everything is rejected and nothing can be sent.
  void clear();
  bool can_originate() const { return seeded_ && relay_ready_ && team_ready_; }
  // Refuses unless this radio holds the team key.
  bool seal(const Packet&, Frame&);
  // Rejected: not this team's, or a relay-key forgery. RelayOnly: valid, and this radio cannot read
  // it. Opened: `out` holds the packet.
  FrameResult receive(const std::uint8_t*, std::size_t, Packet& out) const;

 private:
  crypto::Key nonce_seed_{}, frame_key_{};
  RelayKeys relay_{};
  std::uint64_t nonce_counter_ = 0;
  std::uint16_t epoch_ = 0;
  bool seeded_ = false, relay_ready_ = false, team_ready_ = false;
};
}  // namespace reaper::mesh
