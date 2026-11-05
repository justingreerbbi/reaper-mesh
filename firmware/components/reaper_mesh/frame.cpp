#include "reaper/frame.hpp"
#include <cstring>
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
  const crypto::Slice parts[]{{clear.data(), clear.size()},
                              {frame + kFrameClearBytes,
                               size - kFrameClearBytes - kFrameRelayTagBytes}};
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
bool valid_frame_fields(const FrameFields& f) {
  if (!f.origin || f.origin == kBroadcast || !f.destination || !f.boot || !f.sequence ||
      f.channel == ChannelSet::kNoChannel || f.size > kFragmentBytes)
    return false;
  switch (f.kind) {
    case PacketKind::Ack:
      return f.destination != kBroadcast && !f.count && !f.index && !f.total && !f.size;
    case PacketKind::Beacon:
    case PacketKind::Discover:
    case PacketKind::Presence:
      return !f.channel && f.count == 1 && !f.index && f.total == f.size && f.size >= 2 &&
             (f.kind == PacketKind::Presence ? f.destination != kBroadcast
                                             : f.destination == kBroadcast);
    case PacketKind::Data: {
      if (!f.total || f.total > kMaxMessageBytes ||
          f.count != (f.total + kFragmentBytes - 1) / kFragmentBytes || f.index >= f.count)
        return false;
      const auto expected =
          f.index + 1 < f.count ? kFragmentBytes : f.total - f.index * kFragmentBytes;
      return f.size == expected;
    }
  }
  return false;
}
bool seal_frame(const FrameFields& f, const FrameRoute& route, const RelayKeys& relay,
                const crypto::Key& frame_key, std::uint8_t* out, std::size_t capacity,
                std::size_t& size) {
  size = 0;
  const std::size_t total = kFrameOverheadBytes + f.size;
  if (!out || capacity < total || !valid_frame_fields(f) || route.limit > 7 ||
      route.hops > route.limit)
    return false;
  std::array<std::uint8_t, kMaxFrameBytes> frame{};
  frame[0] = 2;
  std::memcpy(frame.data() + 1, relay.hint.data(), relay.hint.size());
  write(frame.data() + 3, route.epoch, 2);
  frame[5] = static_cast<std::uint8_t>(route.hops | route.limit << 4);
  std::memcpy(frame.data() + 6, route.nonce.data(), route.nonce.size());
  std::array<std::uint8_t, kFrameHeaderBytes + kFragmentBytes> plain{};
  plain[0] = static_cast<std::uint8_t>(f.kind);
  write(plain.data() + 1, f.channel, 4);
  write(plain.data() + 5, f.origin, 8);
  write(plain.data() + 13, f.destination, 8);
  write(plain.data() + 21, f.boot, 4);
  write(plain.data() + 25, f.sequence, 4);
  plain[29] = static_cast<std::uint8_t>(f.count << 4 | f.index);
  write(plain.data() + 30, f.total, 2);
  std::memcpy(plain.data() + kFrameHeaderBytes, f.bytes.data(), f.size);
  const std::size_t sealed = kFrameHeaderBytes + f.size;
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
  if (!bytes || size < kFrameOverheadBytes || size > kMaxFrameBytes || bytes[0] != 2 ||
      (bytes[5] & 0x88))
    return false;
  FrameRoute route{};
  route.epoch = static_cast<std::uint16_t>(read(bytes + 3, 2));
  route.hops = bytes[5] & 7;
  route.limit = (bytes[5] >> 4) & 7;
  if (route.hops > route.limit)
    return false;
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
                FrameFields& out) {
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
  FrameFields f{};
  f.kind = static_cast<PacketKind>(plain[0]);
  f.channel = static_cast<std::uint32_t>(read(plain.data() + 1, 4));
  f.origin = read(plain.data() + 5, 8);
  f.destination = read(plain.data() + 13, 8);
  f.boot = static_cast<std::uint32_t>(read(plain.data() + 21, 4));
  f.sequence = static_cast<std::uint32_t>(read(plain.data() + 25, 4));
  f.count = plain[29] >> 4;
  f.index = plain[29] & 15;
  f.total = static_cast<std::uint16_t>(read(plain.data() + 30, 2));
  f.size = static_cast<std::uint8_t>(sealed - kFrameHeaderBytes);
  std::memcpy(f.bytes.data(), plain.data() + kFrameHeaderBytes, f.size);
  crypto::wipe(plain.data(), plain.size());
  if (!valid_frame_fields(f))
    return false;
  out = f;
  return true;
}
bool decrement_hops(std::uint8_t* bytes, std::size_t size) {
  FrameRoute route{};
  if (!parse_route(bytes, size, route) || !route.hops)
    return false;
  --bytes[5];
  return true;
}
}  // namespace reaper::mesh
