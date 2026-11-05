#include "reaper/session.hpp"
#include <cstring>
#include <iostream>
#include <string>

namespace p = reaper::protocol;
namespace d = reaper::device;
#define CHECK(value)                                              \
  do {                                                            \
    if (!(value)) {                                               \
      std::cerr << "line " << __LINE__ << ": " << #value << '\n'; \
      return 1;                                                   \
    }                                                             \
  } while (false)
struct Store : d::Storage {
  std::array<std::uint8_t, d::kMaxRecord> bytes{};
  std::size_t length = 0;
  unsigned writes = 0;
  bool fail = false;
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
    ++writes;
    if (fail)
      return d::CommitStatus::Indeterminate;
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
bool is(const p::FieldValue& field, const char* value) {
  return field.length == std::strlen(value) &&
         std::memcmp(field.text.data(), value, field.length) == 0;
}
p::Message hello(const char* link = "link-A", const char* owner = "agent-A") {
  p::Message request{};
  request.type = p::MessageType::Hello;
  set(request.fields[p::kHelloLink], link);
  set(request.fields[p::kHelloOwner], owner);
  num(request.fields[p::kHelloMinVersion], 1);
  num(request.fields[p::kHelloMaxVersion], 1);
  return request;
}
p::Message sync(const char* link = "link-A", const char* boot = "boot-A") {
  p::Message request{};
  request.type = p::MessageType::Sync;
  set(request.fields[p::kSyncLink], link);
  set(request.fields[p::kSyncBoot], boot);
  num(request.fields[p::kSyncRequest], 1);
  return request;
}
p::Message configure(const char* link = "link-A", const char* id = "agent-A:1") {
  p::Message request{};
  request.type = p::MessageType::Configure;
  set(request.fields[p::kConfigureLink], link);
  set(request.fields[p::kConfigureBoot], "boot-A");
  set(request.fields[p::kConfigureId], id);
  num(request.fields[p::kConfigureExpectedRevision], 0);
  set(request.fields[p::kConfigureLabel], "native session");
  set(request.fields[p::kConfigureRegion], "US");
  return request;
}
struct FakeNetwork final : d::NetworkControl {
  unsigned fills = 0, loads = 0, erases = 0;
  bool had_relay = false;
  d::NetworkView view() const override {
    d::NetworkView v{};
    v.mode = fills ? 2 : 0;
    v.generation = fills ? 1 : 0;
    v.team_loaded = loads > 0;
    v.healthy = true;
    if (fills)
      std::strcpy(v.relay_fingerprint, "0011223344556677");
    return v;
  }
  const char* fill(std::uint32_t, std::uint32_t, std::uint32_t,
                   const std::array<std::uint8_t, 32>* relay,
                   const std::array<std::uint8_t, 32>*) override {
    ++fills;
    had_relay = relay && (*relay)[0] == 0xab;
    return "ok";
  }
  const char* load_team(std::uint32_t, std::uint32_t,
                        const std::array<std::uint8_t, 32>&) override {
    ++loads;
    return "ok";
  }
  const char* erase() override {
    ++erases;
    return "ok";
  }
};
struct FakePairing final : d::PairingControl {
  bool window = false;
  void open(std::uint64_t) override {}
  d::PairingView view(std::uint64_t) const override {
    d::PairingView v{};
    v.state = window ? "open" : "closed";
    return v;
  }
};
constexpr char kKeyHex[] = "abababababababababababababababababababababababababababababababab";
p::Message network_fill() {
  p::Message request{};
  request.type = p::MessageType::NetworkFill;
  set(request.fields[p::kNetworkFillLink], "link-A");
  set(request.fields[p::kNetworkFillBoot], "boot-A");
  num(request.fields[p::kNetworkFillRequest], 7);
  num(request.fields[p::kNetworkFillNetworkMode], 2);
  num(request.fields[p::kNetworkFillGeneration], 1);
  num(request.fields[p::kNetworkFillEpoch], 0);
  set(request.fields[p::kNetworkFillRelayChain], kKeyHex);
  set(request.fields[p::kNetworkFillDeviceKey], kKeyHex);
  return request;
}
int main(int argc, char** argv) {
  if (argc != 2)
    return 2;
  const std::string scenario = argv[1];
  Store store;
  d::Configuration authority(store, text<64>("boot-A"));
  d::Session session(authority, text<64>("device-A"), text<64>("boot-A"));
  p::Message reply{};
  CHECK(session.handle(hello(), reply) && reply.type == p::MessageType::Welcome);
  CHECK(reply.fields[p::kWelcomeOwnerAdmitted].number == 1);
  CHECK(!session.synchronized());
  if (scenario == "alerts") {
    d::Inbox inbox;
    Store other;
    d::Configuration other_authority(other, text<64>("boot-A"));
    d::MessageQueue messages(text<64>("boot-A"));
    d::RadioInfo info{};
    d::Session s(other_authority, text<64>("device-A"), text<64>("boot-A"), &messages, &info,
                 &inbox);
    const std::uint8_t body[] = {'h', 'i'};
    const auto append = [&](const char* id) {
      return inbox.append(text<64>("node-B"), text<64>(id), text<64>("broadcast"), 0, body, 2);
    };
    // An agent that did not ask gets no alert, so it never sees a message type it does not know.
    CHECK(s.handle(hello(), reply) && (reply.fields[p::kWelcomeFeatures].number & 32768));
    CHECK(s.handle(sync(), reply));
    CHECK(append("a") && !s.take_alert(reply));
    // One that asks hears about messages from here on, not those already waiting.
    auto asking = hello();
    num(asking.fields[p::kHelloAgentFeatures], 1);
    CHECK(s.handle(asking, reply));
    CHECK(!s.take_alert(reply));  // Not synchronized.
    CHECK(s.handle(sync(), reply) && !s.take_alert(reply));
    CHECK(append("b") && s.take_alert(reply));
    CHECK(reply.type == p::MessageType::InboxChanged);
    CHECK(reply.fields[p::kInboxChangedLatest].number == 2);
    CHECK(is(reply.fields[p::kInboxChangedLink], "link-A"));
    // It stays pending until it was written, and is then sent once.
    CHECK(s.take_alert(reply));
    s.alert_sent();
    CHECK(!s.take_alert(reply));
  } else if (scenario == "opaque") {
    d::Inbox inbox;
    Store other;
    d::Configuration other_authority(other, text<64>("boot-A"));
    d::MessageQueue messages(text<64>("boot-A"));
    d::RadioInfo info{};
    d::Session s(other_authority, text<64>("device-A"), text<64>("boot-A"), &messages, &info,
                 &inbox);
    const std::uint8_t binary[] = {0xff, 0x00, 0xfe, 0x01};
    CHECK(inbox.append(text<64>("node-B"), text<64>("opaque_1"), text<64>("broadcast"), 0, binary,
                       sizeof(binary)));
    const auto read = [&](const char* expected_hex) {
      p::Message request{};
      request.type = p::MessageType::InboxRead;
      set(request.fields[p::kInboxReadLink], "link-A");
      set(request.fields[p::kInboxReadBoot], "boot-A");
      num(request.fields[p::kInboxReadRequest], 1);
      num(request.fields[p::kInboxReadSequence], 1);
      num(request.fields[p::kInboxReadPart], 0);
      return s.handle(request, reply) && reply.type == p::MessageType::InboxItem &&
             is(reply.fields[p::kInboxItemData], expected_hex) &&
             is(reply.fields[p::kInboxItemMessageId], "opaque_1");
    };
    // An agent that declared nothing gets readable text in its place, under the same identity.
    CHECK(s.handle(hello(), reply) && s.handle(sync(), reply));
    CHECK(read("556e737570706f72746564206d657373616765"));  // "Unsupported message"
    CHECK(reply.fields[p::kInboxItemCount].number == 1);
    // One that handles payloads gets the exact bytes.
    auto declaring = hello();
    num(declaring.fields[p::kHelloAgentFeatures], 2);
    CHECK(s.handle(declaring, reply) && s.handle(sync(), reply));
    CHECK(read("ff00fe01"));
  } else if (scenario == "network") {
    FakeNetwork network;
    FakePairing pairing;
    Store other;
    d::Configuration other_authority(other, text<64>("boot-A"));
    d::Session keyed(other_authority, text<64>("device-A"), text<64>("boot-A"), nullptr, nullptr,
                     nullptr, nullptr, &pairing, &network);
    CHECK(keyed.handle(hello(), reply) && (reply.fields[p::kWelcomeFeatures].number & 16384));
    CHECK(!(session.synchronized()));
    // Nothing is answered before the session is synchronized.
    CHECK(!keyed.handle(network_fill(), reply) && network.fills == 0);
    CHECK(keyed.handle(sync(), reply));
    // A paired phone cannot change keys or erase them.
    keyed.set_physical(false);
    CHECK(keyed.handle(network_fill(), reply) && reply.type == p::MessageType::NetworkStatus);
    CHECK(is(reply.fields[p::kNetworkStatusState], "refused") && network.fills == 0);
    CHECK(reply.fields[p::kNetworkStatusRequest].number == 7);
    p::Message erase{};
    erase.type = p::MessageType::NetworkErase;
    set(erase.fields[p::kNetworkEraseLink], "link-A");
    set(erase.fields[p::kNetworkEraseBoot], "boot-A");
    num(erase.fields[p::kNetworkEraseRequest], 8);
    CHECK(keyed.handle(erase, reply) && is(reply.fields[p::kNetworkStatusState], "refused"));
    CHECK(network.erases == 0);
    // It can load the team key, which is memory only.
    p::Message load{};
    load.type = p::MessageType::TeamLoad;
    set(load.fields[p::kTeamLoadLink], "link-A");
    set(load.fields[p::kTeamLoadBoot], "boot-A");
    num(load.fields[p::kTeamLoadRequest], 9);
    num(load.fields[p::kTeamLoadGeneration], 1);
    num(load.fields[p::kTeamLoadEpoch], 0);
    set(load.fields[p::kTeamLoadTeamChain], kKeyHex);
    CHECK(keyed.handle(load, reply) && is(reply.fields[p::kNetworkStatusState], "ok"));
    CHECK(network.loads == 1);
    // The button-opened window lets that phone fill.
    pairing.window = true;
    CHECK(keyed.handle(network_fill(), reply) && is(reply.fields[p::kNetworkStatusState], "ok"));
    CHECK(network.fills == 1 && network.had_relay);
    pairing.window = false;
    // A cable needs no window.
    keyed.set_physical(true);
    CHECK(keyed.handle(network_fill(), reply) && network.fills == 2);
    CHECK(keyed.handle(erase, reply) && network.erases == 1);
    // A malformed key never reaches the store.
    auto bad = network_fill();
    set(bad.fields[p::kNetworkFillRelayChain], "abcd");
    CHECK(keyed.handle(bad, reply) && is(reply.fields[p::kNetworkStatusState], "invalid"));
    CHECK(network.fills == 2);
    // A wrong boot is ignored.
    auto stale = network_fill();
    set(stale.fields[p::kNetworkFillBoot], "boot-B");
    CHECK(!keyed.handle(stale, reply) && network.fills == 2);
    // The reply carries fingerprints, never keys.
    CHECK(keyed.handle(network_fill(), reply));
    CHECK(is(reply.fields[p::kNetworkStatusRelayFingerprint], "0011223344556677"));
  } else if (scenario == "sync") {
    CHECK(session.handle(configure(), reply) && is(reply.fields[p::kResultOutcome], "rejected"));
    CHECK(store.writes == 0);
    CHECK(session.handle(sync(), reply) && reply.type == p::MessageType::Snapshot);
    CHECK(session.synchronized());
    CHECK(session.handle(configure(), reply) && is(reply.fields[p::kResultOutcome], "committed"));
    CHECK(session.handle(sync(), reply) && reply.fields[p::kSnapshotRevision].number == 1);
    CHECK(is(reply.fields[p::kSnapshotLabel], "native session"));
  } else if (scenario == "boost") {
    // Features report levels always, and boost only for a board that has it.
    CHECK(reply.fields[p::kWelcomeFeatures].number & 2048);
    CHECK(!(reply.fields[p::kWelcomeFeatures].number & 4096));
    CHECK(session.handle(sync(), reply) && reply.fields[p::kSnapshotTxLevel].number == 1 &&
          reply.fields[p::kSnapshotTxBoost].number == 0);
    const auto radio = [](const char* id, std::uint32_t boost) {
      auto request = configure("link-A", id);
      set(request.fields[p::kConfigureRadioMode], "off");
      num(request.fields[p::kConfigureTxLevel], 2);
      num(request.fields[p::kConfigureTxBoost], boost);
      num(request.fields[p::kConfigureRelay], 0);
      set(request.fields[p::kConfigureChannels], "Public|||||||");
      set(request.fields[p::kConfigureChannelIds],
          "00000000|00000000|00000000|00000000|00000000|00000000|00000000|00000000");
      set(request.fields[p::kConfigurePreset], "US915_LAB1");
      return request;
    };
    CHECK(session.handle(radio("agent-A:1", 1), reply) &&
          is(reply.fields[p::kResultOutcome], "rejected") && store.writes == 0);
    Store boosted_store;
    d::Configuration boosted_authority(boosted_store, text<64>("boot-A"));
    d::RadioInfo info{};
    info.tx_boost = true;
    d::Session boosted(boosted_authority, text<64>("device-A"), text<64>("boot-A"), nullptr, &info);
    CHECK(boosted.handle(hello(), reply) && (reply.fields[p::kWelcomeFeatures].number & 4096));
    CHECK(boosted.handle(sync(), reply));
    CHECK(boosted.handle(radio("agent-A:1", 1), reply) &&
          is(reply.fields[p::kResultOutcome], "committed"));
    CHECK(boosted.handle(sync(), reply) && reply.fields[p::kSnapshotTxLevel].number == 2 &&
          reply.fields[p::kSnapshotTxBoost].number == 1);
  } else if (scenario == "identity") {
    CHECK(!session.handle(sync("old-link"), reply));
    CHECK(!session.handle(sync("link-A", "old-boot"), reply));
    CHECK(session.handle(sync(), reply));
    CHECK(session.handle(configure("link-A", "other:1"), reply) &&
          is(reply.fields[p::kResultOutcome], "rejected"));
    auto eu = configure();
    set(eu.fields[p::kConfigureRegion], "EU");
    CHECK(session.handle(eu, reply) && is(reply.fields[p::kResultOutcome], "rejected") &&
          store.writes == 0);
  } else if (scenario == "reconnect") {
    CHECK(session.handle(sync(), reply));
    CHECK(session.handle(configure(), reply));  // Lose this reply.
    CHECK(session.handle(hello("link-B"), reply));
    CHECK(!session.handle(configure(), reply));
    CHECK(session.handle(sync("link-B"), reply));
    p::Message query{};
    query.type = p::MessageType::Query;
    set(query.fields[p::kQueryLink], "link-B");
    set(query.fields[p::kQueryBoot], "boot-A");
    set(query.fields[p::kQueryId], "agent-A:1");
    CHECK(session.handle(query, reply) && is(reply.fields[p::kResultOutcome], "committed"));
    CHECK(store.writes == 1);
    CHECK(session.synchronized());
    session.reset();
    CHECK(!session.synchronized());
  } else if (scenario == "storage") {
    CHECK(session.handle(sync(), reply));
    store.fail = true;
    CHECK(session.handle(configure(), reply) && is(reply.fields[p::kResultOutcome], "unknown"));
    CHECK(session.take_error(reply) && reply.type == p::MessageType::Error &&
          is(reply.fields[p::kErrorCode], "storage-unavailable"));
    CHECK(!session.handle(sync(), reply));
    CHECK(session.handle(hello("link-B"), reply) && reply.type == p::MessageType::Error);
    CHECK(store.writes == 1);
  } else if (scenario == "version") {
    for (unsigned i = 0; i < 10; ++i) {
      const auto owner = "incompatible-" + std::to_string(i);
      auto request = hello("link-B", owner.c_str());
      num(request.fields[p::kHelloMinVersion], 2);
      num(request.fields[p::kHelloMaxVersion], 3);
      CHECK(session.handle(request, reply));
      CHECK(reply.fields[p::kWelcomeOwnerAdmitted].number == 0);
      CHECK(!session.handle(sync("link-B"), reply));
    }
    CHECK(session.handle(hello("link-C", "new-owner"), reply) &&
          reply.fields[p::kWelcomeOwnerAdmitted].number == 1);
  } else
    return 3;
  std::cout << "ok " << scenario << '\n';
}
