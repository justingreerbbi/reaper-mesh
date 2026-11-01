#include "reaper/session.hpp"
#include <cstring>

namespace reaper::device {
namespace p = protocol;
namespace {
template <std::size_t N> void set(p::FieldValue& field, const Text<N>& text) {
  field.present = true; field.length = text.length;
  if (text.length <= N && text.length <= p::kMaxText) std::memcpy(field.text.data(), text.bytes.data(), text.length);
}
void literal(p::FieldValue& field, const char* value) {
  field.present = true; field.length = std::strlen(value); std::memcpy(field.text.data(), value, field.length);
}
void number(p::FieldValue& field, std::uint32_t value) { field.present = true; field.number = value; }
template <std::size_t N> bool same(const p::FieldValue& field, const Text<N>& text) {
  return field.present && field.length == text.length && std::memcmp(field.text.data(), text.bytes.data(), text.length) == 0;
}
const char* outcome(Outcome value) {
  switch (value) {
    case Outcome::Committed: return "committed";
    case Outcome::Conflict: return "conflict";
    case Outcome::Rejected: return "rejected";
    default: return "unknown";
  }
}
} // namespace
Session::Session(Configuration& authority, Text<64> device, Text<64> boot)
    : authority_(authority), device_(device), boot_(boot) {}
void Session::reset() { active_ = compatible_ = admitted_ = synchronized_ = fault_ = false; link_ = {}; owner_ = {}; }
void Session::error(p::Message& reply) const {
  reply = {}; reply.type = p::MessageType::Error;
  set(reply.fields[p::kErrorLink], link_); set(reply.fields[p::kErrorBoot], boot_);
  literal(reply.fields[p::kErrorCode], "storage-unavailable");
}
bool Session::take_error(p::Message& reply) {
  if (!fault_) return false;
  error(reply); reset(); return true;
}
bool Session::handle(const p::Message& request, p::Message& reply) {
  // Public callers may construct messages directly; validate before indexing/copying.
  std::array<std::uint8_t, p::kMaxPayload> scratch{}; std::size_t size = 0;
  if (!p::encode_payload(request, scratch.data(), scratch.size(), size)) return false;
  reply = {};
  if (request.type == p::MessageType::Hello) {
    reset();
    const auto& link = request.fields[p::kHelloLink]; link_.assign(link.text.data(), link.length);
    if (!authority_.healthy()) { error(reply); return true; }
    compatible_ = request.fields[p::kHelloMinVersion].number <= 1 && request.fields[p::kHelloMaxVersion].number >= 1;
    const auto& owner = request.fields[p::kHelloOwner];
    if (owner.present && compatible_) { owner_.assign(owner.text.data(), owner.length); admitted_ = authority_.admit(owner_); }
    active_ = true;
    reply.type = p::MessageType::Welcome;
    set(reply.fields[p::kWelcomeLink], link_); set(reply.fields[p::kWelcomeDevice], device_); set(reply.fields[p::kWelcomeBoot], boot_);
    number(reply.fields[p::kWelcomeMinVersion], 1); number(reply.fields[p::kWelcomeMaxVersion], 1);
    number(reply.fields[p::kWelcomeConfigSchema], 1); number(reply.fields[p::kWelcomeFeatures], 7);
    number(reply.fields[p::kWelcomeMaxPayload], p::kMaxPayload);
    number(reply.fields[p::kWelcomeReceiptCapacity], Configuration::kReceiptCapacity);
    number(reply.fields[p::kWelcomeOwnerCapacity], Configuration::kOwnerCapacity);
    number(reply.fields[p::kWelcomeOwnerAdmitted], admitted_ ? 1 : 0);
    number(reply.fields[p::kWelcomeRegions], 3); number(reply.fields[p::kWelcomeMaxLabelBytes], 64);
    literal(reply.fields[p::kWelcomeFirmware], "usb-prototype-1"); number(reply.fields[p::kWelcomeRadioVersion], 0);
    return true;
  }
  if (!active_ || !compatible_ || !same(request.fields[0], link_)) return false;
  if (request.type == p::MessageType::Ping) {
    reply.type = p::MessageType::Pong; set(reply.fields[p::kPongLink], link_); set(reply.fields[p::kPongBoot], boot_);
    number(reply.fields[p::kPongRequest], request.fields[p::kPingRequest].number); return true;
  }
  if (request.type != p::MessageType::Sync && request.type != p::MessageType::Configure && request.type != p::MessageType::Query) return false;
  if (!same(request.fields[1], boot_)) return false;
  Snapshot snapshot{};
  if (!authority_.snapshot(snapshot)) { error(reply); reset(); return true; }
  if (request.type == p::MessageType::Sync) {
    reply.type = p::MessageType::Snapshot;
    set(reply.fields[p::kSnapshotLink], link_); set(reply.fields[p::kSnapshotBoot], boot_);
    number(reply.fields[p::kSnapshotRequest], request.fields[p::kSyncRequest].number);
    number(reply.fields[p::kSnapshotSequence], snapshot.revision); number(reply.fields[p::kSnapshotRevision], snapshot.revision);
    literal(reply.fields[p::kSnapshotRegion], snapshot.settings.region == Region::Unset ? "UNSET" : snapshot.settings.region == Region::Us ? "US" : "EU");
    set(reply.fields[p::kSnapshotLabel], snapshot.settings.label); synchronized_ = true; return true;
  }
  Text<75> id{}; const auto& id_field = request.fields[2]; id.assign(id_field.text.data(), id_field.length);
  Result result{Outcome::Rejected, snapshot.revision};
  if (request.type == p::MessageType::Query) result = authority_.query(id);
  else {
    Command command{};
    const bool owns = owner_.length && id.length > owner_.length && id.bytes[owner_.length] == ':' &&
      std::memcmp(id.bytes.data(), owner_.bytes.data(), owner_.length) == 0;
    if (synchronized_ && admitted_ && owns && decode_command(request, command) && command.settings.region != Region::Eu) {
      result = authority_.apply(command);
    }
  }
  reply.type = p::MessageType::Result; set(reply.fields[p::kResultLink], link_); set(reply.fields[p::kResultBoot], boot_);
  set(reply.fields[p::kResultId], id); literal(reply.fields[p::kResultOutcome], outcome(result.outcome));
  number(reply.fields[p::kResultRevision], result.revision);
  if (!authority_.healthy()) fault_ = true;
  return true;
}
} // namespace reaper::device
