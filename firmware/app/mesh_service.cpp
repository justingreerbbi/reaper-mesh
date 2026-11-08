#include "mesh_service.hpp"
#include <cstring>
#include <cstdio>
#include <limits>
namespace d = reaper::device;
namespace m = reaper::mesh;
namespace r = reaper::radio;
namespace {
template <std::size_t N>
void literal(d::Text<N>& text, const char* value) {
  text.assign(reinterpret_cast<const std::uint8_t*>(value), std::strlen(value));
}
bool changed(const d::Settings& a, const d::Settings& b) {
  return a.region != b.region || a.radio.mode != b.radio.mode || a.radio.level != b.radio.level ||
         a.radio.boost != b.radio.boost || a.radio.relay != b.radio.relay ||
         a.radio.channels.bytes != b.radio.channels.bytes ||
         a.radio.channel_ids != b.radio.channel_ids;
}
std::uint64_t destination(const d::Text<64>& text) {
  if (text.length == 9 && !std::memcmp(text.bytes.data(), "broadcast", 9))
    return m::kBroadcast;
  std::size_t start = 0;
  if (text.length == 19 && !std::memcmp(text.bytes.data(), "heltec-", 7))
    start = 7;
  else if (text.length == 21 && !std::memcmp(text.bytes.data(), "node-", 5))
    start = 5;
  else
    return 0;
  std::uint64_t value = 0;
  for (std::size_t i = start; i < text.length; ++i) {
    auto b = text.bytes[i];
    unsigned digit;
    if (b >= '0' && b <= '9')
      digit = b - '0';
    else if (b >= 'a' && b <= 'f')
      digit = b - 'a' + 10;
    else
      return 0;
    value = (value << 4) | digit;
  }
  return value == m::kBroadcast ? 0 : value;
}
m::MessageKey key(const d::Text<64>& id, std::uint64_t node, std::uint32_t boot) {
  m::MessageKey k{};
  k.origin = node;
  k.boot = boot;
  std::size_t split = 0;
  while (split < id.length && id.bytes[split] != '_')
    ++split;
  std::uint64_t number = 0;
  for (std::size_t i = split + 1; i < id.length; ++i) {
    if (id.bytes[i] < '0' || id.bytes[i] > '9')
      return {};
    number = number * 10 + id.bytes[i] - '0';
    if (number > 0xffffffff)
      return {};
  }
  k.sequence = number;
  return k;
}
d::Text<64> message_id(const m::MessageKey& key) {
  char id[64]{};
  // USB keeps its 32-digit form, so agents see the same message ID shape as before.
  std::snprintf(id, sizeof(id), "%032lx_%lu", static_cast<unsigned long>(key.boot),
                static_cast<unsigned long>(key.sequence));
  d::Text<64> value{};
  literal(value, id);
  return value;
}
d::Text<64> origin(std::uint64_t node) {
  char id[64]{};
  if (node <= 0xffffffffffffULL)
    std::snprintf(id, sizeof(id), "heltec-%012llx", static_cast<unsigned long long>(node));
  else
    std::snprintf(id, sizeof(id), "node-%016llx", static_cast<unsigned long long>(node));
  d::Text<64> value{};
  literal(value, id);
  return value;
}
d::Text<64> broadcast_destination() {
  d::Text<64> value{};
  literal(value, "broadcast");
  return value;
}
void increment(std::uint32_t& n) {
  if (n < std::numeric_limits<std::uint32_t>::max())
    ++n;
}
}  // namespace
MeshService::MeshService(d::MessageQueue& messages, d::Inbox& inbox, d::RadioInfo& info,
                         d::Network& network, d::Text<64> device, std::uint32_t boot,
                         const reaper::crypto::Key& seed, std::uint64_t node, bool verified)
    : messages_(messages),
      inbox_(inbox),
      info_(info),
      network_(network),
      device_(device),
      boot_(boot),
      nonce_seed_(seed),
      node_(node),
      antenna_verified_(verified),
      radio_(bus_),
      mesh_(node),
      discovery_(node, boot) {
  literal(info_.state, "off");
  literal(info_.reason, "radio-off");
  info_.tx_boost = Driver::kHasBoost;
}
void MeshService::begin() {
  mesh_.link().seed(nonce_seed_);
  info_.probe = bus_.begin() && radio_.configure(m::TxLevel::Low, false, false, false);
  radio_.stop();
  if (!info_.probe) {
    char reason[64]{};
    std::snprintf(reason, sizeof(reason), "probe-%02x-mode%u-status%u-errors%04x",
                  bus_.last_command(), radio_.chip_mode(), radio_.command_status(),
                  radio_.device_errors());
    literal(info_.state, "fault");
    literal(info_.reason, reason);
  }
}
void MeshService::tick(const d::Snapshot* snapshot, std::uint64_t now, bool attached) {
  // New keys cancel everything queued under the old ones, then the radio restarts below.
  if (applied_network_ != network_.revision()) {
    applied_network_ = network_.revision();
    if (configured_)
      messages_.quiesce();
    mesh_.quiesce();
    network_.apply(mesh_.link());
    configured_ = false;
  }
  // An epoch change is not a new key: messages in flight carry on across it.
  network_.sync(mesh_.link());
  // Relaying needs only the radio. Sending anything of its own also needs the team key.
  const auto may_transmit = [this] { return boot_ && radio_.healthy() && antenna_verified_; };
  const auto may_originate = [&] { return may_transmit() && mesh_.link().can_originate(); };
  discovery_.policy(snapshot ? &snapshot->settings : nullptr,
                    snapshot && attached && may_originate(), now);
  if (!snapshot) {
    radio_.stop();
    mesh_.quiesce();
    if (pending_ || tx_) {
      if (control_)
        discovery_.complete_tx(false, now);
      else
        mesh_.complete_tx(false, now);
    }
    pending_ = tx_ = false;
    literal(info_.state, "blocked");
    literal(info_.reason, "storage-unavailable");
    return;
  }
  info_.revision = snapshot->revision;
  const bool discovery_changed =
      configured_ && (!d::same_position(settings_.position, snapshot->settings.position) ||
                      settings_.label.bytes != snapshot->settings.label.bytes ||
                      settings_.discovery.beacon != snapshot->settings.discovery.beacon ||
                      settings_.discovery.respond != snapshot->settings.discovery.respond ||
                      settings_.discovery.interval != snapshot->settings.discovery.interval);
  if (discovery_changed && control_ && (pending_ || tx_)) {
    radio_.stop();
    discovery_.complete_tx(false, now);
    pending_ = tx_ = false;
    configured_ = false;
  }
  const bool policy_changed = configured_ && changed(settings_, snapshot->settings);
  if (!configured_ || policy_changed) {
    if (policy_changed)
      messages_.quiesce();
    if (pending_ || tx_) {
      if (control_)
        discovery_.complete_tx(false, now);
      else
        mesh_.complete_tx(false, now);
    }
    pending_ = tx_ = false;
    radio_.stop();
    mesh_.quiesce();
    settings_ = snapshot->settings;
    configured_ = true;
    mesh_.policy(
        settings_.radio.relay && settings_.radio.mode == d::RadioMode::Mesh && antenna_verified_,
        d::channel_set(settings_.radio));
    const bool receive =
        settings_.region == d::Region::Us && settings_.radio.mode != d::RadioMode::Off;
    if (receive && info_.probe)
      radio_.configure(settings_.radio.level, settings_.radio.boost, true,
                       settings_.radio.mode == d::RadioMode::Mesh && antenna_verified_);
  }
  if (!info_.probe) {
    literal(info_.state, "fault");
  } else if (settings_.radio.mode == d::RadioMode::Off || settings_.region != d::Region::Us) {
    literal(info_.state, "off");
    literal(info_.reason, "radio-off");
  } else if (!radio_.healthy()) {
    literal(info_.state, "fault");
    literal(info_.reason, "radio-driver-fault");
  } else {
    literal(info_.state, radio_.transmitting() ? "transmitting" : "receiving");
    literal(info_.reason, settings_.radio.mode == d::RadioMode::Receive ? "receive-only"
                          : !antenna_verified_                          ? "antenna-unconfirmed"
                          : !boot_                                      ? "frame-keys-unavailable"
                          : network_.mode() == d::NetworkMode::Unset    ? "network-not-chosen"
                          : !mesh_.link().can_originate()               ? "team-key-needed"
                                                                        : "ready");
  }
  discovery_.policy(&snapshot->settings, attached && may_originate(), now);
  settings_.position = snapshot->settings.position;
  settings_.discovery = snapshot->settings.discovery;
  settings_.label = snapshot->settings.label;
  mesh_.tick(now);
  auto event = radio_.poll(now);
  if (event.tx_done) {
    if (control_)
      discovery_.complete_tx(event.tx_success, now);
    else
      mesh_.complete_tx(event.tx_success, now);
    tx_ = false;
    if (event.tx_success)
      increment(info_.transmitted);
  }
#ifdef REAPER_TEST_RELAYED_ONLY
  // Desk relay test build only (tools/hardware-relay-smoke.ts). A frame that still has all its
  // hops came straight from its sender, so ignoring it leaves only copies a relay forwarded.
  // Boards on one desk all hear each other; this makes the relay the only path.
  if (event.received) {
    m::FrameRoute route{};
    if (m::parse_route(event.bytes.data(), event.size, route) && route.hops == route.limit)
      event.received = false;
  }
#endif
  if (event.received) {
    increment(info_.received);
    m::Packet control{};
    const auto result = mesh_.receive(event.bytes.data(), event.size, now, control);
    if (result == m::Received::Control) {
      discovery_.receive(control, now);
    } else if (result == m::Received::Proof) {
      m::FrameRoute route{};
      // Forwarded only when it was news, so each radio sends each proof at most once.
      if (m::parse_route(event.bytes.data(), event.size, route) &&
          network_.hear_proof(route.epoch, m::frame_proof(event.bytes.data()), mesh_.link(), now))
        mesh_.forward(event.bytes.data(), event.size, now);
    }
    network_.sync(mesh_.link());
  }
  std::uint16_t announced = 0;
  reaper::crypto::Key announced_proof{};
  if (network_.take_announcement(announced, announced_proof))
    mesh_.send_proof(announced, announced_proof, now);
  const auto& incoming = mesh_.incoming();
  for (std::size_t i = 0; i < incoming.size(); ++i) {
    const auto& item = incoming[i];
    if (item.used && item.complete && !(reported_[i] == item.key) &&
        inbox_.append(
            origin(item.key.origin), message_id(item.key),
            item.destination == m::kBroadcast ? broadcast_destination() : origin(item.destination),
            item.channel, item.bytes.data(), item.size))
      reported_[i] = item.key;
  }
  for (const auto& message : messages_.records()) {
    if (!message.used ||
        (message.state != d::MessageState::Queued && message.state != d::MessageState::Transmitted))
      continue;
    const auto target = destination(message.destination);
    if (target == node_) {
      if (inbox_.append(device_, message.message_id, message.destination, message.channel,
                        message.bytes.data(), message.size))
        messages_.local_accept(message.message_id);
      else
        messages_.fail(message.message_id, "inbox-unavailable");
      continue;
    }
    if (!target) {
      messages_.fail(message.message_id, "invalid-destination");
      continue;
    }
    if (!may_originate() || settings_.radio.mode != d::RadioMode::Mesh) {
      char reason[65]{};
      std::memcpy(reason, info_.reason.bytes.data(), info_.reason.length);
      messages_.fail(message.message_id, reason);
      continue;
    }
    const auto identity = key(message.message_id, node_, boot_);
    const m::Outbound* known = nullptr;
    for (const auto& item : mesh_.outgoing())
      if (item.used && item.key == identity) {
        known = &item;
        break;
      }
    if (!known) {
      if (!mesh_.enqueue(identity, target, message.channel, message.bytes.data(), message.size,
                         now))
        messages_.fail(message.message_id, "mesh-capacity");
    } else if (known->state == m::SendState::Failed)
      messages_.fail(message.message_id, "delivery-unconfirmed");
    else if (known->state == m::SendState::Transmitted ||
             known->state == m::SendState::Acknowledged) {
      messages_.transmitted(message.message_id, now);
      if (known->state == m::SendState::Acknowledged)
        messages_.acknowledge(message.message_id, message.destination, now);
    }
  }
  if (may_transmit() && settings_.radio.mode == d::RadioMode::Mesh && !tx_) {
    if (!pending_) {
      control_ = false;
      m::Packet report{};
      if (mesh_.next_tx(now, frame_)) {
        pending_ = true;
        pending_at_ = now;
      } else if (discovery_.next_tx(now, report)) {
        control_ = true;
        if (mesh_.link().seal(report, frame_)) {
          pending_ = true;
          pending_at_ = now;
        } else {
          discovery_.complete_tx(false, now);
        }
      }
    }
    if (pending_) {
      if (control_ ? now >= discovery_.flight_deadline() : now - pending_at_ >= 10000) {
        if (control_)
          discovery_.complete_tx(false, now);
        else
          mesh_.complete_tx(false, now);
        pending_ = false;
      } else {
        const auto result = radio_.transmit(frame_.bytes.data(), frame_.size, now);
        if (result == r::Start::Started) {
          tx_ = true;
          pending_ = false;
        } else if (result == r::Start::Rejected || result == r::Start::Fault) {
          if (control_)
            discovery_.complete_tx(false, now);
          else
            mesh_.complete_tx(false, now);
          pending_ = false;
        }
      }
    }
  }
}
