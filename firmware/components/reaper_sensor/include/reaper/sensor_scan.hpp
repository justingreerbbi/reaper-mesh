#pragma once
// The signals add-on's portable core (D60): parsers for what the radio hears, the tables that
// summarize it, the scan scheduler and the sensor protocol session. No ESP-IDF code lives here, so
// host tests cover all of it. The wire contract is docs/reference/sensor-protocol.md.
#include "reaper/sensor_protocol.hpp"
#include <array>
#include <cstddef>
#include <cstdint>

namespace reaper::sensor {
inline constexpr std::uint32_t kProtocolVersion = 1;

// Codes from the sensor protocol reference.
namespace capability {
inline constexpr std::uint32_t kWifi24 = 1, kWifi5 = 2, kBluetooth = 4, kBluetoothLongRange = 8,
                               kRemoteId = 16, kProbeCapture = 32;
}
namespace security {
inline constexpr std::uint32_t kWep = 1, kWpa = 2, kWpa2 = 4, kWpa3 = 8, kEnterprise = 16,
                               kOwe = 32;
}
enum class Band : std::uint8_t { Ghz24 = 1, Ghz5 = 2 };
enum class Profile : std::uint8_t { Balanced = 0, Drones = 1, Wifi = 2, Bluetooth = 3 };
enum class Transport : std::uint8_t {
  BluetoothLegacy = 1,
  BluetoothLongRange = 2,
  WifiBeacon = 3,
  WifiNan = 4
};
enum class Tracker : std::uint8_t {
  None = 0,
  AppleFindMy = 1,
  Tile = 2,
  Samsung = 3,
  GoogleFindHub = 4
};
enum class Phy : std::uint8_t { Le1M = 1, Le2M = 2, Coded = 3 };

using Address = std::array<std::uint8_t, 6>;

template <std::size_t N>
struct Bytes {
  std::array<std::uint8_t, N> data{};
  std::uint8_t length = 0;
  // Copies at most N bytes; returns false if the input was longer.
  bool assign(const std::uint8_t* source, std::size_t size) {
    const auto count = size < N ? size : N;
    for (std::size_t i = 0; i < count; ++i)
      data[i] = source[i];
    length = static_cast<std::uint8_t>(count);
    return size <= N;
  }
  bool operator==(const Bytes& other) const {
    if (length != other.length)
      return false;
    for (std::size_t i = 0; i < length; ++i)
      if (data[i] != other.data[i])
        return false;
    return true;
  }
  bool operator!=(const Bytes& other) const { return !(*this == other); }
};

using Text64 = Bytes<64>;

// The 2.4 GHz and 5 GHz channels this add-on listens on (US channels; listening only).
inline constexpr std::uint8_t kChannels24[] = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11};
inline constexpr std::uint8_t kChannels5[] = {36,  40,  44,  48,  52,  56,  60,  64,  100,
                                              104, 108, 112, 116, 120, 124, 128, 132, 136,
                                              140, 144, 149, 153, 157, 161, 165};
bool valid_channel(std::uint8_t channel, Band& band);

// ---- Parsers --------------------------------------------------------------------------------

// Remote ID found inside a frame: the ASTM F3411 message or message pack after the counter byte.
struct RemoteIdPayload {
  Bytes<240> data;
  bool present = false;
};

struct WifiFrame {
  enum class Kind : std::uint8_t { None, Beacon, ProbeResponse, ProbeRequest, Nan };
  Kind kind = Kind::None;
  Address address{};  // The access point's BSSID, or the source of a probe request or NAN frame.
  Bytes<32> ssid;
  bool hidden = false;
  bool ssid_present = false;
  std::uint32_t security = 0;
  RemoteIdPayload remote_id;
};
// Parses one 802.11 management frame without its FCS. Data frames are never passed in.
bool parse_wifi(const std::uint8_t* frame, std::size_t length, WifiFrame& out);

struct BleAdvert {
  Bytes<32> name;
  bool has_manufacturer = false;
  std::uint16_t manufacturer = 0;
  Bytes<32> services;  // 16-bit service UUIDs, two little-endian bytes each.
  Tracker tracker = Tracker::None;
  RemoteIdPayload remote_id;
};
bool parse_ble(const std::uint8_t* data, std::size_t length, BleAdvert& out);

// A drone's state, built up from separate ASTM F3411 messages.
struct Drone {
  Bytes<20> uas_id;
  std::uint8_t id_type = 0, ua_type = 0;
  bool has_position = false, has_altitude = false, has_height = false, has_speed = false,
       has_heading = false, has_operator = false;
  std::int32_t latitude = 0, longitude = 0, altitude_dm = 0, height_dm = 0;
  std::uint32_t speed_cms = 0, heading_cdeg = 0;
  std::int32_t operator_latitude = 0, operator_longitude = 0;
  Bytes<20> operator_id;
};
// Applies one 25-byte message or a message pack. Returns true if the drone's state changed.
bool apply_remote_id(const std::uint8_t* data, std::size_t length, Drone& drone);

// ---- Observations and tables ----------------------------------------------------------------

struct Observation {
  enum class Kind : std::uint8_t { WifiAp, WifiProbe, Bluetooth };
  Kind kind = Kind::WifiAp;
  std::uint64_t at_ms = 0;
  Address address{};
  std::int8_t rssi = 0;
  std::uint8_t channel = 0;  // Wi-Fi only.
  Band band = Band::Ghz24;
  Phy phy = Phy::Le1M;
  std::uint8_t address_type = 0;
  WifiFrame wifi;  // Wi-Fi only.
  BleAdvert ble;   // Bluetooth only.
};

struct Plan {
  Profile profile = Profile::Balanced;
  std::uint32_t bands = 3;
  std::uint32_t dwell_ms = 150;
  bool bluetooth = true;
  bool probes = false;  // Privacy default: off.
  bool has_channels = false;
  Bytes<64> channels;
};

struct Counters {
  std::uint32_t wifi_frames = 0, ble_reports = 0, remote_id_reports = 0, sent = 0, dropped = 0,
                evicted = 0;
};

struct Entry {
  Address address{};
  bool used = false, fresh = false, dirty = false;
  std::uint64_t first_ms = 0, last_ms = 0, sent_ms = 0;
  std::int8_t rssi = 0, rssi_min = 0, rssi_max = 0;
  std::uint32_t count = 0;
};
struct ApEntry : Entry {
  Bytes<32> ssid;
  bool hidden = false;
  std::uint8_t channel = 0;
  Band band = Band::Ghz24;
  std::uint32_t security = 0;
};
struct ProbeEntry : Entry {
  Bytes<32> ssid;
  bool has_ssid = false;
  std::uint8_t channel = 0;
  Band band = Band::Ghz24;
};
struct BleEntry : Entry {
  std::uint8_t address_type = 0;
  Phy phy = Phy::Le1M;
  Bytes<32> name;
  bool has_manufacturer = false;
  std::uint16_t manufacturer = 0;
  Bytes<32> services;
  Tracker tracker = Tracker::None;
};
struct DroneEntry : Entry {
  Transport transport = Transport::BluetoothLegacy;
  Drone drone;
};

// Bounded tables of transmitters. Each report summarizes one transmitter. Drones go first, then
// transmitters never sent, then changed ones no more often than kUpdateMs each.
class Scan {
 public:
  static constexpr std::size_t kAps = 128, kProbes = 48, kBle = 160, kDrones = 16;
  static constexpr std::uint64_t kUpdateMs = 5000, kDroneUpdateMs = 500;

  void set_plan(const Plan& plan);
  void observe(const Observation& observation);
  // Marks every transmitter as not yet sent, for a new session.
  void resend_all();
  // Fills the next report due at now. Returns false when nothing is due.
  bool next(std::uint64_t now_ms, const Text64& boot, Message& out);
  Counters& counters() { return counters_; }

 private:
  template <class T, std::size_t N>
  T* slot(std::array<T, N>& table, const Address& address, std::uint64_t now_ms);
  bool probes_ = false;
  std::array<ApEntry, kAps> aps_{};
  std::array<ProbeEntry, kProbes> probes_table_{};
  std::array<BleEntry, kBle> ble_{};
  std::array<DroneEntry, kDrones> drones_{};
  Counters counters_{};
  std::size_t cursor_ = 0;
};

// A byte budget for reports: rate bytes a second, with a burst of the same size.
class Budget {
 public:
  explicit Budget(std::uint32_t bytes_per_second)
      : rate_(bytes_per_second), tokens_(bytes_per_second) {}
  bool allows(std::uint64_t now_ms, std::size_t bytes);
  void spend(std::size_t bytes) { tokens_ = bytes > tokens_ ? 0 : tokens_ - bytes; }

 private:
  void refill(std::uint64_t now_ms);
  std::uint32_t rate_;
  std::uint32_t tokens_;
  std::uint64_t last_ms_ = 0;
  bool started_ = false;
};

// ---- Scheduler ------------------------------------------------------------------------------

struct Slot {
  enum class Kind : std::uint8_t { Wifi, Bluetooth };
  Kind kind = Kind::Wifi;
  std::uint8_t channel = 0;
  Band band = Band::Ghz24;
  std::uint32_t duration_ms = 0;
};

// Turns a plan into time slots. Wi-Fi and Bluetooth never share a slot: in Phase 0 a full-time
// Bluetooth scan silenced Wi-Fi listening on the same radio.
class Scheduler {
 public:
  static constexpr std::size_t kMaxSlots = 64;
  void set(const Plan& plan, std::uint32_t capabilities);
  Slot next();
  std::size_t size() const { return count_; }

 private:
  void add(Slot slot);
  std::array<Slot, kMaxSlots> slots_{};
  std::size_t count_ = 0, index_ = 0;
};

// ---- Session --------------------------------------------------------------------------------

struct Identity {
  Text64 sensor;
  Text64 boot;
  Text64 firmware;
  std::uint32_t capabilities = 0;
};

// One USB host session: hello and welcome, scan plans and their status. Writes whole frames.
class Session {
 public:
  using Writer = bool (*)(const std::uint8_t* data, std::size_t size, void* context);
  Session(const Identity& identity, Writer writer, void* context)
      : identity_(identity), writer_(writer), context_(context) {}

  void feed(const std::uint8_t* data, std::size_t size, std::uint64_t now_ms);
  // The link closed or the host went away: no session until the next hello.
  void close() {
    active_ = false;
    decoder_.reset();
  }
  bool active() const { return active_; }
  const Plan& plan() const { return plan_; }
  // True once after a hello or an applied plan, so the caller can reset its scan.
  bool take_started() { return take(started_); }
  bool take_plan_changed() { return take(plan_changed_); }
  // Sends one frame; returns its size in bytes, or zero if it could not be sent.
  std::size_t send(const Message& message);
  Message status(std::uint64_t now_ms, const Counters& counters, Band band,
                 std::uint8_t channel) const;

 private:
  static bool take(bool& flag) {
    const bool value = flag;
    flag = false;
    return value;
  }
  void receive(const Message& message);
  static void on_message(const Message& message, void* context);
  Identity identity_;
  Writer writer_;
  void* context_;
  FrameDecoder decoder_{};
  Plan plan_{};
  bool active_ = false, started_ = false, plan_changed_ = false;
};

// Validates a planSet against the add-on's capabilities: "applied", "invalid" or "unsupported".
const char* check_plan(const Message& plan_set, const Text64& boot, std::uint32_t capabilities,
                       Plan& out);
}  // namespace reaper::sensor
