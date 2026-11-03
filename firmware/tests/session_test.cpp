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
  if (scenario == "sync") {
    CHECK(session.handle(configure(), reply) && is(reply.fields[p::kResultOutcome], "rejected"));
    CHECK(store.writes == 0);
    CHECK(session.handle(sync(), reply) && reply.type == p::MessageType::Snapshot);
    CHECK(session.synchronized());
    CHECK(session.handle(configure(), reply) && is(reply.fields[p::kResultOutcome], "committed"));
    CHECK(session.handle(sync(), reply) && reply.fields[p::kSnapshotRevision].number == 1);
    CHECK(is(reply.fields[p::kSnapshotLabel], "native session"));
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
