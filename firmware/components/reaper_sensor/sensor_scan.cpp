// Tables, output budget, scheduler and session for the signals add-on.
#include "reaper/sensor_scan.hpp"
#include <cstring>

namespace reaper::sensor {
namespace {
using protocol::FieldValue;

void put(Message& m, std::size_t i, std::uint32_t value) {
  m.fields[i].present = true;
  m.fields[i].number = value;
}
void put_signed(Message& m, std::size_t i, std::int32_t value) {
  put(m, i, static_cast<std::uint32_t>(value));
}
void put_bytes(Message& m, std::size_t i, const std::uint8_t* data, std::size_t size) {
  auto& field = m.fields[i];
  field.present = true;
  field.length = size;
  if (size)
    std::memcpy(field.text.data(), data, size);
}
template <std::size_t N>
void put_bytes(Message& m, std::size_t i, const Bytes<N>& bytes) {
  put_bytes(m, i, bytes.data.data(), bytes.length);
}
void put_address(Message& m, std::size_t i, const Address& address) {
  put_bytes(m, i, address.data(), address.size());
}
void put_text(Message& m, std::size_t i, const char* text) {
  put_bytes(m, i, reinterpret_cast<const std::uint8_t*>(text), std::strlen(text));
}
Text64 text(const FieldValue& field) {
  Text64 out;
  out.assign(field.text.data(), field.length);
  return out;
}
std::uint32_t ms32(std::uint64_t ms) {
  return static_cast<std::uint32_t>(ms);
}

void seen(Entry& entry, std::int8_t rssi, std::uint64_t now_ms) {
  if (!entry.count) {
    entry.rssi_min = entry.rssi_max = rssi;
    entry.first_ms = now_ms;
  } else {
    entry.rssi_min = rssi < entry.rssi_min ? rssi : entry.rssi_min;
    entry.rssi_max = rssi > entry.rssi_max ? rssi : entry.rssi_max;
  }
  entry.rssi = rssi;
  entry.last_ms = now_ms;
  ++entry.count;
  entry.dirty = true;
}
void sent(Entry& entry, std::uint64_t now_ms, Counters& counters) {
  entry.fresh = entry.dirty = false;
  entry.sent_ms = now_ms;
  ++counters.sent;
}
void common(Message& m, const Entry& e, std::size_t rssi, std::size_t min, std::size_t max,
            std::size_t count) {
  put_signed(m, rssi, e.rssi);
  put_signed(m, min, e.rssi_min);
  put_signed(m, max, e.rssi_max);
  put(m, count, e.count);
}

void report(const ApEntry& e, const Text64& boot, Message& m) {
  m.type = MessageType::WifiAp;
  put_bytes(m, kWifiApBoot, boot);
  put(m, kWifiApAt, ms32(e.last_ms));
  put_address(m, kWifiApAddress, e.address);
  put_bytes(m, kWifiApSsid, e.ssid);
  put(m, kWifiApHidden, e.hidden ? 1 : 0);
  put(m, kWifiApChannel, e.channel);
  put(m, kWifiApBand, static_cast<std::uint32_t>(e.band));
  put(m, kWifiApSecurity, e.security);
  common(m, e, kWifiApRssi, kWifiApRssiMin, kWifiApRssiMax, kWifiApCount);
}
void report(const ProbeEntry& e, const Text64& boot, Message& m) {
  m.type = MessageType::WifiProbe;
  put_bytes(m, kWifiProbeBoot, boot);
  put(m, kWifiProbeAt, ms32(e.last_ms));
  put_address(m, kWifiProbeAddress, e.address);
  put(m, kWifiProbeChannel, e.channel);
  put(m, kWifiProbeBand, static_cast<std::uint32_t>(e.band));
  put_signed(m, kWifiProbeRssi, e.rssi);
  put(m, kWifiProbeCount, e.count);
  if (e.has_ssid)
    put_bytes(m, kWifiProbeSsid, e.ssid);
}
void report(const BleEntry& e, const Text64& boot, Message& m) {
  m.type = MessageType::BleDevice;
  put_bytes(m, kBleDeviceBoot, boot);
  put(m, kBleDeviceAt, ms32(e.last_ms));
  put_address(m, kBleDeviceAddress, e.address);
  put(m, kBleDeviceAddressType, e.address_type);
  put(m, kBleDevicePhy, static_cast<std::uint32_t>(e.phy));
  common(m, e, kBleDeviceRssi, kBleDeviceRssiMin, kBleDeviceRssiMax, kBleDeviceCount);
  if (e.name.length)
    put_bytes(m, kBleDeviceName, e.name);
  if (e.has_manufacturer)
    put(m, kBleDeviceManufacturer, e.manufacturer);
  if (e.services.length)
    put_bytes(m, kBleDeviceServices, e.services);
  if (e.tracker != Tracker::None)
    put(m, kBleDeviceTracker, static_cast<std::uint32_t>(e.tracker));
}
void report(const DroneEntry& e, const Text64& boot, Message& m) {
  const auto& d = e.drone;
  m.type = MessageType::RemoteId;
  put_bytes(m, kRemoteIdBoot, boot);
  put(m, kRemoteIdAt, ms32(e.last_ms));
  put(m, kRemoteIdTransport, static_cast<std::uint32_t>(e.transport));
  put_bytes(m, kRemoteIdUasId, d.uas_id);
  put(m, kRemoteIdIdType, d.id_type);
  put(m, kRemoteIdUaType, d.ua_type);
  put_signed(m, kRemoteIdRssi, e.rssi);
  put_address(m, kRemoteIdAddress, e.address);
  if (d.has_position) {
    put_signed(m, kRemoteIdLatitude, d.latitude);
    put_signed(m, kRemoteIdLongitude, d.longitude);
  }
  if (d.has_altitude)
    put_signed(m, kRemoteIdAltitude, d.altitude_dm);
  if (d.has_height)
    put_signed(m, kRemoteIdHeight, d.height_dm);
  if (d.has_speed)
    put(m, kRemoteIdSpeed, d.speed_cms);
  if (d.has_heading)
    put(m, kRemoteIdHeading, d.heading_cdeg);
  if (d.has_operator) {
    put_signed(m, kRemoteIdOperatorLatitude, d.operator_latitude);
    put_signed(m, kRemoteIdOperatorLongitude, d.operator_longitude);
  }
  if (d.operator_id.length)
    put_bytes(m, kRemoteIdOperatorId, d.operator_id);
}

template <class T, std::size_t N>
bool fresh_report(std::array<T, N>& table, std::uint64_t now_ms, const Text64& boot, Message& out,
                  Counters& counters) {
  for (auto& entry : table)
    if (entry.used && entry.fresh) {
      report(entry, boot, out);
      sent(entry, now_ms, counters);
      return true;
    }
  return false;
}
}  // namespace

// ---- Scan -----------------------------------------------------------------------------------

template <class T, std::size_t N>
T* Scan::slot(std::array<T, N>& table, const Address& address, std::uint64_t now_ms) {
  T* empty = nullptr;
  T* oldest = nullptr;
  for (auto& entry : table) {
    if (entry.used && entry.address == address)
      return &entry;
    if (!entry.used && !empty)
      empty = &entry;
    if (entry.used && (!oldest || entry.last_ms < oldest->last_ms))
      oldest = &entry;
  }
  T* target = empty;
  if (!target) {
    target = oldest;  // Forget the transmitter heard least recently.
    ++counters_.evicted;
  }
  *target = T{};
  target->used = true;
  target->fresh = true;
  target->address = address;
  target->first_ms = now_ms;
  return target;
}

void Scan::set_plan(const Plan& plan) {
  probes_ = plan.probes;
  if (!probes_)
    probes_table_.fill(ProbeEntry{});
}

void Scan::resend_all() {
  for (auto& e : aps_)
    e.fresh = e.used;
  for (auto& e : probes_table_)
    e.fresh = e.used;
  for (auto& e : ble_)
    e.fresh = e.used;
  for (auto& e : drones_)
    e.fresh = e.used;
}

void Scan::observe(const Observation& o) {
  const RemoteIdPayload* remote_id = nullptr;
  Transport transport = Transport::BluetoothLegacy;
  if (o.kind == Observation::Kind::Bluetooth) {
    ++counters_.ble_reports;
    if (o.ble.remote_id.present) {
      remote_id = &o.ble.remote_id;
      transport = o.phy == Phy::Coded ? Transport::BluetoothLongRange : Transport::BluetoothLegacy;
    } else {
      auto* e = slot(ble_, o.address, o.at_ms);
      e->address_type = o.address_type;
      e->phy = o.phy;
      if (o.ble.name.length)
        e->name = o.ble.name;
      if (o.ble.has_manufacturer) {
        e->has_manufacturer = true;
        e->manufacturer = o.ble.manufacturer;
      }
      if (o.ble.services.length)
        e->services = o.ble.services;
      if (o.ble.tracker != Tracker::None)
        e->tracker = o.ble.tracker;
      seen(*e, o.rssi, o.at_ms);
      return;
    }
  } else {
    ++counters_.wifi_frames;
    if (o.wifi.remote_id.present) {
      remote_id = &o.wifi.remote_id;
      transport = o.wifi.kind == WifiFrame::Kind::Nan ? Transport::WifiNan : Transport::WifiBeacon;
    }
    if (o.kind == Observation::Kind::WifiProbe) {
      if (!probes_)
        return;
      auto* e = slot(probes_table_, o.address, o.at_ms);
      if (o.wifi.ssid.length) {
        e->ssid = o.wifi.ssid;
        e->has_ssid = true;
      }
      e->channel = o.channel;
      e->band = o.band;
      seen(*e, o.rssi, o.at_ms);
      return;
    }
    if (o.wifi.kind == WifiFrame::Kind::Beacon || o.wifi.kind == WifiFrame::Kind::ProbeResponse) {
      auto* e = slot(aps_, o.address, o.at_ms);
      if (o.wifi.ssid.length)
        e->ssid = o.wifi.ssid;
      if (o.wifi.kind == WifiFrame::Kind::Beacon)
        e->hidden = o.wifi.hidden;
      e->channel = o.channel;
      e->band = o.band;
      e->security = o.wifi.security;
      seen(*e, o.rssi, o.at_ms);
    }
  }
  if (!remote_id)
    return;
  ++counters_.remote_id_reports;
  auto* d = slot(drones_, o.address, o.at_ms);
  d->transport = transport;
  apply_remote_id(remote_id->data.data.data(), remote_id->data.length, d->drone);
  seen(*d, o.rssi, o.at_ms);
}

bool Scan::next(std::uint64_t now_ms, const Text64& boot, Message& out) {
  out = Message{};
  // Drones first: a drone without a Basic ID yet has nothing to report.
  for (auto& d : drones_)
    if (d.used && d.drone.uas_id.length &&
        (d.fresh || (d.dirty && now_ms - d.sent_ms >= kDroneUpdateMs))) {
      report(d, boot, out);
      sent(d, now_ms, counters_);
      return true;
    }
  if (fresh_report(aps_, now_ms, boot, out, counters_) ||
      fresh_report(ble_, now_ms, boot, out, counters_) ||
      fresh_report(probes_table_, now_ms, boot, out, counters_))
    return true;
  // Changed transmitters, in turn, at most once every kUpdateMs each.
  constexpr std::size_t total = kAps + kBle + kProbes;
  for (std::size_t i = 0; i < total; ++i) {
    const std::size_t index = (cursor_ + i) % total;
    Entry* e = index < kAps          ? static_cast<Entry*>(&aps_[index])
               : index < kAps + kBle ? static_cast<Entry*>(&ble_[index - kAps])
                                     : static_cast<Entry*>(&probes_table_[index - kAps - kBle]);
    if (!e->used || !e->dirty || now_ms - e->sent_ms < kUpdateMs)
      continue;
    if (index < kAps)
      report(aps_[index], boot, out);
    else if (index < kAps + kBle)
      report(ble_[index - kAps], boot, out);
    else
      report(probes_table_[index - kAps - kBle], boot, out);
    sent(*e, now_ms, counters_);
    cursor_ = index + 1;
    return true;
  }
  return false;
}

// ---- Budget ---------------------------------------------------------------------------------

void Budget::refill(std::uint64_t now_ms) {
  if (!started_) {
    started_ = true;
    last_ms_ = now_ms;
    return;
  }
  if (now_ms <= last_ms_)
    return;
  const std::uint64_t add = (now_ms - last_ms_) * rate_ / 1000;
  if (!add)
    return;  // Keep last_ms_ so short steps still add up.
  tokens_ = add + tokens_ >= rate_ ? rate_ : static_cast<std::uint32_t>(tokens_ + add);
  last_ms_ = now_ms;
}

bool Budget::allows(std::uint64_t now_ms, std::size_t bytes) {
  refill(now_ms);
  return tokens_ >= bytes;
}

// ---- Scheduler ------------------------------------------------------------------------------

void Scheduler::add(Slot slot) {
  if (count_ < slots_.size())
    slots_[count_++] = slot;
}

void Scheduler::set(const Plan& plan, std::uint32_t capabilities) {
  count_ = index_ = 0;
  const bool bluetooth = plan.bluetooth && (capabilities & capability::kBluetooth);
  const bool use24 = (plan.bands & 1) && (capabilities & capability::kWifi24);
  const bool use5 = (plan.bands & 2) && (capabilities & capability::kWifi5);
  // The Wi-Fi channels this plan listens on, in order.
  std::array<std::uint8_t, sizeof(kChannels24) + sizeof(kChannels5)> wifi{};
  std::size_t channels = 0;
  auto allowed = [&](std::uint8_t channel) {
    Band band;
    if (!valid_channel(channel, band) || (band == Band::Ghz24 ? !use24 : !use5))
      return false;
    if (!plan.has_channels)
      return true;
    for (std::size_t i = 0; i < plan.channels.length; ++i)
      if (plan.channels.data[i] == channel)
        return true;
    return false;
  };
  if (plan.profile == Profile::Drones && !plan.has_channels) {
    // Remote ID over Wi-Fi uses channel 6 and, for NAN on 5 GHz, channel 149.
    for (std::uint8_t channel : {std::uint8_t(6), std::uint8_t(149)})
      if (allowed(channel))
        wifi[channels++] = channel;
  } else {
    for (auto c : kChannels24)
      if (allowed(c))
        wifi[channels++] = c;
    for (auto c : kChannels5)
      if (allowed(c))
        wifi[channels++] = c;
  }
  auto wifi_slot = [&](std::uint8_t channel, std::uint32_t ms) {
    Band band;
    valid_channel(channel, band);
    add({Slot::Kind::Wifi, channel, band, ms});
  };
  const std::uint32_t dwell = plan.dwell_ms;
  switch (plan.profile) {
    case Profile::Wifi:
      for (std::size_t i = 0; i < channels; ++i)
        wifi_slot(wifi[i], dwell);
      break;
    case Profile::Bluetooth:
      if (bluetooth)
        add({Slot::Kind::Bluetooth, 0, Band::Ghz24, 1000});
      break;
    case Profile::Drones:
      for (std::size_t i = 0; i < channels; ++i) {
        wifi_slot(wifi[i], dwell * 2);
        if (bluetooth)
          add({Slot::Kind::Bluetooth, 0, Band::Ghz24, dwell * 2});
      }
      if (!channels && bluetooth)
        add({Slot::Kind::Bluetooth, 0, Band::Ghz24, 1000});
      break;
    case Profile::Balanced:
    default:
      // About half the time for Bluetooth: one Bluetooth slot after every four channels.
      for (std::size_t i = 0; i < channels; ++i) {
        wifi_slot(wifi[i], dwell);
        if (bluetooth && (i % 4 == 3 || i + 1 == channels))
          add({Slot::Kind::Bluetooth, 0, Band::Ghz24, dwell * 4});
      }
      if (!channels && bluetooth)
        add({Slot::Kind::Bluetooth, 0, Band::Ghz24, 1000});
      break;
  }
  if (!count_)  // Never leave the radio idle: listen on channel 6.
    wifi_slot(6, dwell);
}

Slot Scheduler::next() {
  const Slot slot = slots_[index_];
  index_ = (index_ + 1) % count_;
  return slot;
}

// ---- Session --------------------------------------------------------------------------------

const char* check_plan(const Message& m, const Text64& boot, std::uint32_t capabilities,
                       Plan& out) {
  if (m.type != MessageType::PlanSet || text(m.fields[kPlanSetBoot]) != boot)
    return "invalid";
  Plan plan;
  const auto profile = m.fields[kPlanSetProfile].number;
  const auto bands = m.fields[kPlanSetBands].number;
  const auto dwell = m.fields[kPlanSetDwell].number;
  const auto bluetooth = m.fields[kPlanSetBluetooth].number;
  const auto probes = m.fields[kPlanSetProbes].number;
  if (!bands || dwell < 20 || dwell > 10000 || bluetooth > 1 || probes > 1)
    return "invalid";
  const auto& channels = m.fields[kPlanSetChannels];
  if (channels.present) {
    if (!channels.length || channels.length > 64)
      return "invalid";
    for (std::size_t i = 0; i < channels.length; ++i) {
      Band band;
      if (!valid_channel(channels.text[i], band) || !(bands & static_cast<std::uint32_t>(band)))
        return "invalid";
    }
    plan.has_channels = true;
    plan.channels.assign(channels.text.data(), channels.length);
  }
  if (profile > 3 || bands > 3 || (probes && !(capabilities & capability::kProbeCapture)) ||
      ((bands & 1) && !(capabilities & capability::kWifi24)) ||
      ((bands & 2) && !(capabilities & capability::kWifi5)) ||
      (bluetooth && !(capabilities & capability::kBluetooth)))
    return "unsupported";
  plan.profile = static_cast<Profile>(profile);
  plan.bands = bands;
  plan.dwell_ms = dwell;
  plan.bluetooth = bluetooth == 1;
  plan.probes = probes == 1;
  out = plan;
  return "applied";
}

void Session::feed(const std::uint8_t* data, std::size_t size, std::uint64_t) {
  decoder_.feed(data, size, on_message, this);
}

void Session::on_message(const Message& message, void* context) {
  static_cast<Session*>(context)->receive(message);
}

std::size_t Session::send(const Message& message) {
  // A leading delimiter as well as the trailing one, so stray text on the link (ROM or watchdog
  // output) can never join the next frame. Decoders ignore empty delimiters.
  std::array<std::uint8_t, kMaxEncoded + 2> frame{};
  std::size_t length = 0;
  if (!encode_frame(message, frame.data() + 1, frame.size() - 1, length) ||
      !writer_(frame.data(), length + 1, context_))
    return 0;
  return length + 1;
}

void Session::receive(const Message& message) {
  if (message.type == MessageType::Hello) {
    // The newest hello takes over. The plan in force stays until the add-on restarts.
    active_ = started_ = true;
    Message welcome{};
    welcome.type = MessageType::Welcome;
    const auto& link = message.fields[kHelloLink];
    put_bytes(welcome, kWelcomeLink, link.text.data(), link.length);
    put_bytes(welcome, kWelcomeSensor, identity_.sensor);
    put_bytes(welcome, kWelcomeBoot, identity_.boot);
    put(welcome, kWelcomeMinVersion, kProtocolVersion);
    put(welcome, kWelcomeMaxVersion, kProtocolVersion);
    put_bytes(welcome, kWelcomeFirmware, identity_.firmware);
    put(welcome, kWelcomeCapabilities, identity_.capabilities);
    put(welcome, kWelcomeMaxFrame, static_cast<std::uint32_t>(kMaxPayload));
    send(welcome);
    return;
  }
  if (message.type != MessageType::PlanSet || !active_)
    return;  // A plan before any hello is ignored.
  Plan plan;
  const char* state = check_plan(message, identity_.boot, identity_.capabilities, plan);
  const bool applied = std::strcmp(state, "applied") == 0;
  if (applied) {
    plan_ = plan;
    plan_changed_ = true;
  }
  Message reply{};
  reply.type = MessageType::PlanStatus;
  put_bytes(reply, kPlanStatusBoot, identity_.boot);
  put(reply, kPlanStatusRequest, message.fields[kPlanSetRequest].number);
  put_text(reply, kPlanStatusState, state);
  put(reply, kPlanStatusProfile, static_cast<std::uint32_t>(plan_.profile));
  put(reply, kPlanStatusBands, plan_.bands);
  put(reply, kPlanStatusDwell, plan_.dwell_ms);
  put(reply, kPlanStatusBluetooth, plan_.bluetooth ? 1 : 0);
  put(reply, kPlanStatusProbes, plan_.probes ? 1 : 0);
  if (plan_.has_channels)
    put_bytes(reply, kPlanStatusChannels, plan_.channels);
  send(reply);
}

Message Session::status(std::uint64_t now_ms, const Counters& c, Band band,
                        std::uint8_t channel) const {
  Message m{};
  m.type = MessageType::Status;
  put_bytes(m, kStatusBoot, identity_.boot);
  put(m, kStatusAt, ms32(now_ms));
  put(m, kStatusProfile, static_cast<std::uint32_t>(plan_.profile));
  put(m, kStatusBand, static_cast<std::uint32_t>(band));
  put(m, kStatusChannel, channel);
  put(m, kStatusWifiFrames, c.wifi_frames);
  put(m, kStatusBleReports, c.ble_reports);
  put(m, kStatusRemoteIdReports, c.remote_id_reports);
  put(m, kStatusSent, c.sent);
  put(m, kStatusDropped, c.dropped);
  put(m, kStatusEvicted, c.evicted);
  return m;
}
}  // namespace reaper::sensor
