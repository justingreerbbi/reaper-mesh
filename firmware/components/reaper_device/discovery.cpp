#include "reaper/discovery.hpp"
#include <cstring>
#include <limits>
namespace reaper::device {
namespace {
template<std::size_t N> bool same(const Text<N>& a, const Text<N>& b) { return a.length == b.length && !std::memcmp(a.bytes.data(), b.bytes.data(), a.length); }
std::uint32_t read32(const std::uint8_t* p) { return std::uint32_t(p[0]) | std::uint32_t(p[1]) << 8 | std::uint32_t(p[2]) << 16 | std::uint32_t(p[3]) << 24; }
void write32(std::uint8_t* p, std::uint32_t n) { for (unsigned i = 0; i < 4; ++i) p[i] = n >> (i * 8); }
bool sequence(const Text<64>& owner, const Text<75>& id, std::uint32_t& value) {
  if (!owner.length || id.length <= owner.length + 1 || std::memcmp(owner.bytes.data(), id.bytes.data(), owner.length) || id.bytes[owner.length] != ':' || id.bytes[owner.length + 1] == '0') return false;
  std::uint64_t n = 0;
  for (auto i = owner.length + 1; i < id.length; ++i) { const auto b = id.bytes[i]; if (b < '0' || b > '9') return false; n = n * 10 + b - '0'; if (n > 0xffffffff) return false; }
  value = n; return value != 0;
}
bool control(mesh::PacketKind kind) { return kind == mesh::PacketKind::Beacon || kind == mesh::PacketKind::Discover || kind == mesh::PacketKind::Presence; }
}
std::size_t Discovery::count() const { std::size_t n = 0; for (const auto& p : peers_) if (p.used) ++n; return n; }
const Peer* Discovery::peer(std::size_t cursor) const { for (const auto& p : peers_) if (p.used) { if (!cursor) return &p; --cursor; } return nullptr; }
void Discovery::policy(const Settings* settings, bool may_transmit, std::uint64_t now) {
  const bool allowed = settings && may_transmit && settings->region == Region::Us && settings->radio.mode == RadioMode::Mesh;
  const bool changed = (settings && !same_position(settings_.position, settings->position)) || !settings || !configured_ || allowed != allowed_ || !same(settings_.label, settings->label) ||
    settings_.discovery.beacon != settings->discovery.beacon || settings_.discovery.respond != settings->discovery.respond || settings_.discovery.interval != settings->discovery.interval;
  if (changed) {
    for (auto& p : pending_) { if (p.used) for (auto& r : receipts_) if (r.sequence == p.packet.key.sequence) r.failed = true; p.used = false; }
    if (settings) next_beacon_ = now + std::uint64_t(settings->discovery.interval) * 1000 + (node_ ^ boot_[0]) % (std::uint64_t(settings->discovery.interval) * 100 + 1);
    else next_beacon_ = 0;
  }
  if (settings) { settings_ = *settings; configured_ = true; }
  allowed_ = allowed;
}
bool Discovery::queue(mesh::PacketKind kind, std::uint64_t destination, const mesh::MessageKey* parent, std::uint64_t due, std::uint64_t until) {
  if (!allowed_ || sequence_ == 0xffffffff || settings_.label.length > 64) return false;
  for (auto& pending : pending_) if (!pending.used) {
    mesh::Packet p{}; p.kind = kind; p.key = {node_, boot_, ++sequence_}; p.destination = destination; p.hops = p.count = 1;
    p.bytes[0] = 1; p.bytes[1] = settings_.label.length; std::memcpy(p.bytes.data() + 2, settings_.label.bytes.data(), settings_.label.length);
    p.size = 2 + settings_.label.length;
    if (parent) { std::memcpy(p.bytes.data() + p.size, parent->boot.data(), 16); write32(p.bytes.data() + p.size + 16, parent->sequence); p.size += 20; }
    const auto& position = settings_.position;
    if (kind != mesh::PacketKind::Discover && position.share && position.source == 1 && valid_position(position)) {
      p.bytes[0] = 2; auto* extra = p.bytes.data() + p.size; extra[0] = 1;
      write32(extra + 1, position.latitude); write32(extra + 5, position.longitude); write32(extra + 9, 0); p.size += 13;
    }
    p.total = p.size; pending = {true, p, due, until}; return true;
  }
  return false;
}
DiscoveryResult Discovery::query(const Text<75>& id, std::uint64_t now) const {
  for (const auto& r : receipts_) if (r.id.length && same(r.id, id)) return {r.failed ? "failed" : now >= r.end ? (r.sent ? "complete" : "failed") : "collecting", r.replies, r.sequence};
  return {};
}
DiscoveryResult Discovery::request(const Text<64>& owner, const Text<75>& id, bool start, std::uint64_t now) {
  const auto prior = query(id, now); if (prior.sequence || !start) return prior;
  std::uint32_t seq = 0; if (!sequence(owner, id, seq)) return {"rejected"};
  Owner* mark = nullptr;
  for (auto& item : owners_) if (item.id.length && same(item.id, owner)) { mark = &item; break; }
  if (!mark) for (auto& item : owners_) if (!item.id.length) { item.id = owner; mark = &item; break; }
  if (!mark) return {"owner-capacity"};
  if (seq <= mark->highest) return {};
  mark->highest = seq;
  if (!allowed_) return {"blocked"};
  if (now < cooldown_) return {"cooldown"};
  if (!queue(mesh::PacketKind::Discover, mesh::kBroadcast, nullptr, now, now + 5000)) return {"busy"};
  cooldown_ = now + 30000;
  receipts_[next_receipt_] = {id, sequence_, 0, now + 10000, false, false}; next_receipt_ = (next_receipt_ + 1) % receipts_.size();
  return query(id, now);
}
bool Discovery::observe(const mesh::Packet& packet, std::uint64_t now) {
  if (generation_ == 0xffffffff) return false;
  Peer* slot = nullptr;
  for (auto& p : peers_) if (p.used && p.key.origin == packet.key.origin) { slot = &p; break; }
  if (slot) {
    if (slot->key.boot == packet.key.boot) { if (packet.key.sequence <= slot->key.sequence) return false; }
    else { for (const auto& retired : slot->retired) if (retired == packet.key.boot) return false; slot->retired[slot->next_retired++ % 4] = slot->key.boot; }
  } else {
    for (auto& p : peers_) if (!p.used) { slot = &p; break; }
    if (!slot) { slot = &peers_[0]; for (auto& p : peers_) if (p.seen < slot->seen) slot = &p; }
    *slot = {};
  }
  slot->used = true; slot->key = packet.key; slot->seen = now; slot->position = mesh::position_report(packet); slot->name.assign(packet.bytes.data() + 2, packet.bytes[1]); ++generation_; return true;
}
bool Discovery::receive(const mesh::Packet& packet, std::uint64_t now) {
  if (!control(packet.kind) || !mesh::valid_packet(packet) || packet.key.origin == node_ || (packet.destination != mesh::kBroadcast && packet.destination != node_)) return false;
  if (packet.kind == mesh::PacketKind::Presence) {
    const auto* parent = packet.bytes.data() + 2 + packet.bytes[1];
    Receipt* receipt = nullptr;
    for (auto& r : receipts_) if (r.sequence && r.sent && !r.failed && now < r.end && !std::memcmp(parent, boot_.data(), 16) && read32(parent + 16) == r.sequence) { receipt = &r; break; }
    if (!receipt) return false;
    bool counted = false; for (const auto& peer : peers_) if (peer.used && peer.key.origin == packet.key.origin && peer.replied_to == receipt->sequence) counted = true;
    if (observe(packet, now)) { for (auto& peer : peers_) if (peer.used && peer.key.origin == packet.key.origin) peer.replied_to = receipt->sequence; if (!counted && receipt->replies < peers_.size()) ++receipt->replies; return true; } return false;
  }
  const bool observed = observe(packet, now);
  if (packet.kind != mesh::PacketKind::Discover || !observed || !allowed_ || !settings_.discovery.respond) return observed;
  Mark* free = nullptr;
  for (auto& mark : marks_) {
    if (mark.used && now >= mark.until) mark.used = false;
    if (mark.used && mark.key == packet.key) return observed;
    if (!mark.used) free = &mark;
  }
  if (!free) return observed;
  *free = {true, packet.key, now + 60000};
  if (reply_count_ >= reply_times_.size() && now < reply_times_[next_reply_] + 60000) return observed;
  const auto jitter = 250 + ((node_ ^ packet.key.origin ^ packet.key.sequence ^ boot_[0]) * 2654435761ULL) % 4751;
  if (queue(mesh::PacketKind::Presence, packet.key.origin, &packet.key, now + jitter, now + 9000)) { reply_times_[next_reply_] = now; next_reply_ = (next_reply_ + 1) % reply_times_.size(); if (reply_count_ < reply_times_.size()) ++reply_count_; }
  return observed;
}
bool Discovery::next_tx(std::uint64_t now, mesh::Packet& out) {
  if (!allowed_ || flight_) return false;
  if (settings_.discovery.beacon && next_beacon_ && now >= next_beacon_) {
    queue(mesh::PacketKind::Beacon, mesh::kBroadcast, nullptr, now, now + 5000);
    const auto interval = std::uint64_t(settings_.discovery.interval) * 1000;
    next_beacon_ = now + interval + (node_ ^ sequence_ ^ boot_[0]) % (interval / 10 + 1);
  }
  for (auto& p : pending_) {
    if (p.used && now >= p.until) { for (auto& r : receipts_) if (r.sequence == p.packet.key.sequence) r.failed = true; p.used = false; }
    if (p.used && now >= p.due) { flight_deadline_ = p.until; flight_packet_ = out = p.packet; p.used = false; flight_ = true; return true; }
  }
  return false;
}
void Discovery::complete_tx(bool success, std::uint64_t now) {
  if (!flight_) return;
  for (auto& r : receipts_) if (r.sequence == flight_packet_.key.sequence) { r.sent = success; r.failed = !success; if (success) r.end = now + 10000; }
  flight_ = false;
}
}
