#include "reaper/session.hpp"
#include <cstring>
#include <iostream>
#include <string>
namespace d = reaper::device;
namespace p = reaper::protocol;
#define CHECK(v)                                              \
  do {                                                        \
    if (!(v)) {                                               \
      std::cerr << "line " << __LINE__ << ": " << #v << '\n'; \
      return 1;                                               \
    }                                                         \
  } while (false)
template <std::size_t N>
d::Text<N> text(const std::string& value) {
  d::Text<N> out{};
  out.assign(reinterpret_cast<const std::uint8_t*>(value.data()), value.size());
  return out;
}
void set(p::FieldValue& f, const char* value) {
  f.present = true;
  f.length = std::strlen(value);
  std::memcpy(f.text.data(), value, f.length);
}
void number(p::FieldValue& f, std::uint32_t n) {
  f.present = true;
  f.number = n;
}
struct Store : d::Storage {
  d::ReadStatus read(std::uint8_t*, std::size_t, std::size_t& size) noexcept override {
    size = 0;
    return d::ReadStatus::Missing;
  }
  d::CommitStatus commit(const std::uint8_t*, std::size_t) noexcept override {
    return d::CommitStatus::Committed;
  }
};
int main(int argc, char** argv) {
  if (argc != 2)
    return 2;
  const std::string scenario = argv[1];
  d::Inbox inbox;
  std::array<std::uint8_t, 1024> body{};
  body.fill('x');
  const auto origin = text<64>("node-B");
  if (scenario == "retention") {
    for (unsigned i = 1; i <= 9; ++i)
      CHECK(inbox.append(origin, text<64>("remote_" + std::to_string(i)), text<64>("broadcast"), 0,
                         body.data(), body.size()));
    CHECK(inbox.oldest() == 2 && inbox.latest() == 9 && !inbox.find(1));
    CHECK(inbox.append(origin, text<64>("remote_9"), text<64>("broadcast"), 0, body.data(),
                       body.size()) &&
          inbox.latest() == 9);
    body[0] = 'z';
    CHECK(!inbox.append(origin, text<64>("remote_9"), text<64>("broadcast"), 0, body.data(),
                        body.size()));
    CHECK(!inbox.append(text<64>("bad/id"), text<64>("next"), text<64>("broadcast"), 0, body.data(),
                        body.size()));
  } else if (scenario == "wire") {
    CHECK(inbox.append(origin, text<64>("remote_1"), text<64>("broadcast"), 0, body.data(),
                       body.size()));
    Store store;
    d::Configuration authority(store, text<64>("boot-A"));
    d::MessageQueue messages(text<64>("boot-A"));
    d::RadioInfo info;
    info.state = text<64>("off");
    info.reason = text<64>("radio-off");
    info.probe = true;
    d::Session session(authority, text<64>("node-A"), text<64>("boot-A"), &messages, &info, &inbox);
    p::Message request{}, reply{};
    request.type = p::MessageType::Hello;
    set(request.fields[p::kHelloLink], "link-A");
    number(request.fields[p::kHelloMinVersion], 1);
    number(request.fields[p::kHelloMaxVersion], 1);
    CHECK(session.handle(request, reply));
    CHECK(reply.fields[p::kWelcomeInboxVersion].number == 2 &&
          reply.fields[p::kWelcomeInboxCapacity].number == 8 &&
          reply.fields[p::kWelcomeRadioVersion].number == 1);
    request = {};
    request.type = p::MessageType::Sync;
    set(request.fields[0], "link-A");
    set(request.fields[1], "boot-A");
    number(request.fields[2], 1);
    CHECK(session.handle(request, reply));
    request.type = p::MessageType::InboxQuery;
    CHECK(session.handle(request, reply) && reply.fields[p::kInboxHeadLatest].number == 1);
    request.type = p::MessageType::InboxRead;
    number(request.fields[p::kInboxReadSequence], 1);
    number(request.fields[p::kInboxReadPart], 31);
    CHECK(session.handle(request, reply) && reply.type == p::MessageType::InboxItem &&
          reply.fields[p::kInboxItemData].length == 64);
    CHECK(reply.fields[p::kInboxItemDestination].present &&
          std::memcmp(reply.fields[p::kInboxItemDestination].text.data(), "broadcast", 9) == 0);
    number(request.fields[p::kInboxReadPart], 32);
    CHECK(session.handle(request, reply) && reply.type == p::MessageType::InboxMissing);
    request = {};
    request.type = p::MessageType::RadioQuery;
    set(request.fields[0], "link-A");
    set(request.fields[1], "boot-A");
    number(request.fields[2], 2);
    CHECK(session.handle(request, reply) && reply.type == p::MessageType::RadioStatus &&
          reply.fields[p::kRadioStatusProbe].number == 1);
    std::array<std::uint8_t, p::kMaxPayload> encoded{};
    std::size_t size = 0;
    CHECK(p::encode_payload(reply, encoded.data(), encoded.size(), size));
  } else
    return 3;
  std::cout << "ok " << scenario << '\n';
}
