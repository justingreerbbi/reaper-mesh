#include "reaper/frame.hpp"
#include <cstring>
#include <limits>
namespace reaper::mesh {
namespace {
void write(std::uint8_t* p, std::uint64_t value, unsigned size) {
  for (unsigned i = 0; i < size; ++i)
    p[i] = static_cast<std::uint8_t>(value >> (i * 8));
}
std::uint64_t read(const std::uint8_t* p, unsigned size) {
  std::uint64_t value = 0;
  for (unsigned i = 0; i < size; ++i)
    value |= std::uint64_t(p[i]) << (i * 8);
  return value;
}
bool labeled(const std::uint8_t* key, std::size_t key_size, const char* label, crypto::Key& out) {
  const crypto::Slice part{reinterpret_cast<const std::uint8_t*>(label), std::strlen(label)};
  return crypto::hmac_sha256(key, key_size, &part, 1, out);
}
using Clear = std::array<std::uint8_t, kFrameClearBytes>;
// What the tags cover: the clear bytes with current hops removed, so relays can change them.
Clear additional_data(const std::uint8_t* frame) {
  Clear clear{};
  std::memcpy(clear.data(), frame, clear.size());
  clear[5] &= 0x70;
  return clear;
}
std::array<std::uint8_t, crypto::kCcmNonceBytes> ccm_nonce(const std::uint8_t* frame) {
  std::array<std::uint8_t, crypto::kCcmNonceBytes> nonce{};
  std::memcpy(nonce.data(), frame + 6, 8);
  std::memcpy(nonce.data() + 8, frame + 3, 2);
  return nonce;
}
bool relay_tag(const std::uint8_t* frame, std::size_t size, const crypto::Key& key,
               std::uint8_t* out) {
  const auto clear = additional_data(frame);
  const crypto::Slice parts[]{
      {clear.data(), clear.size()},
      {frame + kFrameClearBytes, size - kFrameClearBytes - kFrameRelayTagBytes}};
  crypto::Key digest{};
  if (!crypto::hmac_sha256(key.data(), key.size(), parts, 2, digest))
    return false;
  std::memcpy(out, digest.data(), kFrameRelayTagBytes);
  return true;
}
}  // namespace
bool ratchet_chain(crypto::Key& chain) {
  crypto::Key next{};
  if (!labeled(chain.data(), chain.size(), "reaper-v2 ratchet", next))
    return false;
  chain = next;
  crypto::wipe(next.data(), next.size());
  return true;
}
bool derive_relay_keys(const crypto::Key& relay_chain, RelayKeys& out) {
  crypto::Key tag{}, hint{};
  if (!labeled(relay_chain.data(), relay_chain.size(), "reaper-v2 relay tag", tag) ||
      !labeled(relay_chain.data(), relay_chain.size(), "reaper-v2 hint", hint))
    return false;
  out.tag = tag;
  std::memcpy(out.hint.data(), hint.data(), out.hint.size());
  crypto::wipe(tag.data(), tag.size());
  return true;
}
bool derive_frame_key(const crypto::Key& team_chain, crypto::Key& out) {
  return labeled(team_chain.data(), team_chain.size(), "reaper-v2 frame", out);
}
bool open_mode_chains(crypto::Key& relay_chain, crypto::Key& team_chain) {
  static constexpr char kOpen[] = "reaper-v2 open";
  const auto* key = reinterpret_cast<const std::uint8_t*>(kOpen);
  return labeled(key, sizeof(kOpen) - 1, "relay", relay_chain) &&
         labeled(key, sizeof(kOpen) - 1, "team", team_chain);
}
bool seal_frame(const Packet& p, std::uint16_t epoch,
                const std::array<std::uint8_t, 8>& nonce_bytes, const RelayKeys& relay,
                const crypto::Key& frame_key, std::uint8_t* out, std::size_t capacity,
                std::size_t& size) {
  size = 0;
  const std::size_t total = kFrameOverheadBytes + p.size;
  if (!out || capacity < total || !valid_packet(p))
    return false;
  std::array<std::uint8_t, kMaxFrameBytes> frame{};
  frame[0] = 2;
  std::memcpy(frame.data() + 1, relay.hint.data(), relay.hint.size());
  write(frame.data() + 3, epoch, 2);
  frame[5] = static_cast<std::uint8_t>(p.hops | p.hops << 4);
  std::memcpy(frame.data() + 6, nonce_bytes.data(), nonce_bytes.size());
  std::array<std::uint8_t, kFrameHeaderBytes + kFragmentBytes> plain{};
  plain[0] = static_cast<std::uint8_t>(p.kind);
  write(plain.data() + 1, p.channel, 4);
  write(plain.data() + 5, p.key.origin, 8);
  write(plain.data() + 13, p.destination, 8);
  write(plain.data() + 21, p.key.boot, 4);
  write(plain.data() + 25, p.key.sequence, 4);
  plain[29] = static_cast<std::uint8_t>(p.count << 4 | p.index);
  write(plain.data() + 30, p.total, 2);
  std::memcpy(plain.data() + kFrameHeaderBytes, p.bytes.data(), p.size);
  const std::size_t sealed = kFrameHeaderBytes + p.size;
  const auto clear = additional_data(frame.data());
  const auto nonce = ccm_nonce(frame.data());
  const bool ok =
      crypto::aes256_ccm_seal(frame_key, nonce.data(), clear.data(), clear.size(), plain.data(),
                              sealed, frame.data() + kFrameClearBytes,
                              frame.data() + kFrameClearBytes + sealed) &&
      relay_tag(frame.data(), total, relay.tag, frame.data() + total - kFrameRelayTagBytes);
  crypto::wipe(plain.data(), plain.size());
  if (!ok)
    return false;
  std::memcpy(out, frame.data(), total);
  size = total;
  return true;
}
bool parse_route(const std::uint8_t* bytes, std::size_t size, FrameRoute& out) {
  if (!valid_frame_layout(bytes, size))
    return false;
  FrameRoute route{};
  route.epoch = static_cast<std::uint16_t>(read(bytes + 3, 2));
  route.hops = bytes[5] & 7;
  route.limit = (bytes[5] >> 4) & 7;
  std::memcpy(route.nonce.data(), bytes + 6, route.nonce.size());
  out = route;
  return true;
}
bool verify_relay_tag(const std::uint8_t* bytes, std::size_t size, const RelayKeys& relay) {
  FrameRoute route{};
  if (!parse_route(bytes, size, route) || !crypto::equal(bytes + 1, relay.hint.data(), 2))
    return false;
  std::array<std::uint8_t, kFrameRelayTagBytes> expected{};
  return relay_tag(bytes, size, relay.tag, expected.data()) &&
         crypto::equal(bytes + size - kFrameRelayTagBytes, expected.data(), expected.size());
}
bool open_frame(const std::uint8_t* bytes, std::size_t size, const crypto::Key& frame_key,
                Packet& out) {
  FrameRoute route{};
  if (!parse_route(bytes, size, route))
    return false;
  const std::size_t sealed = size - kFrameClearBytes - kFrameTeamTagBytes - kFrameRelayTagBytes;
  const auto clear = additional_data(bytes);
  const auto nonce = ccm_nonce(bytes);
  std::array<std::uint8_t, kFrameHeaderBytes + kFragmentBytes> plain{};
  if (!crypto::aes256_ccm_open(frame_key, nonce.data(), clear.data(), clear.size(),
                               bytes + kFrameClearBytes, sealed, plain.data(),
                               bytes + kFrameClearBytes + sealed)) {
    crypto::wipe(plain.data(), plain.size());
    return false;
  }
  Packet p{};
  p.kind = static_cast<PacketKind>(plain[0]);
  p.channel = static_cast<std::uint32_t>(read(plain.data() + 1, 4));
  p.key.origin = read(plain.data() + 5, 8);
  p.destination = read(plain.data() + 13, 8);
  p.key.boot = static_cast<std::uint32_t>(read(plain.data() + 21, 4));
  p.key.sequence = static_cast<std::uint32_t>(read(plain.data() + 25, 4));
  p.count = plain[29] >> 4;
  p.index = plain[29] & 15;
  p.total = static_cast<std::uint16_t>(read(plain.data() + 30, 2));
  p.size = static_cast<std::uint8_t>(sealed - kFrameHeaderBytes);
  p.hops = route.hops;
  std::memcpy(p.bytes.data(), plain.data() + kFrameHeaderBytes, p.size);
  crypto::wipe(plain.data(), plain.size());
  if (!valid_packet(p))
    return false;
  out = p;
  return true;
}
bool decrement_hops(std::uint8_t* bytes, std::size_t size) {
  FrameRoute route{};
  if (!parse_route(bytes, size, route) || !route.hops)
    return false;
  --bytes[5];
  return true;
}
void FrameLink::seed(const crypto::Key& seed) {
  nonce_seed_ = seed;
  nonce_counter_ = 0;
  seeded_ = true;
}
bool FrameLink::set_chains(const crypto::Key& relay_chain, const crypto::Key* team_chain,
                           std::uint16_t epoch) {
  relay_ready_ = team_ready_ = false;
  crypto::wipe(frame_key_.data(), frame_key_.size());
  if (!derive_relay_keys(relay_chain, relay_))
    return false;
  relay_ready_ = true;
  epoch_ = epoch;
  if (team_chain) {
    team_ready_ = derive_frame_key(*team_chain, frame_key_);
    return team_ready_;
  }
  return true;
}
void FrameLink::clear() {
  relay_ready_ = team_ready_ = false;
  crypto::wipe(frame_key_.data(), frame_key_.size());
  crypto::wipe(relay_.tag.data(), relay_.tag.size());
}
bool FrameLink::use_open_mode() {
  crypto::Key relay{}, team{};
  const bool ok = open_mode_chains(relay, team) && set_chains(relay, &team, 0);
  crypto::wipe(relay.data(), relay.size());
  crypto::wipe(team.data(), team.size());
  return ok;
}
bool FrameLink::seal(const Packet& p, Frame& out) {
  out.size = 0;
  if (!can_originate() || nonce_counter_ == std::numeric_limits<std::uint64_t>::max())
    return false;
  std::array<std::uint8_t, 8> counter{};
  write(counter.data(), ++nonce_counter_, 8);
  const crypto::Slice part{counter.data(), counter.size()};
  crypto::Key digest{};
  if (!crypto::hmac_sha256(nonce_seed_.data(), nonce_seed_.size(), &part, 1, digest))
    return false;
  std::array<std::uint8_t, 8> nonce{};
  std::memcpy(nonce.data(), digest.data(), nonce.size());
  return seal_frame(p, epoch_, nonce, relay_, frame_key_, out.bytes.data(), out.bytes.size(),
                    out.size);
}
FrameResult FrameLink::receive(const std::uint8_t* bytes, std::size_t size, Packet& out) const {
  FrameRoute route{};
  if (!relay_ready_ || !parse_route(bytes, size, route) || route.epoch != epoch_ ||
      !verify_relay_tag(bytes, size, relay_))
    return FrameResult::Rejected;
  if (!team_ready_)
    return FrameResult::RelayOnly;
  return open_frame(bytes, size, frame_key_, out) ? FrameResult::Opened : FrameResult::Rejected;
}
}  // namespace reaper::mesh
