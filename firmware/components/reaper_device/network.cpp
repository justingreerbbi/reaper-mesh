#include "reaper/network.hpp"
#include "reaper/protocol.hpp"
#include <cstring>
namespace reaper::device {
namespace {
void write_le(std::uint8_t* p, std::uint32_t value, unsigned size) {
  for (unsigned i = 0; i < size; ++i)
    p[i] = static_cast<std::uint8_t>(value >> (i * 8));
}
std::uint32_t read_le(const std::uint8_t* p, unsigned size) {
  std::uint32_t value = 0;
  for (unsigned i = 0; i < size; ++i)
    value |= std::uint32_t(p[i]) << (i * 8);
  return value;
}
bool all_zero(const crypto::Key& key) {
  std::uint8_t bits = 0;
  for (auto byte : key)
    bits |= byte;
  return !bits;
}
void fingerprint(const crypto::Key& chain, char* out) {
  static constexpr char kLabel[] = "reaper-v2 fingerprint";
  const crypto::Slice part{reinterpret_cast<const std::uint8_t*>(kLabel), sizeof(kLabel) - 1};
  crypto::Key digest{};
  out[0] = 0;
  if (!crypto::hmac_sha256(chain.data(), chain.size(), &part, 1, digest))
    return;
  static constexpr char kDigits[] = "0123456789abcdef";
  for (unsigned i = 0; i < 8; ++i) {
    out[i * 2] = kDigits[digest[i] >> 4];
    out[i * 2 + 1] = kDigits[digest[i] & 15];
  }
  out[16] = 0;
}
}  // namespace
void Network::encode(const Record& r, std::uint8_t* out) {
  out[0] = 'R';
  out[1] = 'K';
  out[2] = 1;
  out[3] = static_cast<std::uint8_t>(r.mode);
  write_le(out + 4, r.sequence, 4);
  write_le(out + 8, r.generation, 2);
  write_le(out + 10, r.epoch, 2);
  std::memcpy(out + 12, r.relay_chain.data(), r.relay_chain.size());
  std::memcpy(out + 44, r.device_key.data(), r.device_key.size());
  write_le(out + 76, protocol::crc32(out, 76), 4);
}
bool Network::decode(const std::uint8_t* in, Record& out) {
  if (in[0] != 'R' || in[1] != 'K' || in[2] != 1 || protocol::crc32(in, 76) != read_le(in + 76, 4))
    return false;
  if (in[3] != static_cast<std::uint8_t>(NetworkMode::Open) &&
      in[3] != static_cast<std::uint8_t>(NetworkMode::Team))
    return false;
  out.mode = static_cast<NetworkMode>(in[3]);
  out.sequence = read_le(in + 4, 4);
  out.generation = static_cast<std::uint16_t>(read_le(in + 8, 2));
  out.epoch = static_cast<std::uint16_t>(read_le(in + 10, 2));
  std::memcpy(out.relay_chain.data(), in + 12, out.relay_chain.size());
  std::memcpy(out.device_key.data(), in + 44, out.device_key.size());
  return true;
}
void Network::begin() {
  record_ = {};
  active_ = -1;
  forget_team();
  healthy_ = true;
  std::array<std::uint8_t, kRecordBytes> bytes{};
  Record found[KeySectors::kSectors]{};
  bool valid[KeySectors::kSectors]{};
  for (unsigned sector = 0; sector < KeySectors::kSectors; ++sector) {
    if (!sectors_.read(sector, bytes.data(), bytes.size())) {
      healthy_ = false;  // Fail closed rather than picking an older key from the other sector.
      crypto::wipe(bytes.data(), bytes.size());
      ++revision_;
      return;
    }
    valid[sector] = decode(bytes.data(), found[sector]);
  }
  crypto::wipe(bytes.data(), bytes.size());
  if (valid[0] && (!valid[1] || found[0].sequence >= found[1].sequence))
    active_ = 0;
  else if (valid[1])
    active_ = 1;
  if (active_ >= 0) {
    record_ = found[active_];
    // A power cut can leave the old record behind. Finish erasing it.
    const unsigned other = 1u - active_;
    if (valid[other])
      sectors_.erase(other);
  }
  for (auto& item : found) {
    crypto::wipe(item.relay_chain.data(), item.relay_chain.size());
    crypto::wipe(item.device_key.data(), item.device_key.size());
  }
  ++revision_;
}
bool Network::save(Record& next) {
  next.sequence = record_.sequence + 1;
  const unsigned target = active_ == 0 ? 1 : 0;
  std::array<std::uint8_t, kRecordBytes> bytes{}, check{};
  encode(next, bytes.data());
  bool ok = sectors_.erase(target) && sectors_.write(target, bytes.data(), bytes.size()) &&
            sectors_.read(target, check.data(), check.size()) && check == bytes;
  crypto::wipe(bytes.data(), bytes.size());
  crypto::wipe(check.data(), check.size());
  if (!ok)
    return false;
  // The new record is safe. If this erase fails, the next boot retries it.
  if (active_ >= 0)
    sectors_.erase(static_cast<unsigned>(active_));
  active_ = static_cast<int>(target);
  return true;
}
void Network::forget_team() {
  crypto::wipe(team_chain_.data(), team_chain_.size());
  team_loaded_ = false;
}
NetworkView Network::view() const {
  NetworkView view{};
  view.mode = static_cast<std::uint32_t>(record_.mode);
  view.generation = record_.generation;
  view.epoch = record_.epoch;
  view.team_loaded = team_loaded_;
  view.healthy = healthy_;
  if (record_.mode == NetworkMode::Team) {
    fingerprint(record_.relay_chain, view.relay_fingerprint);
    if (team_loaded_)
      fingerprint(team_chain_, view.team_fingerprint);
  }
  return view;
}
const char* Network::fill(std::uint32_t mode, std::uint32_t generation, std::uint32_t epoch,
                          const crypto::Key* relay_chain, const crypto::Key* device_key) {
  if (!healthy_)
    return "storage-failed";
  Record next{};
  if (mode == static_cast<std::uint32_t>(NetworkMode::Open)) {
    if (generation || epoch || relay_chain || device_key)
      return "invalid";
    next.mode = NetworkMode::Open;
  } else if (mode == static_cast<std::uint32_t>(NetworkMode::Team)) {
    if (!generation || generation > 0xffff || epoch > 0xffff || !relay_chain || !device_key ||
        all_zero(*relay_chain) || all_zero(*device_key))
      return "invalid";
    next.mode = NetworkMode::Team;
    next.generation = static_cast<std::uint16_t>(generation);
    next.epoch = static_cast<std::uint16_t>(epoch);
    next.relay_chain = *relay_chain;
    next.device_key = *device_key;
  } else {
    return "invalid";
  }
  // Retrying a fill whose reply was lost changes nothing and spends no flash.
  const bool same = active_ >= 0 && next.mode == record_.mode &&
                    next.generation == record_.generation && next.epoch == record_.epoch &&
                    next.relay_chain == record_.relay_chain &&
                    next.device_key == record_.device_key;
  const char* state = "ok";
  if (!same) {
    if (save(next)) {
      record_ = next;
      forget_team();
      ++revision_;
    } else {
      state = "storage-failed";
    }
  }
  crypto::wipe(next.relay_chain.data(), next.relay_chain.size());
  crypto::wipe(next.device_key.data(), next.device_key.size());
  return state;
}
const char* Network::load_team(std::uint32_t generation, std::uint32_t epoch,
                               const crypto::Key& team_chain) {
  if (record_.mode != NetworkMode::Team)
    return "not-team";
  if (generation != record_.generation || epoch != record_.epoch)
    return "mismatch";
  if (all_zero(team_chain))
    return "invalid";
  if (team_loaded_ && team_chain == team_chain_)
    return "ok";
  team_chain_ = team_chain;
  team_loaded_ = true;
  ++revision_;
  return "ok";
}
const char* Network::erase() {
  bool ok = true;
  for (unsigned sector = 0; sector < KeySectors::kSectors; ++sector)
    ok = sectors_.erase(sector) && ok;
  crypto::wipe(record_.relay_chain.data(), record_.relay_chain.size());
  crypto::wipe(record_.device_key.data(), record_.device_key.size());
  forget_team();
  record_ = {};
  active_ = -1;
  healthy_ = healthy_ && ok;
  ++revision_;
  return ok ? "ok" : "storage-failed";
}
bool Network::apply(mesh::FrameLink& link) const {
  link.clear();
  if (record_.mode == NetworkMode::Open)
    return link.use_open_mode();
  if (record_.mode == NetworkMode::Team)
    return link.set_chains(record_.relay_chain, team_loaded_ ? &team_chain_ : nullptr,
                           record_.epoch);
  return false;
}
}  // namespace reaper::device
