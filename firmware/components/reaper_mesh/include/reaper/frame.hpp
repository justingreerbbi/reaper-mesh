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
// How far ahead of its floor a radio can follow, in epochs (D52). It also bounds proof checks.
inline constexpr std::uint32_t kEpochLookAhead = 1024;
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
// One step down the proof chain: the proof for epoch e gives the proof for epoch e - 1.
bool previous_proof(const crypto::Key& proof, crypto::Key& previous);
// Whether hashing `proof` this many times arrives at `known`. Takes up to kEpochLookAhead steps.
bool proof_reaches(const crypto::Key& proof, std::uint32_t steps, const crypto::Key& known);
bool derive_relay_keys(const crypto::Key& relay_chain, RelayKeys& out);
bool derive_frame_key(const crypto::Key& team_chain, crypto::Key& out);
// Published chains for Open mode, which provide no secrecy.
bool open_mode_chains(crypto::Key& relay_chain, crypto::Key& team_chain);
// The packet's hops set both the remaining hops and the authenticated hop limit.
bool seal_frame(const Packet&, std::uint16_t epoch, const std::array<std::uint8_t, 8>& nonce,
                const RelayKeys&, const crypto::Key& frame_key, std::uint8_t* out,
                std::size_t capacity, std::size_t& size);
bool seal_proof_frame(std::uint16_t epoch, const crypto::Key& proof,
                      const std::array<std::uint8_t, 8>& nonce, std::uint8_t hops, const RelayKeys&,
                      std::uint8_t* out, std::size_t capacity, std::size_t& size);
// The proof a valid-layout proof frame carries. Authenticate the frame first.
crypto::Key frame_proof(const std::uint8_t* frame);
// Layout checks only, before any cryptography. The result is unauthenticated.
bool parse_route(const std::uint8_t*, std::size_t, FrameRoute&);
bool verify_relay_tag(const std::uint8_t*, std::size_t, const RelayKeys&);
// Publishes `out` only after authentication and validation both pass.
bool open_frame(const std::uint8_t*, std::size_t, const crypto::Key& frame_key, Packet& out);
// The relay tag and team tag exclude current hops, so both stay valid.
bool decrement_hops(std::uint8_t*, std::size_t);
// Proof: a valid epoch proof frame, which the caller checks against the proof it holds.
enum class FrameResult { Rejected, RelayOnly, Opened, Proof };
// The keys this radio holds, and its source of frame nonces. Follows epochs without any stored
// state changing: only a proof moves the floor, and the Network that owns flash decides that (D52).
class FrameLink {
 public:
  // Needs true entropy from boot. Nonces are HMAC(seed, counter), so they do not depend on the
  // hardware random generator's state later, while the radios are running.
  void seed(const crypto::Key&);
  // The relay chain at the floor, and the team chain at its own epoch, which is at or above it.
  bool set_chains(const crypto::Key& relay_chain, std::uint16_t floor,
                  const crypto::Key* team_chain, std::uint16_t team_epoch);
  bool set_chains(const crypto::Key& relay_chain, const crypto::Key* team_chain,
                  std::uint16_t epoch) {
    return set_chains(relay_chain, epoch, team_chain, epoch);
  }
  // A proof moved the floor. Keys below it are gone from here on.
  bool set_floor(const crypto::Key& relay_chain, std::uint16_t floor);
  // Moves the team chain forward by ratcheting it. Never moves it back.
  bool advance_team(std::uint16_t epoch);
  bool use_open_mode();
  // Holds no keys: everything is rejected and nothing can be sent.
  void clear();
  bool can_originate() const { return seeded_ && relay_ready_ && team_ready_; }
  // Refuses unless this radio holds the team key.
  bool seal(const Packet&, Frame&);
  // Needs only the relay key, for a proof this radio's agent has already had accepted.
  bool seal_proof(std::uint16_t epoch, const crypto::Key& proof, std::uint8_t hops, Frame&);
  // Rejected: not this team's, or a relay-key forgery. RelayOnly: valid, and this radio cannot read
  // it. Opened: `out` holds the packet, and a valid team tag from a newer epoch has moved this
  // radio to it. Proof: valid epoch proof frame.
  FrameResult receive(const std::uint8_t*, std::size_t, std::uint64_t now, Packet& out);
  FrameResult receive(const std::uint8_t* bytes, std::size_t size, Packet& out) {
    return receive(bytes, size, 0, out);
  }
  // Bounds hashing that unauthenticated frames can cause. Short walks are free, so honest traffic
  // across an advance is never held up, and the rest draws on a budget that refills with time.
  bool spend(std::uint32_t steps, std::uint64_t now);
  bool team_ready() const { return team_ready_; }
  std::uint16_t floor() const { return floor_; }
  std::uint16_t team_epoch() const { return team_epoch_; }
  const crypto::Key& team_chain() const { return team_chain_; }

 private:
  struct EpochSlot {
    bool used = false;
    std::uint16_t epoch = 0;
    crypto::Key chain{};
    RelayKeys keys{};
  };
  // The floor and this radio's sending epoch stay put. Two more hold whatever was recently valid,
  // so a thief's frames cannot push honest epochs out of the cache.
  static constexpr std::size_t kFloorSlot = 0, kCurrentSlot = 1, kRecentSlot = 2, kSlots = 4;
  bool store(EpochSlot&, const crypto::Key& chain, std::uint16_t epoch);
  void wipe_slot(EpochSlot&);
  bool derive_into(EpochSlot&, std::uint16_t epoch);
  const RelayKeys* relay_keys(std::uint32_t epoch, bool budgeted, std::uint64_t now);
  bool next_nonce(std::array<std::uint8_t, 8>&);
  bool walk_team(std::uint16_t epoch, crypto::Key& chain, crypto::Key& frame,
                 crypto::Key& previous) const;
  void adopt_team(std::uint16_t epoch, const crypto::Key& chain, const crypto::Key& frame,
                  const crypto::Key& previous);
  crypto::Key nonce_seed_{}, team_chain_{}, frame_key_{}, previous_key_{};
  std::array<EpochSlot, kSlots> slots_{};
  std::uint64_t nonce_counter_ = 0, budget_at_ = 0;
  std::uint32_t budget_ = kEpochLookAhead, window_ = 0;
  std::uint16_t floor_ = 0, team_epoch_ = 0;
  std::uint8_t next_recent_ = 0;
  bool seeded_ = false, relay_ready_ = false, team_ready_ = false, previous_ready_ = false;
};
}  // namespace reaper::mesh
