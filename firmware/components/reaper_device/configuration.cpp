#include "reaper/configuration.hpp"
#include <cstring>
#include <limits>

namespace reaper::device {
namespace {
template <std::size_t N>
bool equal(const Text<N>& a, const Text<N>& b) {
  return a.length <= N && b.length == a.length &&
         std::memcmp(a.bytes.data(), b.bytes.data(), a.length) == 0;
}
bool equal(const RadioSettings& a, const RadioSettings& b) {
  return a.mode == b.mode && a.power == b.power && a.relay == b.relay && a.profile == b.profile &&
         equal(a.channels, b.channels) && a.channel_ids == b.channel_ids;
}
// Which of the eight slots have a name; false for every slot if the text is malformed.
std::array<bool, 8> named_slots(const Text<71>& names) {
  std::array<bool, 8> named{};
  std::size_t slot = 0;
  for (std::size_t i = 0; i < names.length && i < names.bytes.size(); ++i) {
    if (names.bytes[i] == '|') {
      if (++slot >= named.size())
        return {};
    } else
      named[slot] = true;
  }
  return slot == named.size() - 1 ? named : std::array<bool, 8>{};
}
constexpr char kHex[] = "0123456789abcdef";
void format_ids(protocol::FieldValue& field, const std::array<std::uint32_t, 8>& ids) {
  field.present = true;
  field.length = 71;
  for (std::size_t slot = 0; slot < ids.size(); ++slot) {
    for (unsigned digit = 0; digit < 8; ++digit)
      field.text[slot * 9 + digit] = kHex[(ids[slot] >> (28 - 4 * digit)) & 15];
    if (slot + 1 < ids.size())
      field.text[slot * 9 + 8] = '|';
  }
}
bool parse_ids(const protocol::FieldValue& field, std::array<std::uint32_t, 8>& ids) {
  if (!field.present || field.length != 71)
    return false;
  for (std::size_t slot = 0; slot < ids.size(); ++slot) {
    std::uint32_t id = 0;
    for (unsigned digit = 0; digit < 8; ++digit) {
      const auto c = field.text[slot * 9 + digit];
      const int value = c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : -1;
      if (value < 0)
        return false;
      id = (id << 4) | static_cast<std::uint32_t>(value);
    }
    ids[slot] = id;
  }
  return true;
}
bool equal(const Settings& a, const Settings& b) {
  return same_screen(a.screen, b.screen) && same_position(a.position, b.position) &&
         a.region == b.region && equal(a.label, b.label) && equal(a.radio, b.radio) &&
         a.discovery.beacon == b.discovery.beacon && a.discovery.respond == b.discovery.respond &&
         a.discovery.interval == b.discovery.interval;
}
bool identity(const Text<64>& value) {
  if (!value.length || value.length > 64)
    return false;
  for (std::size_t i = 0; i < value.length; ++i) {
    const auto c = value.bytes[i];
    if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' ||
          c == '_'))
      return false;
  }
  return true;
}
void number(protocol::FieldValue& field, std::uint32_t value) {
  field.present = true;
  field.number = value;
}
template <std::size_t N>
void text(protocol::FieldValue& field, const Text<N>& value) {
  field.present = true;
  field.length = value.length;
  if (value.length <= N && value.length <= protocol::kMaxText)
    std::memcpy(field.text.data(), value.bytes.data(), value.length);
}
void literal(protocol::FieldValue& field, const char* value) {
  field.present = true;
  field.length = std::strlen(value);
  std::memcpy(field.text.data(), value, field.length);
}
}  // namespace

std::array<std::uint32_t, 8> legacy_channel_ids(const Text<71>& names) {
  std::array<std::uint32_t, 8> ids{};
  const auto named = named_slots(names);
  for (std::uint32_t slot = 1; slot < ids.size(); ++slot)
    ids[slot] = named[slot] ? slot : 0;
  return ids;
}
bool valid_channel_ids(const RadioSettings& radio) {
  const auto named = named_slots(radio.channels);
  if (!named[0] || radio.channel_ids[0] != 0)
    return false;
  for (std::size_t slot = 1; slot < named.size(); ++slot) {
    const auto id = radio.channel_ids[slot];
    if (named[slot] != (id != 0) || id == mesh::ChannelSet::kNoChannel)
      return false;
    for (std::size_t other = 1; other < slot; ++other)
      if (id && radio.channel_ids[other] == id)
        return false;
  }
  return true;
}
void format_channel_ids(protocol::FieldValue& field, const RadioSettings& radio) {
  format_ids(field, radio.channel_ids);
}

namespace {
bool valid(const Command& command) {
  if (command.settings.label.length > 64 || command.id.length > 75 || !identity(command.boot) ||
      static_cast<unsigned>(command.settings.region) > 2 ||
      !valid_channel_ids(command.settings.radio))
    return false;
  if (static_cast<unsigned>(command.settings.radio.mode) > 2 || command.settings.radio.power > 10 ||
      command.settings.radio.profile != 1 ||
      (command.has_radio && command.settings.radio.mode != RadioMode::Off &&
       command.settings.region != Region::Us))
    return false;
  if (!valid_position(command.settings.position) || !valid_screen(command.settings.screen))
    return false;
  if (command.settings.discovery.interval < 60 || command.settings.discovery.interval > 3600)
    return false;
  protocol::Message message{};
  message.type = protocol::MessageType::Configure;
  literal(message.fields[protocol::kConfigureLink], "local");
  text(message.fields[protocol::kConfigureBoot], command.boot);
  text(message.fields[protocol::kConfigureId], command.id);
  number(message.fields[protocol::kConfigureExpectedRevision], command.expected_revision);
  text(message.fields[protocol::kConfigureLabel], command.settings.label);
  literal(message.fields[protocol::kConfigureRegion],
          command.settings.region == Region::Unset ? "UNSET"
          : command.settings.region == Region::Us  ? "US"
                                                   : "EU");
  if (command.has_radio) {
    literal(message.fields[protocol::kConfigureRadioMode],
            command.settings.radio.mode == RadioMode::Off       ? "off"
            : command.settings.radio.mode == RadioMode::Receive ? "receive"
                                                                : "mesh");
    number(message.fields[protocol::kConfigureTxPower], command.settings.radio.power);
    number(message.fields[protocol::kConfigureRelay], command.settings.radio.relay ? 1 : 0);
    text(message.fields[protocol::kConfigureChannels], command.settings.radio.channels);
    format_ids(message.fields[protocol::kConfigureChannelIds], command.settings.radio.channel_ids);
    literal(message.fields[protocol::kConfigurePreset], "US915_LAB1");
  }
  std::array<std::uint8_t, protocol::kMaxPayload> scratch{};
  std::size_t size = 0;
  return protocol::encode_payload(message, scratch.data(), scratch.size(), size);
}
bool settings_valid(const Settings& settings) {
  Command sample{};
  const std::uint8_t id[] = "validate:1", boot[] = "validation";
  sample.id.assign(id, sizeof(id) - 1);
  sample.boot.assign(boot, sizeof(boot) - 1);
  sample.settings = settings;
  sample.has_radio = true;
  return valid(sample);
}
std::uint32_t read32(const std::uint8_t* p) {
  return std::uint32_t(p[0]) | (std::uint32_t(p[1]) << 8) | (std::uint32_t(p[2]) << 16) |
         (std::uint32_t(p[3]) << 24);
}
void write32(std::uint8_t* p, std::uint32_t value) {
  for (unsigned i = 0; i < 4; ++i)
    p[i] = static_cast<std::uint8_t>(value >> (8 * i));
}
bool parse_id(const Text<75>& id, Text<64>& owner, std::uint32_t& sequence) {
  if (!id.length || id.length > 75)
    return false;
  std::size_t split = 0;
  while (split < id.length && id.bytes[split] != ':')
    ++split;
  if (!owner.assign(id.bytes.data(), split) || !identity(owner) || split + 1 >= id.length ||
      id.length - split - 1 > 10 || id.bytes[split + 1] == '0')
    return false;
  std::uint64_t value = 0;
  for (std::size_t i = split + 1; i < id.length; ++i) {
    if (id.bytes[i] < '0' || id.bytes[i] > '9')
      return false;
    value = value * 10 + id.bytes[i] - '0';
  }
  if (value == 0 || value > std::numeric_limits<std::uint32_t>::max())
    return false;
  sequence = static_cast<std::uint32_t>(value);
  return true;
}
}  // namespace

bool encode_record(const Snapshot& snapshot, std::uint8_t* output, std::size_t capacity,
                   std::size_t& size) {
  size = 0;
  if (!output || !settings_valid(snapshot.settings))
    return false;
  const auto& discovery = snapshot.settings.discovery;
  // Record 6 appends the slot channel IDs; IDs that match the slot numbers need no record 6.
  const bool ids =
      snapshot.settings.radio.channel_ids != legacy_channel_ids(snapshot.settings.radio.channels);
  const bool screen = ids || !same_screen(snapshot.settings.screen, ScreenSettings{});
  const bool position = screen || !same_position(snapshot.settings.position, PositionSettings{});
  const bool presence =
      position || discovery.beacon || discovery.respond || discovery.interval != 300;
  const bool extended = presence || !equal(snapshot.settings.radio, RadioSettings{});
  const auto length = 13 + snapshot.settings.label.length +
                      (extended ? 5 + snapshot.settings.radio.channels.length : 0) +
                      (presence ? 5 : 0) + (position ? 10 : 0) + (screen ? 5 : 0) + (ids ? 32 : 0);
  const std::size_t id_bytes = ids ? 32 : 0, tail = (screen ? 5 : 0) + id_bytes;
  if (capacity < length)
    return false;
  output[0] = 'R';
  output[1] = 'C';
  output[2] = ids ? 6 : screen ? 5 : position ? 4 : presence ? 3 : extended ? 2 : 1;
  write32(output + 3, snapshot.revision);
  output[7] = static_cast<std::uint8_t>(snapshot.settings.region);
  output[8] = static_cast<std::uint8_t>(snapshot.settings.label.length);
  std::memcpy(output + 9, snapshot.settings.label.bytes.data(), snapshot.settings.label.length);
  if (extended) {
    auto* extra = output + 9 + snapshot.settings.label.length;
    const auto& radio = snapshot.settings.radio;
    extra[0] = static_cast<std::uint8_t>(radio.mode);
    extra[1] = radio.power;
    extra[2] = radio.relay;
    extra[3] = radio.channels.length;
    std::memcpy(extra + 4, radio.channels.bytes.data(), radio.channels.length);
    extra[4 + radio.channels.length] = radio.profile;
  }
  if (presence) {
    auto* extra = output + length - 9 - (position ? 10 : 0) - tail;
    extra[0] = (discovery.beacon ? 1 : 0) | (discovery.respond ? 2 : 0);
    write32(extra + 1, discovery.interval);
  }
  if (position) {
    auto* extra = output + length - 14 - tail;
    const auto& p = snapshot.settings.position;
    extra[0] = p.share;
    extra[1] = p.source;
    write32(extra + 2, p.latitude);
    write32(extra + 6, p.longitude);
  }
  if (screen) {
    auto* extra = output + length - 9 - id_bytes;
    write32(extra, snapshot.settings.screen.timeout);
    extra[4] = snapshot.settings.screen.wake;
  }
  if (ids)
    for (std::size_t slot = 0; slot < 8; ++slot)
      write32(output + length - 36 + 4 * slot, snapshot.settings.radio.channel_ids[slot]);
  write32(output + length - 4, protocol::crc32(output, length - 4));
  size = length;
  return true;
}

bool decode_record(const std::uint8_t* data, std::size_t size, Snapshot& output) {
  if (!data || size < 13 || size > kMaxRecord || data[0] != 'R' || data[1] != 'C' ||
      (data[2] < 1 || data[2] > 6) || data[7] > 2 || data[8] > 64 ||
      (data[2] == 1 && size != std::size_t(data[8]) + 13) ||
      read32(data + size - 4) != protocol::crc32(data, size - 4))
    return false;
  Snapshot next{};
  const std::size_t id_bytes = data[2] == 6 ? 32 : 0, tail = (data[2] >= 5 ? 5 : 0) + id_bytes;
  next.revision = read32(data + 3);
  next.settings.region = static_cast<Region>(data[7]);
  next.settings.label.assign(data + 9, data[8]);
  if (data[2] >= 2) {
    const auto offset = 9u + data[8];
    if (size < offset + 9)
      return false;
    const auto* extra = data + offset;
    const auto names = extra[3];
    if (size != offset + 9u + names + (data[2] >= 3 ? 5u : 0u) + (data[2] >= 4 ? 10u : 0u) + tail ||
        extra[0] > 2 || extra[1] > 10 || extra[2] > 1 ||
        !next.settings.radio.channels.assign(extra + 4, names))
      return false;
    next.settings.radio.mode = static_cast<RadioMode>(extra[0]);
    next.settings.radio.power = extra[1];
    next.settings.radio.relay = extra[2] != 0;
    next.settings.radio.profile = extra[4 + names];
  }
  if (data[2] >= 3) {
    const auto* extra = data + size - 9 - (data[2] >= 4 ? 10 : 0) - tail;
    if (extra[0] > 3)
      return false;
    next.settings.discovery = {bool(extra[0] & 1), bool(extra[0] & 2), read32(extra + 1)};
  }
  if (data[2] >= 4) {
    const auto* extra = data + size - 14 - tail;
    if (extra[0] > 1)
      return false;
    next.settings.position = {bool(extra[0]), extra[1], read32(extra + 2), read32(extra + 6)};
  }
  if (data[2] >= 5) {
    const auto* extra = data + size - 9 - id_bytes;
    if (extra[4] > 1)
      return false;
    next.settings.screen = {read32(extra), extra[4] != 0};
  }
  if (id_bytes)
    for (std::size_t slot = 0; slot < 8; ++slot)
      next.settings.radio.channel_ids[slot] = read32(data + size - 36 + 4 * slot);
  else
    next.settings.radio.channel_ids = legacy_channel_ids(next.settings.radio.channels);
  if (!settings_valid(next.settings))
    return false;
  output = next;
  return true;
}

bool decode_command(const protocol::Message& message, Command& output) {
  if (message.type != protocol::MessageType::Configure)
    return false;
  // Revalidate callers that construct a Message directly, not only wire decoders.
  std::array<std::uint8_t, protocol::kMaxPayload> scratch{};
  std::size_t size = 0;
  if (!protocol::encode_payload(message, scratch.data(), scratch.size(), size))
    return false;
  Command next{};
  const auto& id = message.fields[protocol::kConfigureId];
  const auto& boot = message.fields[protocol::kConfigureBoot];
  const auto& label = message.fields[protocol::kConfigureLabel];
  const auto& region = message.fields[protocol::kConfigureRegion];
  if (!next.id.assign(id.text.data(), id.length) ||
      !next.boot.assign(boot.text.data(), boot.length) ||
      !next.settings.label.assign(label.text.data(), label.length))
    return false;
  next.expected_revision = message.fields[protocol::kConfigureExpectedRevision].number;
  next.settings.region = region.length == 5      ? Region::Unset
                         : region.text[0] == 'U' ? Region::Us
                                                 : Region::Eu;
  bool any = false, all = true;
  for (auto index :
       {protocol::kConfigureRadioMode, protocol::kConfigureTxPower, protocol::kConfigureRelay,
        protocol::kConfigureChannels, protocol::kConfigureChannelIds, protocol::kConfigurePreset}) {
    any = any || message.fields[index].present;
    all = all && message.fields[index].present;
  }
  if (any && !all)
    return false;
  if (all) {
    next.has_radio = true;
    const auto& mode = message.fields[protocol::kConfigureRadioMode];
    next.settings.radio.mode = mode.length == 3   ? RadioMode::Off
                               : mode.length == 7 ? RadioMode::Receive
                                                  : RadioMode::Mesh;
    if (message.fields[protocol::kConfigureTxPower].number > 10 ||
        message.fields[protocol::kConfigureRelay].number > 1)
      return false;
    next.settings.radio.power = message.fields[protocol::kConfigureTxPower].number;
    next.settings.radio.relay = message.fields[protocol::kConfigureRelay].number != 0;
    const auto& names = message.fields[protocol::kConfigureChannels];
    const auto& preset = message.fields[protocol::kConfigurePreset];
    if (!next.settings.radio.channels.assign(names.text.data(), names.length) ||
        !parse_ids(message.fields[protocol::kConfigureChannelIds],
                   next.settings.radio.channel_ids) ||
        preset.length != 10 || std::memcmp(preset.text.data(), "US915_LAB1", 10))
      return false;
  }
  const auto& beacon = message.fields[protocol::kConfigureBeacon];
  const auto& respond = message.fields[protocol::kConfigureRespond];
  const auto& interval = message.fields[protocol::kConfigureBeaconInterval];
  if (beacon.present || respond.present || interval.present) {
    if (!beacon.present || !respond.present || !interval.present || beacon.number > 1 ||
        respond.number > 1)
      return false;
    next.has_discovery = true;
    next.settings.discovery = {bool(beacon.number), bool(respond.number), interval.number};
  }
  bool any_position = false, all_position = true;
  for (auto index : {protocol::kConfigureShareLocation, protocol::kConfigurePositionSource,
                     protocol::kConfigureLatitude, protocol::kConfigureLongitude}) {
    any_position = any_position || message.fields[index].present;
    all_position = all_position && message.fields[index].present;
  }
  if (any_position) {
    if (!all_position || message.fields[protocol::kConfigureShareLocation].number > 1 ||
        message.fields[protocol::kConfigurePositionSource].number > 1)
      return false;
    next.has_position = true;
    next.settings.position = {
        bool(message.fields[protocol::kConfigureShareLocation].number),
        static_cast<std::uint8_t>(message.fields[protocol::kConfigurePositionSource].number),
        message.fields[protocol::kConfigureLatitude].number,
        message.fields[protocol::kConfigureLongitude].number};
  }
  const auto& timeout = message.fields[protocol::kConfigureScreenTimeout];
  const auto& wake = message.fields[protocol::kConfigureScreenWake];
  if (timeout.present || wake.present) {
    if (!timeout.present || !wake.present || wake.number > 1)
      return false;
    next.has_screen = true;
    next.settings.screen = {timeout.number, wake.number != 0};
  }
  if (!valid(next))
    return false;
  output = next;
  return true;
}

Configuration::Configuration(Storage& storage, const Text<64>& boot)
    : storage_(storage), boot_(boot) {
  if (!identity(boot))
    return;
  std::array<std::uint8_t, kMaxRecord> record{};
  std::size_t size = 0;
  const auto result = storage_.read(record.data(), record.size(), size);
  if (result == ReadStatus::Missing) {
    healthy_ = true;
    return;
  }
  if (result == ReadStatus::Loaded)
    healthy_ = decode_record(record.data(), size, snapshot_);
}

bool Configuration::snapshot(Snapshot& output) const {
  if (!healthy_)
    return false;
  output = snapshot_;
  return true;
}

bool Configuration::admit(const Text<64>& id) {
  if (!healthy_ || !identity(id))
    return false;
  for (const auto& owner : owners_)
    if (owner.used && equal(owner.id, id))
      return true;
  for (auto& owner : owners_)
    if (!owner.used) {
      owner.used = true;
      owner.id = id;
      return true;
    }
  return false;
}

void Configuration::retain(const Command& command, Result result) {
  receipts_[next_receipt_] = {true, command, result};
  next_receipt_ = (next_receipt_ + 1) % receipts_.size();
}

Result Configuration::apply(const Command& command) {
  if (!valid(command) || !equal(command.boot, boot_))
    return {Outcome::Rejected, snapshot_.revision};
  for (const auto& receipt : receipts_)
    if (receipt.used && equal(receipt.command.id, command.id)) {
      const auto& previous = receipt.command;
      if (previous.expected_revision != command.expected_revision ||
          previous.has_position != command.has_position ||
          previous.has_radio != command.has_radio ||
          previous.has_discovery != command.has_discovery ||
          previous.has_screen != command.has_screen ||
          !equal(previous.settings, command.settings)) {
        return {Outcome::Rejected, snapshot_.revision};
      }
      return receipt.result;
    }
  if (!healthy_)
    return {Outcome::Unknown, snapshot_.revision};
  Text<64> owner_id{};
  std::uint32_t sequence = 0;
  if (!parse_id(command.id, owner_id, sequence) || !admit(owner_id))
    return {Outcome::Rejected, snapshot_.revision};
  Owner* owner = nullptr;
  for (auto& item : owners_)
    if (item.used && equal(item.id, owner_id)) {
      owner = &item;
      break;
    }
  if (!owner || sequence <= owner->highest)
    return {Outcome::Unknown, snapshot_.revision};
  owner->highest = sequence;
  Result result{Outcome::Conflict, snapshot_.revision};
  if (command.expected_revision == snapshot_.revision) {
    if (snapshot_.revision == std::numeric_limits<std::uint32_t>::max())
      result.outcome = Outcome::Rejected;
    else {
      Snapshot next{command.settings, snapshot_.revision + 1};
      if (!command.has_position)
        next.settings.position = snapshot_.settings.position;
      if (!command.has_radio)
        next.settings.radio = snapshot_.settings.radio;
      if (!command.has_discovery)
        next.settings.discovery = snapshot_.settings.discovery;
      if (!command.has_screen)
        next.settings.screen = snapshot_.settings.screen;
      if (next.settings.region != Region::Us)
        next.settings.radio.mode = RadioMode::Off;
      std::array<std::uint8_t, kMaxRecord> record{};
      std::size_t size = 0;
      if (!encode_record(next, record.data(), record.size(), size))
        result.outcome = Outcome::Rejected;
      else {
        const auto stored = storage_.commit(record.data(), size);
        if (stored == CommitStatus::Committed) {
          snapshot_ = next;
          result = {Outcome::Committed, next.revision};
        } else if (stored == CommitStatus::NotCommitted)
          result.outcome = Outcome::Rejected;
        else {
          healthy_ = false;
          result.outcome = Outcome::Unknown;
        }
      }
    }
  }
  retain(command, result);
  return result;
}

Result Configuration::query(const Text<75>& id) const {
  for (const auto& receipt : receipts_)
    if (receipt.used && equal(receipt.command.id, id))
      return receipt.result;
  return {Outcome::Unknown, snapshot_.revision};
}
}  // namespace reaper::device
