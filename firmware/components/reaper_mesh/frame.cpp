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
bool previous_proof(const crypto::Key& proof, crypto::Key& previous) {
  return labeled(proof.data(), proof.size(), "reaper-v2 epoch proof", previous);
}
bool proof_reaches(const crypto::Key& proof, std::uint32_t steps, const crypto::Key& known) {
  crypto::Key walk = proof, next{};
  for (std::uint32_t i = 0; i < steps; ++i) {
    if (!previous_proof(walk, next))
      return false;
    walk = next;
  }
  return crypto::equal(walk.data(), known.data(), walk.size());
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
bool seal_proof_frame(std::uint16_t epoch, const crypto::Key& proof,
                      const std::array<std::uint8_t, 8>& nonce, std::uint8_t hops,
                      const RelayKeys& relay, std::uint8_t* out, std::size_t capacity,
                      std::size_t& size) {
  size = 0;
  if (!out || capacity < kProofFrameBytes || hops > 7)
    return false;
  std::array<std::uint8_t, kProofFrameBytes> frame{};
  frame[0] = kNetworkFrameByte;
  std::memcpy(frame.data() + 1, relay.hint.data(), relay.hint.size());
  write(frame.data() + 3, epoch, 2);
  frame[5] = static_cast<std::uint8_t>(hops | hops << 4);
  std::memcpy(frame.data() + 6, nonce.data(), nonce.size());
  frame[kFrameClearBytes] = kNetworkTypeProof;
  std::memcpy(frame.data() + kFrameClearBytes + 1, proof.data(), proof.size());
  if (!relay_tag(frame.data(), frame.size(), relay.tag,
                 frame.data() + frame.size() - kFrameRelayTagBytes))
    return false;
  std::memcpy(out, frame.data(), frame.size());
  size = frame.size();
  return true;
}
crypto::Key frame_proof(const std::uint8_t* frame) {
  crypto::Key proof{};
  std::memcpy(proof.data(), frame + kFrameClearBytes + 1, proof.size());
  return proof;
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
  if (!parse_route(bytes, size, route) || bytes[0] != 2)
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
namespace {
// Walks this short cost nothing, and a whole look-ahead takes 16 seconds to earn back.
constexpr std::uint32_t kFreeSteps = 4, kBudgetPerSecond = 64;
}  // namespace
void FrameLink::seed(const crypto::Key& seed) {
  nonce_seed_ = seed;
  nonce_counter_ = 0;
  seeded_ = true;
}
void FrameLink::wipe_slot(EpochSlot& slot) {
  crypto::wipe(slot.chain.data(), slot.chain.size());
  crypto::wipe(slot.keys.tag.data(), slot.keys.tag.size());
  slot.used = false;
}
bool FrameLink::store(EpochSlot& slot, const crypto::Key& chain, std::uint16_t epoch) {
  RelayKeys keys{};
  if (!derive_relay_keys(chain, keys))
    return false;
  slot.chain = chain;
  slot.keys = keys;
  slot.epoch = epoch;
  slot.used = true;
  crypto::wipe(keys.tag.data(), keys.tag.size());
  return true;
}
// Starts from the nearest cached epoch at or below this one. The floor is always cached.
bool FrameLink::derive_into(EpochSlot& slot, std::uint16_t epoch) {
  const EpochSlot* base = nullptr;
  for (const auto& candidate : slots_)
    if (candidate.used && candidate.epoch <= epoch && (!base || candidate.epoch > base->epoch))
      base = &candidate;
  if (!base)
    return false;
  crypto::Key chain = base->chain;
  bool ok = true;
  for (std::uint32_t at = base->epoch; ok && at < epoch; ++at)
    ok = ratchet_chain(chain);
  ok = ok && store(slot, chain, epoch);
  crypto::wipe(chain.data(), chain.size());
  return ok;
}
bool FrameLink::spend(std::uint32_t steps, std::uint64_t now) {
  if (steps <= kFreeSteps)
    return true;
  if (now > budget_at_) {
    const auto earned = (now - budget_at_) * kBudgetPerSecond / 1000;
    if (earned) {
      budget_ = earned >= kEpochLookAhead - budget_ ? kEpochLookAhead
                                                    : budget_ + static_cast<std::uint32_t>(earned);
      budget_at_ = now;
    }
  }
  if (budget_ < steps)
    return false;
  budget_ -= steps;
  return true;
}
const RelayKeys* FrameLink::relay_keys(std::uint32_t epoch, bool budgeted, std::uint64_t now) {
  if (!relay_ready_ || epoch < floor_ || epoch > std::uint32_t(floor_) + window_)
    return nullptr;
  std::uint32_t nearest = floor_;
  for (auto& slot : slots_)
    if (slot.used) {
      if (slot.epoch == epoch)
        return &slot.keys;
      if (slot.epoch < epoch && slot.epoch > nearest)
        nearest = slot.epoch;
    }
  if (budgeted && !spend(epoch - nearest, now))
    return nullptr;
  auto& slot = slots_[kRecentSlot + next_recent_];
  next_recent_ = (next_recent_ + 1) % (kSlots - kRecentSlot);
  return derive_into(slot, static_cast<std::uint16_t>(epoch)) ? &slot.keys : nullptr;
}
bool FrameLink::set_chains(const crypto::Key& relay_chain, std::uint16_t floor,
                           const crypto::Key* team_chain, std::uint16_t team_epoch) {
  clear();
  window_ = kEpochLookAhead;
  floor_ = floor;
  if (!store(slots_[kFloorSlot], relay_chain, floor))
    return false;
  relay_ready_ = true;
  if (!team_chain)
    return true;
  if (team_epoch < floor || !derive_frame_key(*team_chain, frame_key_) ||
      !derive_into(slots_[kCurrentSlot], team_epoch))
    return false;
  team_chain_ = *team_chain;
  team_epoch_ = team_epoch;
  team_ready_ = true;
  return true;
}
bool FrameLink::set_floor(const crypto::Key& relay_chain, std::uint16_t floor) {
  if (!relay_ready_ || floor < floor_)
    return false;
  for (auto& slot : slots_)
    if (slot.used && slot.epoch < floor)
      wipe_slot(slot);
  floor_ = floor;
  return store(slots_[kFloorSlot], relay_chain, floor);
}
bool FrameLink::walk_team(std::uint16_t epoch, crypto::Key& chain, crypto::Key& frame,
                          crypto::Key& previous) const {
  chain = team_chain_;
  for (std::uint32_t at = team_epoch_; at + 1 < epoch; ++at)
    if (!ratchet_chain(chain))
      return false;
  return derive_frame_key(chain, previous) && ratchet_chain(chain) &&
         derive_frame_key(chain, frame);
}
void FrameLink::adopt_team(std::uint16_t epoch, const crypto::Key& chain, const crypto::Key& frame,
                           const crypto::Key& previous) {
  team_chain_ = chain;
  team_epoch_ = epoch;
  frame_key_ = frame;
  previous_key_ = previous;
  previous_ready_ = true;
  // Sealing reads this slot. A failure here leaves no way to send, rather than a wrong tag.
  if (!derive_into(slots_[kCurrentSlot], epoch))
    team_ready_ = false;
}
bool FrameLink::advance_team(std::uint16_t epoch) {
  if (!team_ready_ || epoch < team_epoch_)
    return false;
  if (epoch == team_epoch_)
    return true;
  crypto::Key chain{}, frame{}, previous{};
  const bool ok = walk_team(epoch, chain, frame, previous);
  if (ok)
    adopt_team(epoch, chain, frame, previous);
  crypto::wipe(chain.data(), chain.size());
  crypto::wipe(frame.data(), frame.size());
  crypto::wipe(previous.data(), previous.size());
  return ok && team_ready_;
}
void FrameLink::clear() {
  relay_ready_ = team_ready_ = previous_ready_ = false;
  window_ = floor_ = team_epoch_ = 0;
  crypto::wipe(team_chain_.data(), team_chain_.size());
  crypto::wipe(frame_key_.data(), frame_key_.size());
  crypto::wipe(previous_key_.data(), previous_key_.size());
  for (auto& slot : slots_)
    wipe_slot(slot);
}
bool FrameLink::use_open_mode() {
  crypto::Key relay{}, team{};
  bool ok = open_mode_chains(relay, team) && set_chains(relay, &team, 0);
  window_ = 0;  // Published keys, so Open mode stays at epoch 0.
  crypto::wipe(relay.data(), relay.size());
  crypto::wipe(team.data(), team.size());
  return ok;
}
bool FrameLink::next_nonce(std::array<std::uint8_t, 8>& nonce) {
  if (!seeded_ || nonce_counter_ == std::numeric_limits<std::uint64_t>::max())
    return false;
  std::array<std::uint8_t, 8> counter{};
  write(counter.data(), ++nonce_counter_, 8);
  const crypto::Slice part{counter.data(), counter.size()};
  crypto::Key digest{};
  if (!crypto::hmac_sha256(nonce_seed_.data(), nonce_seed_.size(), &part, 1, digest))
    return false;
  std::memcpy(nonce.data(), digest.data(), nonce.size());
  return true;
}
bool FrameLink::seal(const Packet& p, Frame& out) {
  out.size = 0;
  std::array<std::uint8_t, 8> nonce{};
  if (!can_originate() || !slots_[kCurrentSlot].used || !next_nonce(nonce))
    return false;
  return seal_frame(p, team_epoch_, nonce, slots_[kCurrentSlot].keys, frame_key_, out.bytes.data(),
                    out.bytes.size(), out.size);
}
bool FrameLink::seal_proof(std::uint16_t epoch, const crypto::Key& proof, std::uint8_t hops,
                           Frame& out) {
  out.size = 0;
  std::array<std::uint8_t, 8> nonce{};
  const auto* relay = relay_keys(epoch, false, 0);
  if (!relay || !window_ || !next_nonce(nonce))
    return false;
  return seal_proof_frame(epoch, proof, nonce, hops, *relay, out.bytes.data(), out.bytes.size(),
                          out.size);
}
FrameResult FrameLink::receive(const std::uint8_t* bytes, std::size_t size, std::uint64_t now,
                               Packet& out) {
  FrameRoute route{};
  if (!parse_route(bytes, size, route))
    return FrameResult::Rejected;
  const auto* relay = relay_keys(route.epoch, true, now);
  if (!relay || !verify_relay_tag(bytes, size, *relay))
    return FrameResult::Rejected;
  if (bytes[0] == kNetworkFrameByte)
    return window_ ? FrameResult::Proof : FrameResult::Rejected;
  if (!team_ready_)
    return FrameResult::RelayOnly;
  if (route.epoch == team_epoch_)
    return open_frame(bytes, size, frame_key_, out) ? FrameResult::Opened : FrameResult::Rejected;
  if (route.epoch < team_epoch_)
    return previous_ready_ && route.epoch + 1u == team_epoch_ &&
                   open_frame(bytes, size, previous_key_, out)
               ? FrameResult::Opened
               : FrameResult::Rejected;
  // A newer epoch counts only once its team tag verifies, which a relay key alone cannot produce.
  if (!spend(route.epoch - team_epoch_, now))
    return FrameResult::Rejected;
  crypto::Key chain{}, frame{}, previous{};
  const bool ok =
      walk_team(route.epoch, chain, frame, previous) && open_frame(bytes, size, frame, out);
  if (ok)
    adopt_team(route.epoch, chain, frame, previous);
  crypto::wipe(chain.data(), chain.size());
  crypto::wipe(frame.data(), frame.size());
  crypto::wipe(previous.data(), previous.size());
  return ok ? FrameResult::Opened : FrameResult::Rejected;
}
}  // namespace reaper::mesh
