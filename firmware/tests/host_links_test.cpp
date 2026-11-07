#include "reaper/host_links.hpp"
#include "reaper/pairing.hpp"
#include <cstring>
#include <iostream>
#include <string>
#include <vector>

namespace p = reaper::protocol;
namespace d = reaper::device;
#define CHECK(value)                                              \
  do {                                                            \
    if (!(value)) {                                               \
      std::cerr << "line " << __LINE__ << ": " << #value << '\n'; \
      return 1;                                                   \
    }                                                             \
  } while (false)
namespace {
struct Store : d::Storage {
  std::array<std::uint8_t, d::kMaxRecord> bytes{};
  std::size_t length = 0;
  d::ReadStatus read(std::uint8_t* output, std::size_t capacity,
                     std::size_t& size) noexcept override {
    size = length;
    if (!length)
      return d::ReadStatus::Missing;
    if (length > capacity)
      return d::ReadStatus::Failed;
    std::memcpy(output, bytes.data(), length);
    return d::ReadStatus::Loaded;
  }
  d::CommitStatus commit(const std::uint8_t* input, std::size_t size) noexcept override {
    std::memcpy(bytes.data(), input, size);
    length = size;
    return d::CommitStatus::Committed;
  }
};
template <std::size_t N>
d::Text<N> text(const char* value) {
  d::Text<N> result{};
  result.assign(reinterpret_cast<const std::uint8_t*>(value), std::strlen(value));
  return result;
}
void set(p::FieldValue& field, const char* value) {
  field.present = true;
  field.length = std::strlen(value);
  std::memcpy(field.text.data(), value, field.length);
}
void num(p::FieldValue& field, std::uint32_t value) {
  field.present = true;
  field.number = value;
}
std::vector<std::uint8_t> frame(const p::Message& message) {
  std::vector<std::uint8_t> bytes(p::kMaxEncoded + 1);
  std::size_t size = 0;
  if (!p::encode_frame(message, bytes.data(), bytes.size(), size))
    std::abort();
  bytes.resize(size);
  return bytes;
}
std::vector<std::uint8_t> hello(const char* link) {
  p::Message request{};
  request.type = p::MessageType::Hello;
  set(request.fields[p::kHelloLink], link);
  set(request.fields[p::kHelloOwner], "agent-A");
  num(request.fields[p::kHelloMinVersion], 1);
  num(request.fields[p::kHelloMaxVersion], 1);
  return frame(request);
}
std::vector<std::uint8_t> sync(const char* link) {
  p::Message request{};
  request.type = p::MessageType::Sync;
  set(request.fields[p::kSyncLink], link);
  set(request.fields[p::kSyncBoot], "boot-A");
  num(request.fields[p::kSyncRequest], 1);
  return frame(request);
}
struct Wire {
  std::array<unsigned, 2> writes{};
  std::array<bool, 2> fail{};
};
bool write(d::HostLink link, const std::uint8_t*, std::size_t, void* context) {
  auto& wire = *static_cast<Wire*>(context);
  const auto index = static_cast<std::size_t>(link);
  ++wire.writes[index];
  return !wire.fail[index];
}
constexpr auto kUsb = static_cast<std::size_t>(d::HostLink::Usb);
constexpr auto kBle = static_cast<std::size_t>(d::HostLink::Ble);

int routing() {
  Store store;
  d::Configuration authority(store, text<64>("boot-A"));
  d::Session session(authority, text<64>("device-A"), text<64>("boot-A"));
  Wire wire;
  static d::HostLinks links(session, write, &wire);
  const auto send = [&](d::HostLink link, const std::vector<std::uint8_t>& bytes,
                        std::uint64_t now) { links.feed(link, bytes.data(), bytes.size(), now); };

  // Replies go only to the link that asked.
  send(d::HostLink::Ble, hello("ble-1"), 100);
  CHECK(wire.writes[kBle] == 1 && wire.writes[kUsb] == 0);
  send(d::HostLink::Ble, sync("ble-1"), 110);
  CHECK(wire.writes[kBle] == 2 && session.synchronized());
  CHECK(links.ready(d::HostLink::Ble, 120) && !links.ready(d::HostLink::Usb, 120));
  // A background app may stay quiet for minutes and is still attached while its link is up.
  CHECK(links.attached(120) && links.attached(110 + 100 * d::HostLinks::kActiveMs));
  CHECK(!links.ready(d::HostLink::Ble, 110 + d::HostLinks::kActiveMs));

  // A link that does not own the session gets no answer and cannot end it.
  send(d::HostLink::Usb, sync("ble-1x"), 130);
  CHECK(wire.writes[kUsb] == 0 && session.synchronized());
  links.closed(d::HostLink::Usb);
  CHECK(session.synchronized());
  const std::uint8_t partial[] = {1, 2, 3};
  links.feed(d::HostLink::Usb, partial, sizeof(partial), 140);
  links.tick(140 + d::HostLinks::kUsbStallMs + 1);
  CHECK(session.synchronized());

  // The newest hello takes over, and the old link's traffic is ignored.
  send(d::HostLink::Usb, hello("usb-1"), 200);
  CHECK(wire.writes[kUsb] == 1 && !session.synchronized());
  send(d::HostLink::Usb, sync("usb-1"), 210);
  CHECK(session.synchronized());
  const auto before = wire.writes[kBle];
  send(d::HostLink::Ble, sync("ble-1"), 220);
  CHECK(wire.writes[kBle] == before && session.synchronized());
  CHECK(links.ready(d::HostLink::Usb, 230) && !links.ready(d::HostLink::Ble, 230));

  // Losing the old link changes nothing; losing the owner ends the session.
  links.closed(d::HostLink::Ble);
  CHECK(session.synchronized());
  links.closed(d::HostLink::Usb);
  CHECK(!session.synchronized() && !links.ready(d::HostLink::Usb, 240));

  // A stalled frame on the owning link ends the session, at that link's own limit.
  send(d::HostLink::Ble, hello("ble-2"), 300);
  send(d::HostLink::Ble, sync("ble-2"), 310);
  CHECK(session.synchronized());
  links.feed(d::HostLink::Ble, partial, sizeof(partial), 320);
  links.tick(320 + d::HostLinks::kUsbStallMs + 1);
  CHECK(session.synchronized());
  links.tick(320 + d::HostLinks::kBleStallMs + 1);
  CHECK(!session.synchronized());

  // A locally paused frame survives output congestion, then completes normally.
  send(d::HostLink::Ble, hello("ble-paused"), 7000);
  send(d::HostLink::Ble, sync("ble-paused"), 7010);
  const auto paused_frame = sync("ble-paused");
  links.feed(d::HostLink::Ble, paused_frame.data(), 5, 7020);
  links.paused(d::HostLink::Ble, 14000);
  links.tick(14001);
  CHECK(session.synchronized());
  links.feed(d::HostLink::Ble, paused_frame.data() + 5, paused_frame.size() - 5, 14002);
  CHECK(session.synchronized());

  // A failed write ends the session when that link owns it.
  send(d::HostLink::Ble, hello("ble-3"), 400);
  send(d::HostLink::Ble, sync("ble-3"), 410);
  CHECK(session.synchronized());
  wire.fail[kBle] = true;
  send(d::HostLink::Ble, sync("ble-3"), 420);
  CHECK(!session.synchronized());
  return 0;
}
struct FakePairing : d::PairingControl {
  unsigned opens = 0;
  int passkey = 123456;
  void open(std::uint64_t) override { ++opens; }
  d::PairingView view(std::uint64_t) const override {
    d::PairingView view;
    view.state = "passkey";
    view.passkey = passkey;
    view.seconds = 100;
    view.bonds = 1;
    view.name = "Reaper-1A2B";
    return view;
  }
};
std::vector<std::uint8_t> pairing_request(const char* link, std::uint32_t open) {
  p::Message request{};
  request.type = p::MessageType::PairingRequest;
  set(request.fields[p::kPairingRequestLink], link);
  set(request.fields[p::kPairingRequestBoot], "boot-A");
  num(request.fields[p::kPairingRequestRequest], 1);
  num(request.fields[p::kPairingRequestOpen], open);
  return frame(request);
}
struct Captured {
  p::Message last{};
  bool seen = false;
};
void capture(const p::Message& message, void* context) {
  auto& captured = *static_cast<Captured*>(context);
  captured.last = message;
  captured.seen = true;
}
bool write_capture(d::HostLink, const std::uint8_t* data, std::size_t size, void* context) {
  static p::FrameDecoder decoder;
  decoder.feed(data, size, capture, context);
  return true;
}
bool is(const p::FieldValue& field, const char* value) {
  return field.length == std::strlen(value) &&
         std::memcmp(field.text.data(), value, field.length) == 0;
}
int alerts() {
  Store store;
  d::Configuration authority(store, text<64>("boot-A"));
  d::Inbox inbox;
  d::MessageQueue messages(text<64>("boot-A"));
  d::RadioInfo info{};
  d::Session session(authority, text<64>("device-A"), text<64>("boot-A"), &messages, &info, &inbox);
  Wire wire;
  static d::HostLinks links(session, write, &wire);
  const auto send = [&](d::HostLink link, const std::vector<std::uint8_t>& bytes,
                        std::uint64_t now) { links.feed(link, bytes.data(), bytes.size(), now); };
  p::Message asking{};
  asking.type = p::MessageType::Hello;
  const auto put = [](p::FieldValue& field, const char* value) {
    field.present = true;
    field.length = std::strlen(value);
    std::memcpy(field.text.data(), value, field.length);
  };
  const auto number = [](p::FieldValue& field, std::uint32_t value) {
    field.present = true;
    field.number = value;
  };
  put(asking.fields[p::kHelloLink], "ble-1");
  put(asking.fields[p::kHelloOwner], "agent-A");
  number(asking.fields[p::kHelloMinVersion], 1);
  number(asking.fields[p::kHelloMaxVersion], 1);
  number(asking.fields[p::kHelloAgentFeatures], 1);
  std::array<std::uint8_t, p::kMaxEncoded + 1> encoded{};
  std::size_t size = 0;
  CHECK(p::encode_frame(asking, encoded.data(), encoded.size(), size));
  send(d::HostLink::Ble, std::vector<std::uint8_t>(encoded.begin(), encoded.begin() + size), 10);
  send(d::HostLink::Ble, sync("ble-1"), 20);
  CHECK(session.synchronized());
  const auto before = wire.writes[kBle];
  links.tick(30);
  CHECK(wire.writes[kBle] == before);  // Nothing new.
  const std::uint8_t body[] = {'h', 'i'};
  CHECK(inbox.append(text<64>("node-B"), text<64>("m1"), text<64>("broadcast"), 0, body, 2));
  links.tick(40);
  // Goes to the owner's link only, once.
  CHECK(wire.writes[kBle] == before + 1 && wire.writes[kUsb] == 0);
  links.tick(50);
  CHECK(wire.writes[kBle] == before + 1);
  return 0;
}
int pairing() {
  Store store;
  d::Configuration authority(store, text<64>("boot-A"));
  FakePairing control;
  d::Session session(authority, text<64>("device-A"), text<64>("boot-A"), nullptr, nullptr, nullptr,
                     nullptr, &control);
  static Captured captured;
  static d::HostLinks links(session, write_capture, &captured);
  const auto send = [&](d::HostLink link, const std::vector<std::uint8_t>& bytes,
                        std::uint64_t now) {
    captured.seen = false;
    links.feed(link, bytes.data(), bytes.size(), now);
  };
  // Nothing before the session is synchronized.
  send(d::HostLink::Usb, hello("usb-1"), 10);
  CHECK(captured.last.fields[p::kWelcomeFeatures].number & 8192);
  send(d::HostLink::Usb, pairing_request("usb-1", 1), 20);
  CHECK(!captured.seen && control.opens == 0);
  CHECK(!links.attached(25));
  send(d::HostLink::Usb, sync("usb-1"), 30);
  // A UART shows no disconnect, so USB counts as attached only with recent traffic.
  CHECK(links.attached(31) && !links.attached(30 + d::HostLinks::kActiveMs));

  // USB can read the state without opening, then open, and sees the passkey.
  send(d::HostLink::Usb, pairing_request("usb-1", 0), 40);
  CHECK(captured.seen && control.opens == 0);
  send(d::HostLink::Usb, pairing_request("usb-1", 1), 50);
  CHECK(captured.seen && control.opens == 1);
  CHECK(captured.last.type == p::MessageType::PairingStatus);
  CHECK(is(captured.last.fields[p::kPairingStatusState], "passkey"));
  CHECK(captured.last.fields[p::kPairingStatusPasskey].present);
  CHECK(captured.last.fields[p::kPairingStatusPasskey].number == 123456);
  CHECK(is(captured.last.fields[p::kPairingStatusName], "Reaper-1A2B"));

  // Bluetooth, even as the session's owner, can neither open pairing nor read a passkey.
  send(d::HostLink::Ble, hello("ble-1"), 60);
  send(d::HostLink::Ble, sync("ble-1"), 70);
  CHECK(session.synchronized());
  send(d::HostLink::Ble, pairing_request("ble-1", 1), 80);
  CHECK(captured.seen && control.opens == 1);
  CHECK(is(captured.last.fields[p::kPairingStatusState], "refused"));
  CHECK(!captured.last.fields[p::kPairingStatusPasskey].present);
  CHECK(!captured.last.fields[p::kPairingStatusName].present);
  send(d::HostLink::Ble, pairing_request("ble-1", 0), 90);
  CHECK(is(captured.last.fields[p::kPairingStatusState], "refused"));
  CHECK(!captured.last.fields[p::kPairingStatusPasskey].present);

  // A USB request with the Bluetooth session's link is ignored, not treated as physical.
  send(d::HostLink::Usb, pairing_request("ble-1x", 1), 100);
  CHECK(!captured.seen && control.opens == 1);
  return 0;
}
int window() {
  d::PairingWindow pairing;
  CHECK(!pairing.open() && pairing.connection_deadline() == d::PairingWindow::kIdleDeadlineMs);
  // Outcomes cannot open or change a closed window.
  pairing.paired(10);
  pairing.failed(10);
  CHECK(pairing.state() == d::PairingState::Closed);

  pairing.hold(1000, 0);
  CHECK(pairing.open() && pairing.connection_deadline() == d::PairingWindow::kPairingDeadlineMs);
  CHECK(pairing.seconds_left(1000) == 120 && pairing.seconds_left(1001) == 120);
  pairing.tick(1000 + d::PairingWindow::kOpenMs - 1);
  CHECK(pairing.open());
  pairing.tick(1000 + d::PairingWindow::kOpenMs);
  CHECK(!pairing.open() && pairing.state() == d::PairingState::Closed);

  // One pairing or one failed attempt closes it; another hold is needed to try again.
  pairing.hold(2000, 0);
  pairing.failed(2100);
  CHECK(!pairing.open() && pairing.state() == d::PairingState::Failed);
  pairing.paired(2200);
  CHECK(pairing.state() == d::PairingState::Failed);
  pairing.tick(2100 + d::PairingWindow::kNoticeMs);
  CHECK(pairing.state() == d::PairingState::Closed);
  pairing.hold(3000, 1);
  pairing.paired(3100);
  CHECK(!pairing.open() && pairing.state() == d::PairingState::Paired);

  // A full list refuses to open, and forgetting closes an open window.
  pairing.hold(4000, d::PairingWindow::kMaxBonds);
  CHECK(!pairing.open() && pairing.state() == d::PairingState::Full);
  pairing.hold(5000, d::PairingWindow::kMaxBonds - 1);
  CHECK(pairing.open());
  pairing.forgotten(5100);
  CHECK(!pairing.open() && pairing.state() == d::PairingState::Forgotten);
  return 0;
}
int trust() {
  d::LinkSecurity link{true, true, true, 16};
  CHECK(d::link_trusted(link));
  CHECK(!d::link_trusted({false, true, true, 16}));
  CHECK(!d::link_trusted({true, false, true, 16}));  // Just Works
  CHECK(!d::link_trusted({true, true, false, 16}));
  CHECK(!d::link_trusted({true, true, true, 15}));
  return 0;
}
int passkey() {
  std::uint32_t key = 7;
  CHECK(d::passkey_from_random(0, key) && key == 0);
  CHECK(d::passkey_from_random(999999, key) && key == 999999);
  CHECK(d::passkey_from_random(1000000, key) && key == 0);
  CHECK(d::passkey_from_random(4293999999u, key) && key == 999999);
  CHECK(!d::passkey_from_random(4294000000u, key));
  CHECK(!d::passkey_from_random(4294967295u, key));
  return 0;
}
}  // namespace
// Hosts competing over a link must only cost them their session. Sanitizers fail the run on any
// memory or arithmetic fault, and the pseudo-random order repeats exactly from its seed.
int competing() {
  Store store;
  d::Configuration authority(store, text<64>("boot-A"));
  d::Session session(authority, text<64>("device-A"), text<64>("boot-A"));
  Wire wire;
  static d::HostLinks links(session, write, &wire);
  std::uint32_t state = 0x5eed1234;
  const auto next = [&](std::uint32_t limit) {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return state % limit;
  };
  const auto hello_a = hello("ble-a"), hello_b = hello("ble-b"), sync_a = sync("ble-a"),
             sync_b = sync("ble-b");
  std::uint64_t now = 1000;
  std::array<std::uint8_t, 2200> noise{};
  for (unsigned step = 0; step < 200000; ++step) {
    now += next(40);
    const auto link = next(5) ? d::HostLink::Ble : d::HostLink::Usb;
    const auto action = next(10);
    const auto& bytes = action < 3   ? (next(2) ? hello_a : hello_b)
                        : action < 6 ? (next(2) ? sync_a : sync_b)
                                     : hello_a;
    if (action < 6) {
      // Split the way an ATT write can split a frame, so two hosts' pieces interleave.
      const std::size_t cut = next(static_cast<std::uint32_t>(bytes.size()) + 1);
      links.feed(link, bytes.data(), cut, now);
      if (next(4))
        links.feed(link, bytes.data() + cut, bytes.size() - cut, now);
    } else if (action == 6) {
      const std::size_t size = next(static_cast<std::uint32_t>(noise.size()) + 1);
      for (std::size_t i = 0; i < size; ++i)
        noise[i] = static_cast<std::uint8_t>(next(next(8) ? 256 : 2));
      links.feed(link, noise.data(), size, now);
    } else if (action == 7) {
      links.closed(link);
    } else if (action == 8) {
      wire.fail[static_cast<std::size_t>(link)] = next(8) == 0;
    } else if (next(16) == 0) {
      now += d::HostLinks::kBleStallMs + 1;
    }
    links.tick(now);
    session.tick(now);
    CHECK(!(links.ready(d::HostLink::Ble, now) && links.ready(d::HostLink::Usb, now)));
    if (links.attached(now))
      CHECK(session.synchronized());
  }
  // A clean hello still gets a working session afterward.
  wire.fail = {};
  links.closed(d::HostLink::Ble);
  links.closed(d::HostLink::Usb);
  now += 1;
  links.feed(d::HostLink::Ble, hello_a.data(), hello_a.size(), now);
  links.feed(d::HostLink::Ble, sync_a.data(), sync_a.size(), now);
  CHECK(session.synchronized() && links.ready(d::HostLink::Ble, now));
  return 0;
}
int main(int argc, char** argv) {
  if (argc != 2)
    return 2;
  const std::string scenario = argv[1];
  if (scenario == "competing")
    return competing();
  if (scenario == "routing")
    return routing();
  if (scenario == "alerts")
    return alerts();
  if (scenario == "pairing")
    return pairing();
  if (scenario == "window")
    return window();
  if (scenario == "trust")
    return trust();
  if (scenario == "passkey")
    return passkey();
  return 2;
}
