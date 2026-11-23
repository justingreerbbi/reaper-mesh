// Host tests for the signals add-on's portable core (components/reaper_sensor). The frames are
// built byte by byte from the 802.11, Bluetooth Core and ASTM F3411 layouts.
#include "reaper/sensor_scan.hpp"
#include <cstring>
#include <iostream>
#include <string>
#include <vector>

namespace s = reaper::sensor;
using Buffer = std::vector<std::uint8_t>;
#define CHECK(v)                                              \
  do {                                                        \
    if (!(v)) {                                               \
      std::cerr << "line " << __LINE__ << ": " << #v << '\n'; \
      return 1;                                               \
    }                                                         \
  } while (false)

namespace {
const s::Address kAp{0x02, 0xa1, 0xb2, 0xc3, 0xd4, 0xe5};
const s::Address kPhone{0xda, 0x00, 0x11, 0x22, 0x33, 0x44};
const s::Address kDrone{0xe0, 0x01, 0x02, 0x03, 0x04, 0x05};
const s::Address kTag{0xc0, 0xff, 0xee, 0x00, 0x00, 0x01};

void append(Buffer& b, std::initializer_list<int> bytes) {
  for (int v : bytes)
    b.push_back(static_cast<std::uint8_t>(v));
}
void append(Buffer& b, const std::string& text) {
  b.insert(b.end(), text.begin(), text.end());
}
void append(Buffer& b, const s::Address& a) {
  b.insert(b.end(), a.begin(), a.end());
}
void le32(Buffer& b, std::int32_t v) {
  const auto u = static_cast<std::uint32_t>(v);
  append(b, {int(u & 255), int((u >> 8) & 255), int((u >> 16) & 255), int(u >> 24)});
}
void le16(Buffer& b, unsigned v) {
  append(b, {int(v & 255), int(v >> 8)});
}

// ASTM F3411 messages, 25 bytes each.
Buffer basic_id(const std::string& id) {
  Buffer m;
  append(m, {0x02, (1 << 4) | 2});  // Basic ID, version 2; serial number, multirotor.
  append(m, id);
  m.resize(25, 0);
  return m;
}
Buffer location(std::int32_t lat, std::int32_t lon, int direction, bool west, int speed) {
  Buffer m;
  append(m, {0x12, (2 << 4) | (west ? 2 : 0), direction, speed, 0});
  le32(m, lat);
  le32(m, lon);
  le16(m, 0);                   // Pressure altitude: unknown.
  le16(m, (1225 + 10000) / 5);  // Geodetic altitude 122.5 m.
  le16(m, (600 + 10000) / 5);   // Height 60 m.
  m.resize(25, 0);
  return m;
}
Buffer system_message(std::int32_t lat, std::int32_t lon) {
  Buffer m;
  append(m, {0x42, 0x01});
  le32(m, lat);
  le32(m, lon);
  m.resize(25, 0);
  return m;
}
Buffer operator_id(const std::string& id) {
  Buffer m;
  append(m, {0x52, 0x00});
  append(m, id);
  m.resize(25, 0);
  return m;
}
Buffer pack(const std::vector<Buffer>& messages) {
  Buffer m;
  append(m, {0xf2, 25, int(messages.size())});
  for (const auto& message : messages)
    m.insert(m.end(), message.begin(), message.end());
  return m;
}

Buffer beacon(const s::Address& bssid, const std::string& ssid, bool hidden, bool privacy,
              const Buffer& rsn, const Buffer& vendor = {}) {
  Buffer f;
  append(f, {0x80, 0x00, 0, 0});
  append(f, s::Address{0xff, 0xff, 0xff, 0xff, 0xff, 0xff});
  append(f, bssid);
  append(f, bssid);
  append(f, {0, 0});
  f.resize(f.size() + 8, 0);  // Timestamp.
  append(f, {0x64, 0x00, privacy ? 0x11 : 0x01, 0x04});
  append(f, {0, int(ssid.size())});
  if (hidden)
    f.resize(f.size() + ssid.size(), 0);
  else
    append(f, ssid);
  if (!rsn.empty()) {
    append(f, {48, int(rsn.size())});
    f.insert(f.end(), rsn.begin(), rsn.end());
  }
  if (!vendor.empty()) {
    append(f, {221, int(vendor.size())});
    f.insert(f.end(), vendor.begin(), vendor.end());
  }
  return f;
}
Buffer rsn(int akm) {
  Buffer r;
  append(r,
         {1, 0, 0x00, 0x0f, 0xac, 4, 1, 0, 0x00, 0x0f, 0xac, 4, 1, 0, 0x00, 0x0f, 0xac, akm, 0, 0});
  return r;
}
Buffer probe_request(const s::Address& source, const std::string& ssid) {
  Buffer f;
  append(f, {0x40, 0x00, 0, 0});
  append(f, s::Address{0xff, 0xff, 0xff, 0xff, 0xff, 0xff});
  append(f, source);
  append(f, s::Address{0xff, 0xff, 0xff, 0xff, 0xff, 0xff});
  append(f, {0, 0});
  append(f, {0, int(ssid.size())});
  append(f, ssid);
  return f;
}
Buffer nan(const s::Address& source, const Buffer& remote_id) {
  Buffer f;
  append(f, {0xd0, 0x00, 0, 0});
  append(f, s::Address{0x51, 0x6f, 0x9a, 0x01, 0x00, 0x00});
  append(f, source);
  append(f, s::Address{0x51, 0x6f, 0x9a, 0x01, 0x00, 0x00});
  append(f, {0, 0});
  append(f, {0x04, 0x09, 0x50, 0x6f, 0x9a, 0x13});
  Buffer attribute;
  append(attribute, {0x88, 0x69, 0x19, 0x9d, 0x92, 0x09, 1, 0, 0x10});
  append(attribute, {int(remote_id.size() + 1), 7});  // Service info: counter, then the pack.
  attribute.insert(attribute.end(), remote_id.begin(), remote_id.end());
  append(f, {0x03});
  le16(f, static_cast<unsigned>(attribute.size()));
  f.insert(f.end(), attribute.begin(), attribute.end());
  return f;
}
Buffer ble_remote_id(const Buffer& message) {
  Buffer a;
  append(a, {0x02, 0x01, 0x06, int(message.size() + 5), 0x16, 0xfa, 0xff, 0x0d, 3});
  a.insert(a.end(), message.begin(), message.end());
  return a;
}

s::Observation wifi(const Buffer& frame, s::Observation::Kind kind, std::uint64_t at,
                    std::int8_t rssi, std::uint8_t channel) {
  s::Observation o;
  o.kind = kind;
  o.at_ms = at;
  o.rssi = rssi;
  o.channel = channel;
  s::valid_channel(channel, o.band);
  s::parse_wifi(frame.data(), frame.size(), o.wifi);
  o.address = o.wifi.address;
  return o;
}
s::Observation ble(const s::Address& address, const Buffer& advert, std::uint64_t at,
                   std::int8_t rssi, s::Phy phy = s::Phy::Le1M) {
  s::Observation o;
  o.kind = s::Observation::Kind::Bluetooth;
  o.at_ms = at;
  o.address = address;
  o.rssi = rssi;
  o.phy = phy;
  o.address_type = 1;
  s::parse_ble(advert.data(), advert.size(), o.ble);
  return o;
}
s::Text64 text(const char* value) {
  s::Text64 out;
  out.assign(reinterpret_cast<const std::uint8_t*>(value), std::strlen(value));
  return out;
}
const s::Text64 kBoot = text("boot-A");

std::string field_text(const reaper::protocol::FieldValue& field) {
  return std::string(reinterpret_cast<const char*>(field.text.data()), field.length);
}
std::int32_t field_signed(const reaper::protocol::FieldValue& field) {
  return static_cast<std::int32_t>(field.number);
}

int test_wifi() {
  s::WifiFrame f;
  auto frame = beacon(kAp, "Field Net", false, true, rsn(2));
  CHECK(s::parse_wifi(frame.data(), frame.size(), f));
  CHECK(f.kind == s::WifiFrame::Kind::Beacon && f.address == kAp && !f.hidden);
  CHECK(f.ssid.length == 9 && std::memcmp(f.ssid.data.data(), "Field Net", 9) == 0);
  CHECK(f.security == s::security::kWpa2 && !f.remote_id.present);
  frame = beacon(kAp, "Field Net", true, true, rsn(8));
  CHECK(s::parse_wifi(frame.data(), frame.size(), f));
  CHECK(f.hidden && f.ssid.length == 0 && f.security == s::security::kWpa3);
  frame = beacon(kAp, "Corp", false, true, rsn(1));
  CHECK(s::parse_wifi(frame.data(), frame.size(), f));
  CHECK(f.security == (s::security::kWpa2 | s::security::kEnterprise));
  frame = beacon(kAp, "Old", false, true, {});
  CHECK(s::parse_wifi(frame.data(), frame.size(), f) && f.security == s::security::kWep);
  frame = beacon(kAp, "Cafe", false, false, {});
  CHECK(s::parse_wifi(frame.data(), frame.size(), f) && f.security == 0);
  frame = probe_request(kPhone, "Home");
  CHECK(s::parse_wifi(frame.data(), frame.size(), f));
  CHECK(f.kind == s::WifiFrame::Kind::ProbeRequest && f.address == kPhone && f.ssid.length == 4);
  frame = probe_request(kPhone, "");
  CHECK(s::parse_wifi(frame.data(), frame.size(), f) && f.ssid.length == 0);
  // A Remote ID beacon: ASTM vendor IE, counter, then a message pack.
  Buffer vendor;
  append(vendor, {0xfa, 0x0b, 0xbc, 0x0d, 9});
  const auto payload =
      pack({basic_id("1581F0TEST"), location(389000000, -770365000, 90, false, 40)});
  vendor.insert(vendor.end(), payload.begin(), payload.end());
  frame = beacon(kDrone, "RID-1581F0TEST", false, false, {}, vendor);
  CHECK(s::parse_wifi(frame.data(), frame.size(), f) && f.remote_id.present);
  CHECK(f.remote_id.data.length == payload.size());
  frame = nan(kDrone, payload);
  CHECK(s::parse_wifi(frame.data(), frame.size(), f));
  CHECK(f.kind == s::WifiFrame::Kind::Nan && f.remote_id.present && f.address == kDrone);
  // Data frames and truncated frames are refused; every truncation is safe.
  Buffer data_frame(40, 0);
  data_frame[0] = 0x08;
  CHECK(!s::parse_wifi(data_frame.data(), data_frame.size(), f));
  frame = beacon(kAp, "Field Net", false, true, rsn(2), vendor);
  for (std::size_t n = 0; n < frame.size(); ++n)
    s::parse_wifi(frame.data(), n, f);
  frame = nan(kDrone, payload);
  for (std::size_t n = 0; n < frame.size(); ++n)
    s::parse_wifi(frame.data(), n, f);
  std::cout << "ok wifi\n";
  return 0;
}

int test_ble() {
  s::BleAdvert a;
  Buffer advert;
  append(advert, {0x02, 0x01, 0x06, 0x07, 0x09});
  append(advert, "Thermo");
  append(advert, {0x03, 0x03, 0x1a, 0x18, 0x04, 0xff, 0x4c, 0x00, 0x12});
  CHECK(s::parse_ble(advert.data(), advert.size(), a));
  CHECK(a.name.length == 6 && a.has_manufacturer && a.manufacturer == 0x004c);
  CHECK(a.services.length == 2 && a.services.data[0] == 0x1a && a.services.data[1] == 0x18);
  CHECK(a.tracker == s::Tracker::AppleFindMy && !a.remote_id.present);
  advert.clear();
  append(advert, {0x03, 0x03, 0xed, 0xfe});
  CHECK(s::parse_ble(advert.data(), advert.size(), a) && a.tracker == s::Tracker::Tile);
  advert.clear();
  append(advert, {0x04, 0x16, 0x5a, 0xfd, 0x01});
  CHECK(s::parse_ble(advert.data(), advert.size(), a) && a.tracker == s::Tracker::Samsung);
  advert = ble_remote_id(basic_id("1581F0TEST"));
  CHECK(s::parse_ble(advert.data(), advert.size(), a) && a.remote_id.present);
  CHECK(a.remote_id.data.length == 25);
  // A length byte that runs past the end refuses the whole advertisement.
  advert.clear();
  append(advert, {0x09, 0x09, 'A'});
  CHECK(!s::parse_ble(advert.data(), advert.size(), a));
  std::cout << "ok ble\n";
  return 0;
}

int test_remote_id() {
  s::Drone d;
  auto m = basic_id("1581F0TEST");
  CHECK(s::apply_remote_id(m.data(), m.size(), d));
  CHECK(d.uas_id.length == 10 && d.id_type == 1 && d.ua_type == 2);
  CHECK(!s::apply_remote_id(m.data(), m.size(), d));  // No change.
  m = location(389000000, -770365000, 90, true, 40);
  CHECK(s::apply_remote_id(m.data(), m.size(), d));
  CHECK(d.has_position && d.latitude == 389000000 && d.longitude == -770365000);
  CHECK(d.has_heading && d.heading_cdeg == 27000);  // 90 plus the east-west bit's 180.
  CHECK(d.has_speed && d.speed_cms == 1000);        // 40 × 0.25 m/s.
  CHECK(d.has_altitude && d.altitude_dm == 1225 && d.has_height && d.height_dm == 600);
  m = location(0, 0, 255, false, 255);
  CHECK(s::apply_remote_id(m.data(), m.size(), d));
  CHECK(!d.has_position && !d.has_heading && !d.has_speed);  // Unknown values.
  const auto p = pack({system_message(388990000, -770370000), operator_id("USA0TEST")});
  CHECK(s::apply_remote_id(p.data(), p.size(), d));
  CHECK(d.has_operator && d.operator_latitude == 388990000 && d.operator_id.length == 8);
  Buffer bad = p;
  bad[2] = 10;  // More than nine messages.
  CHECK(!s::apply_remote_id(bad.data(), bad.size(), d));
  CHECK(!s::apply_remote_id(p.data(), 24, d));
  std::cout << "ok remoteid\n";
  return 0;
}

int test_tracker() {
  s::Scan scan;
  s::Message m;
  CHECK(!scan.next(0, kBoot, m));
  scan.observe(wifi(beacon(kAp, "Field Net", false, true, rsn(2)), s::Observation::Kind::WifiAp,
                    100, -61, 36));
  CHECK(scan.next(100, kBoot, m) && m.type == s::MessageType::WifiAp);
  CHECK(m.fields[s::kWifiApChannel].number == 36 && m.fields[s::kWifiApBand].number == 2);
  CHECK(field_signed(m.fields[s::kWifiApRssi]) == -61 && m.fields[s::kWifiApCount].number == 1);
  CHECK(field_text(m.fields[s::kWifiApSsid]) == "Field Net");
  CHECK(!scan.next(200, kBoot, m));  // Already sent.
  scan.observe(wifi(beacon(kAp, "Field Net", false, true, rsn(2)), s::Observation::Kind::WifiAp,
                    1100, -55, 36));
  CHECK(!scan.next(1100, kBoot, m));  // Changes wait for the update interval.
  CHECK(scan.next(100 + s::Scan::kUpdateMs, kBoot, m));
  CHECK(field_signed(m.fields[s::kWifiApRssiMax]) == -55 && m.fields[s::kWifiApCount].number == 2);
  // A drone goes first, but only once its Basic ID has been heard.
  scan.observe(ble(kTag, Buffer{0x02, 0x01, 0x06}, 6000, -70));
  scan.observe(
      ble(kDrone, ble_remote_id(location(389000000, -770365000, 90, false, 40)), 6000, -58));
  CHECK(scan.next(6000, kBoot, m) && m.type == s::MessageType::BleDevice);
  CHECK(!scan.next(6001, kBoot, m));
  scan.observe(ble(kDrone, ble_remote_id(basic_id("1581F0TEST")), 6100, -57));
  scan.observe(wifi(probe_request(kPhone, "Home"), s::Observation::Kind::WifiProbe, 6100, -72, 1));
  CHECK(scan.next(6100, kBoot, m) && m.type == s::MessageType::RemoteId);
  CHECK(m.fields[s::kRemoteIdLatitude].present &&
        field_text(m.fields[s::kRemoteIdUasId]) == "1581F0TEST");
  CHECK(m.fields[s::kRemoteIdTransport].number == 1);
  CHECK(!scan.next(6100, kBoot, m));  // Probe capture is off by default.
  s::Plan plan;
  plan.probes = true;
  scan.set_plan(plan);
  scan.observe(wifi(probe_request(kPhone, "Home"), s::Observation::Kind::WifiProbe, 6200, -72, 1));
  CHECK(scan.next(6200, kBoot, m) && m.type == s::MessageType::WifiProbe);
  CHECK(field_text(m.fields[s::kWifiProbeSsid]) == "Home");
  // Drones update at most every kDroneUpdateMs.
  scan.observe(
      ble(kDrone, ble_remote_id(location(389000100, -770365000, 90, false, 40)), 6300, -57));
  CHECK(!scan.next(6300, kBoot, m));
  CHECK(scan.next(6100 + s::Scan::kDroneUpdateMs, kBoot, m) && m.type == s::MessageType::RemoteId);
  // A new session gets everything again.
  scan.resend_all();
  unsigned count = 0;
  while (scan.next(7000, kBoot, m))
    ++count;
  CHECK(count == 4);
  // Full tables forget the transmitter heard least recently.
  s::Scan full;
  for (unsigned i = 0; i <= s::Scan::kAps; ++i) {
    auto address = kAp;
    address[4] = static_cast<std::uint8_t>(i >> 8);
    address[5] = static_cast<std::uint8_t>(i);
    full.observe(
        wifi(beacon(address, "N", false, false, {}), s::Observation::Kind::WifiAp, i, -80, 6));
  }
  CHECK(full.counters().evicted == 1 && full.counters().wifi_frames == s::Scan::kAps + 1);
  std::cout << "ok tracker\n";
  return 0;
}

int test_budget() {
  s::Budget budget(1000);
  CHECK(budget.allows(0, 1000));
  budget.spend(1000);
  CHECK(!budget.allows(0, 1));
  CHECK(!budget.allows(1, 2));
  CHECK(budget.allows(500, 500));
  CHECK(!budget.allows(500, 501));
  CHECK(budget.allows(100000, 1000) && !budget.allows(100000, 1001));
  std::cout << "ok budget\n";
  return 0;
}

int test_scheduler() {
  constexpr std::uint32_t all = 63;
  s::Scheduler scheduler;
  s::Plan plan;
  scheduler.set(plan, all);
  unsigned wifi = 0, bluetooth = 0;
  bool previous_bluetooth = false;
  for (std::size_t i = 0; i < scheduler.size(); ++i) {
    const auto slot = scheduler.next();
    const bool is_bluetooth = slot.kind == s::Slot::Kind::Bluetooth;
    CHECK(!(is_bluetooth && previous_bluetooth));
    previous_bluetooth = is_bluetooth;
    is_bluetooth ? ++bluetooth : ++wifi;
    CHECK(slot.duration_ms == (is_bluetooth ? 600u : 150u));
  }
  CHECK(wifi == 36 && bluetooth == 9);
  plan.profile = s::Profile::Wifi;
  scheduler.set(plan, all);
  CHECK(scheduler.size() == 36);
  plan.has_channels = true;
  plan.channels.assign(reinterpret_cast<const std::uint8_t*>("\x01\x06\x0b"), 3);
  scheduler.set(plan, all);
  CHECK(scheduler.size() == 3 && scheduler.next().channel == 1);
  plan = s::Plan{};
  plan.profile = s::Profile::Drones;
  scheduler.set(plan, all);
  CHECK(scheduler.size() == 4);
  auto slot = scheduler.next();
  CHECK(slot.kind == s::Slot::Kind::Wifi && slot.channel == 6 && slot.duration_ms == 300);
  CHECK(scheduler.next().kind == s::Slot::Kind::Bluetooth);
  slot = scheduler.next();
  CHECK(slot.channel == 149 && slot.band == s::Band::Ghz5);
  plan.profile = s::Profile::Bluetooth;
  scheduler.set(plan, all);
  CHECK(scheduler.size() == 1 && scheduler.next().kind == s::Slot::Kind::Bluetooth);
  // Without 5 GHz, only 2.4 GHz channels; without Bluetooth, only Wi-Fi.
  plan = s::Plan{};
  scheduler.set(plan, s::capability::kWifi24);
  CHECK(scheduler.size() == 11);
  std::cout << "ok scheduler\n";
  return 0;
}

struct Capture {
  std::vector<s::Message> messages;
};
bool capture(const std::uint8_t* data, std::size_t size, void* context) {
  auto& c = *static_cast<Capture*>(context);
  s::Message m;
  CHECK(size > 2 && data[0] == 0 && data[size - 1] == 0);  // Delimiters on both sides.
  if (!s::decode_frame(data + 1, size - 2, m))
    return false;
  c.messages.push_back(m);
  return true;
}
s::Identity identity(std::uint32_t capabilities = 63) {
  s::Identity id;
  id.sensor = text("sensor-test");
  id.boot = kBoot;
  id.firmware = text("xiaoc5-reaper-sensor-v0.1.0");
  id.capabilities = capabilities;
  return id;
}
void field(s::Message& m, std::size_t i, std::uint32_t v) {
  m.fields[i].present = true;
  m.fields[i].number = v;
}
void field(s::Message& m, std::size_t i, const char* v) {
  m.fields[i].present = true;
  m.fields[i].length = std::strlen(v);
  std::memcpy(m.fields[i].text.data(), v, m.fields[i].length);
}
Buffer frame(const s::Message& m) {
  Buffer out(s::kMaxEncoded + 1);
  std::size_t length = 0;
  s::encode_frame(m, out.data(), out.size(), length);
  out.resize(length);
  return out;
}
s::Message plan_set(const char* boot, std::uint32_t profile, std::uint32_t probes) {
  s::Message m{};
  m.type = s::MessageType::PlanSet;
  field(m, s::kPlanSetBoot, boot);
  field(m, s::kPlanSetRequest, 7);
  field(m, s::kPlanSetProfile, profile);
  field(m, s::kPlanSetBands, 3);
  field(m, s::kPlanSetDwell, 150);
  field(m, s::kPlanSetBluetooth, 1);
  field(m, s::kPlanSetProbes, probes);
  return m;
}

int test_session() {
  Capture c;
  s::Session session(identity(), capture, &c);
  auto plan = frame(plan_set("boot-A", 1, 0));
  session.feed(plan.data(), plan.size(), 0);
  CHECK(c.messages.empty() && !session.active());  // No plan before a hello.
  s::Message hello{};
  hello.type = s::MessageType::Hello;
  field(hello, s::kHelloLink, "link-A");
  field(hello, s::kHelloMinVersion, 1);
  field(hello, s::kHelloMaxVersion, 1);
  auto bytes = frame(hello);
  bytes.insert(bytes.begin(), 0);  // A leading delimiter, as agents send.
  session.feed(bytes.data(), bytes.size(), 0);
  CHECK(session.active() && session.take_started() && !session.take_started());
  CHECK(c.messages.size() == 1 && c.messages[0].type == s::MessageType::Welcome);
  const auto& w = c.messages[0];
  CHECK(field_text(w.fields[s::kWelcomeLink]) == "link-A");
  CHECK(field_text(w.fields[s::kWelcomeFirmware]) == "xiaoc5-reaper-sensor-v0.1.0");
  CHECK(w.fields[s::kWelcomeCapabilities].number == 63 &&
        w.fields[s::kWelcomeMaxFrame].number == 512);
  session.feed(plan.data(), plan.size(), 0);
  CHECK(c.messages.back().type == s::MessageType::PlanStatus);
  CHECK(field_text(c.messages.back().fields[s::kPlanStatusState]) == "applied");
  CHECK(session.take_plan_changed() && session.plan().profile == s::Profile::Drones);
  plan = frame(plan_set("boot-old", 2, 0));
  session.feed(plan.data(), plan.size(), 0);
  CHECK(field_text(c.messages.back().fields[s::kPlanStatusState]) == "invalid");
  CHECK(c.messages.back().fields[s::kPlanStatusProfile].number == 1);  // The plan in force.
  CHECK(!session.take_plan_changed());
  plan = frame(plan_set("boot-A", 9, 0));
  session.feed(plan.data(), plan.size(), 0);
  CHECK(field_text(c.messages.back().fields[s::kPlanStatusState]) == "unsupported");
  Capture limited;
  s::Session no_probes(identity(63 & ~s::capability::kProbeCapture), capture, &limited);
  bytes = frame(hello);
  no_probes.feed(bytes.data(), bytes.size(), 0);
  plan = frame(plan_set("boot-A", 0, 1));
  no_probes.feed(plan.data(), plan.size(), 0);
  CHECK(field_text(limited.messages.back().fields[s::kPlanStatusState]) == "unsupported");
  session.close();
  CHECK(!session.active());
  std::cout << "ok session\n";
  return 0;
}

// Prints one hex frame a line for the TypeScript test to decode and check.
int print_frames() {
  Capture c;
  s::Session session(identity(), capture, &c);
  s::Scan scan;
  s::Plan plan;
  plan.probes = true;
  scan.set_plan(plan);
  scan.observe(wifi(beacon(kAp, "Field Net", false, true, rsn(2)), s::Observation::Kind::WifiAp,
                    4500, -61, 36));
  auto hidden = kAp;
  hidden[5] = 0xe6;
  scan.observe(wifi(beacon(hidden, "xxxxxxxxx", true, true, rsn(8)), s::Observation::Kind::WifiAp,
                    4600, -80, 6));
  scan.observe(wifi(probe_request(kPhone, "Home"), s::Observation::Kind::WifiProbe, 5000, -72, 1));
  Buffer tag;
  append(tag, {0x02, 0x01, 0x06, 0x05, 0x09, 'T', 'a', 'g', '1', 0x04, 0xff, 0x4c, 0x00, 0x12});
  scan.observe(ble(kTag, tag, 6000, -66));
  scan.observe(ble(kDrone, ble_remote_id(basic_id("1581F0TEST")), 7000, -58));
  scan.observe(
      ble(kDrone, ble_remote_id(location(389000000, -770365000, 90, true, 40)), 7000, -58));
  const auto ops = pack({system_message(388990000, -770370000), operator_id("USA0TEST")});
  scan.observe(wifi(nan(kDrone, ops), s::Observation::Kind::WifiAp, 7000, -60, 149));
  s::Message m;
  std::vector<s::Message> out;
  while (scan.next(7000, kBoot, m))
    out.push_back(m);
  out.push_back(session.status(8000, scan.counters(), s::Band::Ghz5, 149));
  for (const auto& message : out) {
    const auto bytes = frame(message);
    if (bytes.empty())
      return 1;
    for (std::size_t i = 0; i + 1 < bytes.size(); ++i)
      std::cout << "0123456789abcdef"[bytes[i] >> 4] << "0123456789abcdef"[bytes[i] & 15];
    std::cout << '\n';
  }
  return 0;
}
}  // namespace

int main(int argc, char** argv) {
  if (argc != 2)
    return 2;
  const std::string scenario = argv[1];
  if (scenario == "wifi")
    return test_wifi();
  if (scenario == "ble")
    return test_ble();
  if (scenario == "remoteid")
    return test_remote_id();
  if (scenario == "tracker")
    return test_tracker();
  if (scenario == "budget")
    return test_budget();
  if (scenario == "scheduler")
    return test_scheduler();
  if (scenario == "session")
    return test_session();
  if (scenario == "frames")
    return print_frames();
  return 2;
}
