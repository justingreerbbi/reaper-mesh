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
  out[2] = 2;
  out[3] = static_cast<std::uint8_t>(r.mode);
  write_le(out + 4, r.sequence, 4);
  write_le(out + 8, r.generation, 2);
  write_le(out + 10, r.epoch, 2);
  write_le(out + 12, r.proven, 2);
  std::memcpy(out + 14, r.relay_chain.data(), r.relay_chain.size());
  std::memcpy(out + 46, r.device_key.data(), r.device_key.size());
  std::memcpy(out + 78, r.proof.data(), r.proof.size());
  write_le(out + 110, protocol::crc32(out, 110), 4);
}
bool Network::decode(const std::uint8_t* in, Record& out) {
  if (in[0] != 'R' || in[1] != 'K' || in[2] != 2 ||
      protocol::crc32(in, 110) != read_le(in + 110, 4))
    return false;
  if (in[3] != static_cast<std::uint8_t>(NetworkMode::Open) &&
      in[3] != static_cast<std::uint8_t>(NetworkMode::Team))
    return false;
  out.mode = static_cast<NetworkMode>(in[3]);
  out.sequence = read_le(in + 4, 4);
  out.generation = static_cast<std::uint16_t>(read_le(in + 8, 2));
  out.epoch = static_cast<std::uint16_t>(read_le(in + 10, 2));
  out.proven = static_cast<std::uint16_t>(read_le(in + 12, 2));
  std::memcpy(out.relay_chain.data(), in + 14, out.relay_chain.size());
  std::memcpy(out.device_key.data(), in + 46, out.device_key.size());
  std::memcpy(out.proof.data(), in + 78, out.proof.size());
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
  // The new record is safe. If this erase fails, the next boot retries it. With no active record,
  // this also clears anything unreadable, such as a record from an older format.
  sectors_.erase(active_ >= 0 ? static_cast<unsigned>(active_) : 1u - target);
  active_ = static_cast<int>(target);
  return true;
}
void Network::forget_team() {
  crypto::wipe(team_chain_.data(), team_chain_.size());
  team_loaded_ = false;
  team_epoch_ = 0;
  announce_ = false;
}
NetworkView Network::view() const {
  NetworkView view{};
  view.mode = static_cast<std::uint32_t>(record_.mode);
  view.generation = record_.generation;
  view.epoch = team_loaded_ ? team_epoch_ : record_.epoch;
  view.proven_epoch = record_.proven;
  view.team_loaded = team_loaded_;
  view.healthy = healthy_;
  if (record_.mode == NetworkMode::Team) {
    fingerprint(record_.relay_chain, view.relay_fingerprint);
    if (team_loaded_)
      fingerprint(team_chain_, view.team_fingerprint);
    // Public once released, and stable across epochs, so agents use this to recognize their team.
    static constexpr char kDigits[] = "0123456789abcdef";
    for (std::size_t i = 0; i < record_.proof.size(); ++i) {
      view.proof[i * 2] = kDigits[record_.proof[i] >> 4];
      view.proof[i * 2 + 1] = kDigits[record_.proof[i] & 15];
    }
    view.proof[64] = 0;
  }
  return view;
}
const char* Network::fill(std::uint32_t mode, std::uint32_t generation, std::uint32_t epoch,
                          const crypto::Key* relay_chain, const crypto::Key* device_key,
                          const crypto::Key* proof) {
  if (!healthy_)
    return "storage-failed";
  Record next{};
  if (mode == static_cast<std::uint32_t>(NetworkMode::Open)) {
    if (generation || epoch || relay_chain || device_key || proof)
      return "invalid";
    next.mode = NetworkMode::Open;
  } else if (mode == static_cast<std::uint32_t>(NetworkMode::Team)) {
    if (!generation || generation > 0xffff || epoch > 0xffff || !relay_chain || !device_key ||
        !proof || all_zero(*relay_chain) || all_zero(*device_key) || all_zero(*proof))
      return "invalid";
    next.mode = NetworkMode::Team;
    next.generation = static_cast<std::uint16_t>(generation);
    next.epoch = next.proven = static_cast<std::uint16_t>(epoch);
    next.relay_chain = *relay_chain;
    next.device_key = *device_key;
    next.proof = *proof;
  } else {
    return "invalid";
  }
  // Retrying a fill whose reply was lost changes nothing and spends no flash.
  const bool same = active_ >= 0 && next.mode == record_.mode &&
                    next.generation == record_.generation && next.epoch == record_.epoch &&
                    next.proven == record_.proven && next.relay_chain == record_.relay_chain &&
                    next.device_key == record_.device_key && next.proof == record_.proof;
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
  if (generation != record_.generation || epoch < record_.epoch ||
      epoch > std::uint32_t(record_.epoch) + mesh::kEpochLookAhead)
    return "mismatch";
  if (all_zero(team_chain))
    return "invalid";
  if (team_loaded_ && epoch >= team_epoch_ && epoch - team_epoch_ <= mesh::kEpochLookAhead) {
    // The same team, later on: traffic carries on. Anything else replaces the key outright.
    crypto::Key walk = team_chain_;
    bool ok = true;
    for (std::uint32_t at = team_epoch_; ok && at < epoch; ++at)
      ok = mesh::ratchet_chain(walk);
    const bool same_team = ok && walk == team_chain;
    crypto::wipe(walk.data(), walk.size());
    if (same_team) {
      team_chain_ = team_chain;
      team_epoch_ = static_cast<std::uint16_t>(epoch);
      return "ok";
    }
  }
  team_chain_ = team_chain;
  team_epoch_ = static_cast<std::uint16_t>(epoch);
  team_loaded_ = true;
  ++revision_;
  return "ok";
}
bool Network::accept_proof(std::uint32_t epoch, const crypto::Key& proof) {
  if (record_.mode != NetworkMode::Team || !healthy_ || epoch <= record_.proven || epoch > 0xffff ||
      epoch - record_.proven > mesh::kEpochLookAhead ||
      !mesh::proof_reaches(proof, epoch - record_.proven, record_.proof))
    return false;
  Record next = record_;
  bool ok = true;
  // Keeps the epoch before this one, for senders that have not heard yet.
  for (std::uint32_t at = next.epoch; ok && at + 1 < epoch; ++at)
    ok = mesh::ratchet_chain(next.relay_chain);
  if (ok) {
    next.epoch = static_cast<std::uint16_t>(epoch - 1);
    next.proven = static_cast<std::uint16_t>(epoch);
    next.proof = proof;
    ok = save(next);
  }
  if (ok) {
    record_ = next;
    if (team_loaded_ && team_epoch_ < epoch) {
      bool ratcheted = true;
      for (std::uint32_t at = team_epoch_; ratcheted && at < epoch; ++at)
        ratcheted = mesh::ratchet_chain(team_chain_);
      team_epoch_ = static_cast<std::uint16_t>(epoch);
      if (!ratcheted) {
        forget_team();  // Fails closed: back to relaying until the agent reloads the key.
        ++revision_;
      }
    }
  }
  crypto::wipe(next.relay_chain.data(), next.relay_chain.size());
  crypto::wipe(next.device_key.data(), next.device_key.size());
  return ok;
}
const char* Network::advance(std::uint32_t epoch, const crypto::Key& proof) {
  if (record_.mode != NetworkMode::Team)
    return "not-team";
  if (epoch > record_.proven) {
    // Only a save failure leaves a matching proof refused, and then storage is what to report.
    if (!accept_proof(epoch, proof))
      return epoch - record_.proven <= mesh::kEpochLookAhead &&
                     mesh::proof_reaches(proof, epoch - record_.proven, record_.proof)
                 ? "storage-failed"
                 : "invalid";
  } else if (epoch < record_.proven) {
    return "mismatch";
  } else if (proof != record_.proof) {
    return "invalid";
  }
  announcement_ = proof;
  announced_epoch_ = static_cast<std::uint16_t>(epoch);
  announce_ = true;
  return "ok";
}
bool Network::hear_proof(std::uint16_t epoch, const crypto::Key& proof, mesh::FrameLink& link,
                         std::uint64_t now) {
  return epoch > record_.proven && epoch - record_.proven <= mesh::kEpochLookAhead &&
         link.spend(epoch - record_.proven, now) && accept_proof(epoch, proof);
}
void Network::sync(mesh::FrameLink& link) {
  if (record_.mode != NetworkMode::Team)
    return;
  if (link.floor() != record_.epoch)
    link.set_floor(record_.relay_chain, record_.epoch);
  if (!team_loaded_ || !link.team_ready())
    return;
  if (team_epoch_ > link.team_epoch()) {
    link.advance_team(team_epoch_);
  } else if (team_epoch_ < link.team_epoch()) {
    team_chain_ = link.team_chain();
    team_epoch_ = link.team_epoch();
  }
}
bool Network::take_announcement(std::uint16_t& epoch, crypto::Key& proof) {
  if (!announce_)
    return false;
  announce_ = false;
  epoch = announced_epoch_;
  proof = announcement_;
  return true;
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
    return link.set_chains(record_.relay_chain, record_.epoch,
                           team_loaded_ ? &team_chain_ : nullptr,
                           team_loaded_ ? team_epoch_ : record_.epoch);
  return false;
}
}  // namespace reaper::device
