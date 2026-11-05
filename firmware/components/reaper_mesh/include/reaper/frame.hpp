#pragma once
#include "reaper/crypto.hpp"
#include "reaper/radio_packet.hpp"
// Radio version 2 (D50): docs/reference/radio-protocol.md. Portable and heap-free. Nothing here
// decides which keys a radio holds. A relay calls parse_route, verify_relay_tag and decrement_hops
// only; open_frame needs the team key.
namespace reaper::mesh {
inline constexpr std::size_t kFrameClearBytes = 14, kFrameHeaderBytes = 32, kFrameTeamTagBytes = 8,
                             kFrameRelayTagBytes = 4,
                             kFrameOverheadBytes = kFrameClearBytes + kFrameHeaderBytes +
                                                   kFrameTeamTagBytes + kFrameRelayTagBytes,
                             kMaxFrameBytes = kFrameOverheadBytes + kFragmentBytes;
struct RelayKeys {
  crypto::Key tag{};
  std::array<std::uint8_t, 2> hint{};
};
struct FrameRoute {
  std::uint16_t epoch = 0;
  std::uint8_t hops = 0, limit = 0;
  std::array<std::uint8_t, 8> nonce{};
};
struct FrameFields {
  PacketKind kind = PacketKind::Data;
  std::uint32_t channel = 0, boot = 0, sequence = 0;
  std::uint64_t origin = 0, destination = 0;
  std::uint8_t count = 0, index = 0, size = 0;
  std::uint16_t total = 0;
  std::array<std::uint8_t, kFragmentBytes> bytes{};
};
bool ratchet_chain(crypto::Key& chain);
bool derive_relay_keys(const crypto::Key& relay_chain, RelayKeys& out);
bool derive_frame_key(const crypto::Key& team_chain, crypto::Key& out);
// Published chains for Open mode, which provide no secrecy.
bool open_mode_chains(crypto::Key& relay_chain, crypto::Key& team_chain);
bool valid_frame_fields(const FrameFields&);
bool seal_frame(const FrameFields&, const FrameRoute&, const RelayKeys&,
                const crypto::Key& frame_key, std::uint8_t* out, std::size_t capacity,
                std::size_t& size);
// Layout checks only, before any cryptography. The result is unauthenticated.
bool parse_route(const std::uint8_t*, std::size_t, FrameRoute&);
bool verify_relay_tag(const std::uint8_t*, std::size_t, const RelayKeys&);
// Publishes `out` only after authentication and validation both pass.
bool open_frame(const std::uint8_t*, std::size_t, const crypto::Key& frame_key, FrameFields& out);
// The relay tag and team tag exclude current hops, so both stay valid.
bool decrement_hops(std::uint8_t*, std::size_t);
}  // namespace reaper::mesh
