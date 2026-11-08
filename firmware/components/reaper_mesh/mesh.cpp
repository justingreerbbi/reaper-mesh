#include "reaper/mesh.hpp"
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
      !link_.can_originate() || !channels_.contains(channel) || !valid_message_payload(bytes, size))
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
bool Mesh::seen(const std::uint8_t* frame, std::uint64_t now) {
  const auto* nonce = frame + 6;
  Seen* free = nullptr;
  for (auto& s : seen_) {
    if (s.used && now >= s.until)
      s.used = false;
    if (s.used && !std::memcmp(s.nonce.data(), nonce, s.nonce.size()))
      return true;
    if (!s.used)
      free = &s;
  }
  if (!free)
    return true;  // Saturation drops traffic; it never allocates/evicts active marks.
  free->used = true;
  std::memcpy(free->nonce.data(), nonce, free->nonce.size());
  free->until = now + 750;
  return false;
}
bool Mesh::queue_frame(const Frame& frame, std::uint64_t now) {
  std::uint64_t jitter = node_;
  for (unsigned i = 0; i < 8; ++i)
    jitter ^= std::uint64_t(frame.bytes[6 + i]) << (i * 8);
  for (auto& f : forward_)
    if (!f.used) {
      f.used = true;
      f.frame = frame;
      f.due = now + 10 + jitter % 91;
      return true;
    }
  return false;
}
bool Mesh::relay_frame(const std::uint8_t* bytes, std::size_t size, std::uint64_t now) {
  if (seen(bytes, now))
    return true;
  FrameRoute route{};
  if (!relay_ || !parse_route(bytes, size, route) || !route.hops)
    return true;
  Frame frame{};
  std::memcpy(frame.bytes.data(), bytes, size);
  frame.size = size;
  return decrement_hops(frame.bytes.data(), size) && queue_frame(frame, now);
}
bool Mesh::send_proof(std::uint16_t epoch, const crypto::Key& proof, std::uint64_t now) {
  Frame frame{};
  if (!link_.seal_proof(epoch, proof, hops_, frame))
    return false;
  seen(frame.bytes.data(), now);  // Its own echo must not be forwarded back.
  return queue_frame(frame, now);
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
  Frame frame{};
  if (!link_.seal(p, frame))
    return;
  seen(frame.bytes.data(), now);  // An ACK names the original sender, so an echo needs this mark.
  if (queue_frame(frame, now))
    r.next_ack = now + 1000;
}
Received Mesh::receive(const std::uint8_t* bytes, std::size_t size, std::uint64_t now,
                       Packet& control) {
  tick(now);
  if (!node_ || node_ == kBroadcast)
    return Received::Dropped;
  Packet p{};
  const auto result = link_.receive(bytes, size, now, p);
  if (result == FrameResult::Rejected)
    return Received::Dropped;
  if (result == FrameResult::Proof)
    return Received::Proof;
  const auto relayed = [&] {
    return relay_frame(bytes, size, now) ? Received::Handled : Received::Dropped;
  };
  if (result == FrameResult::RelayOnly)
    return relayed();
  if (p.kind != PacketKind::Data && p.kind != PacketKind::Ack) {
    control = p;
    return Received::Control;
  }
  // Channel membership decides delivery, not relaying: channel content is end-to-end encrypted.
  if (!channels_.contains(p.channel)) {
    if (!relay_)
      return Received::Dropped;
    return relayed();
  }
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
        return Received::Handled;
      }
    return Received::Dropped;
  }
  if (p.kind == PacketKind::Data && p.key.origin == node_)
    return Received::Dropped;
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
      return Received::Dropped;
    auto& r = *record;
    if (r.poisoned || r.destination != p.destination || r.channel != p.channel ||
        r.size != p.total || r.count != p.count)
      return Received::Dropped;
    auto* target = r.bytes.data() + p.index * kFragmentBytes;
    if (r.received & (1u << p.index)) {
      if (std::memcmp(target, p.bytes.data(), p.size)) {
        if (!r.complete)
          r.poisoned = true;
        return Received::Dropped;
      }
      if (r.complete)
        ack(r, now);
    } else {
      std::memcpy(target, p.bytes.data(), p.size);
      r.received |= 1u << p.index;
      if (r.received == (1u << r.count) - 1) {
        if (!valid_message_payload(r.bytes.data(), r.size)) {
          r.poisoned = true;
          return Received::Dropped;
        }
        r.complete = true;
        r.deadline = now + 120000;
        ack(r, now);
      }
    }
    if (p.destination == node_)
      return Received::Handled;
  }
  return relayed();
}
bool Mesh::next_tx(std::uint64_t now, Frame& frame) {
  tick(now);
  if (in_flight_)
    return false;
  for (auto& f : forward_)
    if (f.used && now >= f.due) {
      frame = f.frame;
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
    Packet p{};
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
    if (!link_.seal(p, frame)) {
      r.state = SendState::Failed;  // Fails closed: nothing goes out without its keys.
      continue;
    }
    in_flight_ = true;
    flight_index_ = static_cast<int>(index);
    flight_size_ = frame.size;
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
  } else {
    // Leave the air to relays forwarding this fragment; otherwise a relay is still sending it
    // when the next one arrives, and misses it the same way every round.
    r.due = now + fragment_gap_ms(airtime_us(flight_size_), hops_);
  }
}
}  // namespace reaper::mesh
