#include "reaper/mesh.hpp"
#include "reaper/protocol.hpp"
#include <cstring>
namespace reaper::mesh {
namespace {
bool terminal(const Outbound& r) {
  return r.state == SendState::Failed || r.state == SendState::Acknowledged ||
         (r.state == SendState::Transmitted && r.destination == kBroadcast);
}
}  // namespace
void Mesh::tick(std::uint64_t now) {
  for (auto& r : out_)
    if (r.used && !terminal(r) && now >= r.deadline)
      r.state = SendState::Failed;
  for (auto& r : in_)
    if (r.used && now >= r.deadline)
      r.used = false;
  for (auto& s : seen_)
    if (s.used && now >= s.until)
      s.used = false;
}
void Mesh::quiesce() {
  for (auto& r : out_)
    if (r.used && !terminal(r))
      r.state = SendState::Failed;
  for (auto& r : forward_)
    r.used = false;
  // A board adapter must cancel/finish its in-flight RF operation before changing profiles.
}
bool Mesh::enqueue(const MessageKey& key, std::uint64_t destination, std::uint32_t channel,
                   const std::uint8_t* bytes, std::size_t size, std::uint64_t now) {
  tick(now);
  if (!node_ || node_ == kBroadcast || key.origin != node_ || destination == node_ ||
      !channels_.contains(channel) || !valid_message_payload(bytes, size, channel))
    return false;
  Packet p{};
  p.key = key;
  p.destination = destination;
  p.channel = channel;
  p.total = size;
  p.count = (size + kFragmentBytes - 1) / kFragmentBytes;
  p.size = size < kFragmentBytes ? size : kFragmentBytes;
  if (!valid_packet(p))
    return false;
  for (const auto& r : out_)
    if (r.used && r.key == key)
      return r.destination == destination && r.channel == channel && r.size == size &&
             std::memcmp(r.bytes.data(), bytes, size) == 0;
  if (boot_set_ && key.boot != boot_)
    return false;
  if (key.sequence > highest_) {
    const auto delta = key.sequence - highest_;
    submitted_ = delta >= 64 ? 0 : submitted_ << delta;
    highest_ = key.sequence;
    submitted_ |= 1;
  } else {
    const auto delta = highest_ - key.sequence;
    if (delta >= 64 || (submitted_ & (std::uint64_t(1) << delta)))
      return false;
    submitted_ |= std::uint64_t(1) << delta;
  }
  boot_ = key.boot;
  boot_set_ = true;
  for (std::size_t index = 0; index < out_.size(); ++index) {
    auto& r = out_[index];
    if ((!r.used || terminal(r)) && !(in_flight_ && flight_index_ == static_cast<int>(index))) {
      r = {};
      r.used = true;
      r.key = key;
      r.destination = destination;
      r.channel = channel;
      r.size = size;
      std::memcpy(r.bytes.data(), bytes, size);
      r.due = now;
      r.deadline = now + 60000;
      return true;
    }
  }
  // The bounded local sequence window prevents reexecution after record reclamation.
  return false;
}
bool Mesh::seen(const Packet& p, std::uint64_t now) {
  Seen* free = nullptr;
  for (auto& s : seen_) {
    if (s.used && now >= s.until)
      s.used = false;
    if (s.used && s.key == p.key && s.kind == p.kind && s.index == p.index)
      return true;
    if (!s.used)
      free = &s;
  }
  if (!free)
    return true;  // Saturation drops traffic; it never allocates/evicts active marks.
  *free = {true, p.key, p.kind, p.index, now + 750};
  return false;
}
bool Mesh::forward(const Packet& p, std::uint64_t now, bool ack_packet) {
  for (const auto& f : forward_)
    if (f.used && f.packet.key == p.key && f.packet.kind == p.kind && f.packet.index == p.index)
      return true;
  for (auto& f : forward_)
    if (!f.used) {
      f.used = true;
      f.packet = p;
      if (!ack_packet)
        --f.packet.hops;
      const auto jitter =
          (p.key.origin ^ p.key.sequence ^ node_ ^ (std::uint64_t(p.index) << 12)) % 91;
      f.due = now + 10 + jitter;
      return true;
    }
  return false;
}
void Mesh::ack(Inbound& r, std::uint64_t now) {
  if (!r.complete || r.destination == kBroadcast || now < r.next_ack)
    return;
  Packet p{};
  p.kind = PacketKind::Ack;
  p.channel = r.channel;
  p.key = r.key;
  p.destination = r.destination;
  p.hops = hops_;
  if (forward(p, now, true))
    r.next_ack = now + 1000;
}
bool Mesh::receive(const std::uint8_t* bytes, std::size_t size, std::uint64_t now) {
  tick(now);
  Packet p{};
  if (!node_ || node_ == kBroadcast || !decode_packet(bytes, size, p) ||
      !channels_.contains(p.channel))
    return false;
  if (p.kind != PacketKind::Data && p.kind != PacketKind::Ack)
    return false;
  if (p.kind == PacketKind::Ack && p.key.origin == node_) {
    for (auto& r : out_)
      if (r.used && r.key == p.key && r.destination == p.destination && r.channel == p.channel &&
          !terminal(r)) {
        // Exact timeout takes precedence. ACK arriving just before final TX completion
        // is retained, but publication waits for the adapter's full transmit result.
        if (r.state == SendState::Transmitted)
          r.state = SendState::Acknowledged;
        else if (in_flight_ && flight_index_ >= 0 && &out_[flight_index_] == &r)
          r.early_ack = true;
        return true;
      }
    return false;
  }
  if (p.kind == PacketKind::Data && p.key.origin == node_)
    return false;
  if (p.kind == PacketKind::Data && (p.destination == node_ || p.destination == kBroadcast)) {
    Inbound* record = nullptr;
    for (auto& r : in_)
      if (r.used && r.key == p.key) {
        record = &r;
        break;
      }
    if (!record)
      for (auto& r : in_)
        if (!r.used) {
          r = {};
          r.used = true;
          r.key = p.key;
          r.destination = p.destination;
          r.channel = p.channel;
          r.size = p.total;
          r.count = p.count;
          r.deadline = now + 20000;
          record = &r;
          break;
        }
    if (!record)
      return false;
    auto& r = *record;
    if (r.poisoned || r.destination != p.destination || r.channel != p.channel ||
        r.size != p.total || r.count != p.count)
      return false;
    auto* target = r.bytes.data() + p.index * kFragmentBytes;
    if (r.received & (1u << p.index)) {
      if (std::memcmp(target, p.bytes.data(), p.size)) {
        if (!r.complete)
          r.poisoned = true;
        return false;
      }
      if (r.complete)
        ack(r, now);
    } else {
      std::memcpy(target, p.bytes.data(), p.size);
      r.received |= 1u << p.index;
      if (r.received == (1u << r.count) - 1) {
        if (!valid_message_payload(r.bytes.data(), r.size, r.channel)) {
          r.poisoned = true;
          return false;
        }
        r.complete = true;
        r.deadline = now + 120000;
        ack(r, now);
      }
    }
    if (p.destination == node_)
      return true;
  }
  if (seen(p, now))
    return true;
  if (relay_ && p.hops)
    return forward(p, now);
  return true;
}
bool Mesh::next_tx(std::uint64_t now, Packet& p) {
  tick(now);
  if (in_flight_)
    return false;
  for (auto& f : forward_)
    if (f.used && now >= f.due) {
      p = f.packet;
      f.used = false;
      in_flight_ = true;
      flight_index_ = -1;
      return true;
    }
  for (std::size_t i = 0; i < out_.size(); ++i) {
    auto index = (next_out_ + i) % out_.size();
    auto& r = out_[index];
    if (!r.used || terminal(r) || r.rounds >= 3 || now < r.due)
      continue;
    p = {};
    p.key = r.key;
    p.destination = r.destination;
    p.channel = r.channel;
    p.total = r.size;
    p.count = (r.size + kFragmentBytes - 1) / kFragmentBytes;
    p.index = r.part;
    p.hops = hops_;
    const auto offset = r.part * kFragmentBytes;
    p.size = r.size - offset < kFragmentBytes ? r.size - offset : kFragmentBytes;
    std::memcpy(p.bytes.data(), r.bytes.data() + offset, p.size);
    in_flight_ = true;
    flight_index_ = static_cast<int>(index);
    next_out_ = (index + 1) % out_.size();
    return true;
  }
  return false;
}
void Mesh::complete_tx(bool success, std::uint64_t now) {
  tick(now);
  if (!in_flight_)
    return;
  const auto index = flight_index_;
  in_flight_ = false;
  flight_index_ = -1;
  if (index < 0)
    return;
  auto& r = out_[index];
  if (terminal(r))
    return;
  if (r.early_ack) {
    r.state = SendState::Acknowledged;
    return;
  }
  if (!success) {
    if (++r.failures >= 3)
      r.state = SendState::Failed;
    else
      r.due = now + 200;
    return;
  }
  if (++r.part == (r.size + kFragmentBytes - 1) / kFragmentBytes) {
    r.part = 0;
    ++r.rounds;
    r.state = r.early_ack ? SendState::Acknowledged : SendState::Transmitted;
    r.due = now + 4000;
  }
}
}  // namespace reaper::mesh
