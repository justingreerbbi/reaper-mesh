#pragma once
#include "reaper/protocol.hpp"
#include "reaper/radio_packet.hpp"
#include "reaper/regional.hpp"

namespace reaper::device {
template <std::size_t N>
struct Text {
  std::array<std::uint8_t, N> bytes{};
  std::size_t length = 0;
  bool assign(const std::uint8_t* data, std::size_t size) {
    if (size > N || (!data && size))
      return false;
    bytes.fill(0);
    for (std::size_t i = 0; i < size; ++i)
      bytes[i] = data[i];
    length = size;
    return true;
  }
};
enum class Region : std::uint8_t { Unset = 0, Us = 1, Eu = 2 };
enum class RadioMode : std::uint8_t { Off, Receive, Mesh };
struct RadioSettings {
  RadioMode mode = RadioMode::Off;
  mesh::TxLevel level = mesh::TxLevel::Medium;
  bool boost = false;  // Boards without a boost mode refuse it (Session).
  bool relay = false;
  std::uint8_t profile = 1;
  Text<71> channels{};
  // On-air channel ID per slot (D45): Public is 0, a named slot has a unique ID, an empty slot 0.
  std::array<std::uint32_t, 8> channel_ids{};
  RadioSettings() {
    const std::uint8_t names[] = "Public|||||||";
    channels.assign(names, sizeof(names) - 1);
  }
};
// Slot k of settings stored before channel IDs keeps talking on ID k, so upgraded boards still
// share their existing channels.
std::array<std::uint32_t, 8> legacy_channel_ids(const Text<71>& names);
bool valid_channel_ids(const RadioSettings&);
inline mesh::ChannelSet channel_set(const RadioSettings& radio) {
  mesh::ChannelSet set{};
  for (std::size_t slot = 1; slot < radio.channel_ids.size(); ++slot)
    if (radio.channel_ids[slot])
      set.add(radio.channel_ids[slot]);
  return set;
}
// Writes the slot IDs as the protocol's channelIds text: eight 8-digit hex IDs joined by '|'.
void format_channel_ids(protocol::FieldValue&, const RadioSettings&);
struct DiscoverySettings {
  bool beacon = false, respond = false;
  std::uint32_t interval = 300;
};
// Coordinates use degrees * 1e7, offset by +90/+180 degrees for unsigned wire/storage.
struct PositionSettings {
  bool share = false;
  std::uint8_t source = 0;
  std::uint32_t latitude = 900000000, longitude = 1800000000;
};
inline bool valid_position(const PositionSettings& p) {
  return p.source <= 1 && p.latitude <= 1800000000 && p.longitude <= 3600000000U;
}
inline bool same_position(const PositionSettings& a, const PositionSettings& b) {
  return a.share == b.share && a.source == b.source && a.latitude == b.latitude &&
         a.longitude == b.longitude;
}
// Board-local screen policy (D44). A timeout of 0 keeps the screen on.
struct ScreenSettings {
  std::uint32_t timeout = 30;
  bool wake = false;
};
inline bool valid_screen(const ScreenSettings& s) {
  return s.timeout == 0 || (s.timeout >= 10 && s.timeout <= 3600);
}
inline bool same_screen(const ScreenSettings& a, const ScreenSettings& b) {
  return a.timeout == b.timeout && a.wake == b.wake;
}
struct Settings {
  ScreenSettings screen{};
  PositionSettings position{};
  DiscoverySettings discovery{};
  RadioSettings radio{};
  Region region = Region::Unset;
  Text<64> label{};
};
struct Snapshot {
  Settings settings{};
  std::uint32_t revision = 0;
};
struct Command {
  Text<75> id{};
  Text<64> boot{};
  std::uint32_t expected_revision = 0;
  Settings settings{};
  bool has_radio = false, has_discovery = false, has_position = false, has_screen = false;
};
enum class Outcome { Committed, Conflict, Rejected, Unknown };
struct Result {
  Outcome outcome = Outcome::Unknown;
  std::uint32_t revision = 0;
};
enum class ReadStatus { Missing, Loaded, Failed };
enum class CommitStatus { Committed, NotCommitted, Indeterminate };
inline constexpr std::size_t kMaxRecord = 203;

// Implementations must retain the prior complete record or the next complete record.
// Committed means durably accepted; NotCommitted guarantees no change. Any ambiguous
// error MUST return Indeterminate. No auto-erase/reformat on load errors is allowed.
struct Storage {
  virtual ~Storage() = default;
  virtual ReadStatus read(std::uint8_t* output, std::size_t capacity,
                          std::size_t& size) noexcept = 0;
  virtual CommitStatus commit(const std::uint8_t* record, std::size_t size) noexcept = 0;
};

bool encode_record(const Snapshot&, std::uint8_t*, std::size_t capacity, std::size_t& size);
bool decode_record(const std::uint8_t*, std::size_t size, Snapshot&);
bool decode_command(const protocol::Message&, Command&);

// Serialized, single-threaded authority. Board integration must own the execution
// context and allocate a new collision-resistant boot identity on each actual boot.
class Configuration {
 public:
  static constexpr std::size_t kReceiptCapacity = 32;
  static constexpr std::size_t kOwnerCapacity = 8;
  Configuration(Storage&, const Text<64>& boot);
  bool healthy() const { return healthy_; }
  bool snapshot(Snapshot& output) const;
  bool admit(const Text<64>& owner);
  Result apply(const Command& command);
  Result query(const Text<75>& id) const;

 private:
  struct Owner {
    bool used = false;
    Text<64> id{};
    std::uint32_t highest = 0;
  };
  struct Receipt {
    bool used = false;
    Command command{};
    Result result{};
  };
  Storage& storage_;
  Text<64> boot_{};
  Snapshot snapshot_{};
  bool healthy_ = false;
  std::array<Owner, kOwnerCapacity> owners_{};
  std::array<Receipt, kReceiptCapacity> receipts_{};
  std::size_t next_receipt_ = 0;
  void retain(const Command&, Result);
};
}  // namespace reaper::device
