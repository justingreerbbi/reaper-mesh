#include "reaper/messages.hpp"
#include <cstring>
#include <iostream>
#include <string>
namespace d = reaper::device;
#define CHECK(v)                                              \
  do {                                                        \
    if (!(v)) {                                               \
      std::cerr << "line " << __LINE__ << ": " << #v << '\n'; \
      return 1;                                               \
    }                                                         \
  } while (false)
template <std::size_t N>
d::Text<N> text(const std::string& value) {
  d::Text<N> t{};
  t.assign(reinterpret_cast<const std::uint8_t*>(value.data()), value.size());
  return t;
}
int main(int argc, char** argv) {
  if (argc != 2)
    return 2;
  const std::string scenario = argv[1];
  d::MessageQueue queue(text<64>("boot-A"));
  const auto owner = text<64>("owner"), dest = text<64>("node-B");
  const auto id = text<75>("owner:1");
  std::array<std::uint8_t, 32> chunk{};
  chunk.fill('x');
  auto submit = [&](unsigned part, unsigned count, std::size_t size = 32, std::uint64_t now = 0) {
    return queue.submit(owner, id, 0, dest, part, count, chunk.data(), size, now);
  };
  if (scenario == "chunks") {
    CHECK(submit(31, 32).state == d::MessageState::Receiving);
    for (unsigned i = 0; i < 31; ++i)
      CHECK(submit(i, 32).state ==
            (i == 30 ? d::MessageState::Queued : d::MessageState::Receiving));
    CHECK(queue.records()[0].size == 1024 && queue.records()[0].received == 0xffffffff);
    auto receipt = submit(0, 32);
    CHECK(receipt.state == d::MessageState::Queued);
    chunk[0] = 'z';
    CHECK(submit(0, 32).state == d::MessageState::Rejected);
    CHECK(queue.query(id).state == d::MessageState::Queued && queue.records()[0].bytes[0] == 'x');
  } else if (scenario == "expiry") {
    CHECK(submit(0, 2).state == d::MessageState::Receiving);
    CHECK(submit(1, 2, 2, 5000).state == d::MessageState::Failed);
    CHECK(submit(0, 2, 32, 5001).state == d::MessageState::Failed);
  } else if (scenario == "ack") {
    auto r = submit(0, 1, 2);
    CHECK(r.state == d::MessageState::Queued);
    CHECK(!queue.acknowledge(r.message_id, dest, 1));
    CHECK(queue.transmitted(r.message_id, 2));
    CHECK(!queue.acknowledge(r.message_id, text<64>("other"), 3));
    CHECK(queue.acknowledge(r.message_id, dest, 59999));
    queue.tick(60000);
    CHECK(queue.query(id).state == d::MessageState::Acknowledged);
    auto r2 = queue.submit(owner, text<75>("owner:2"), 0, dest, 0, 1, chunk.data(), 2, 0);
    CHECK(queue.transmitted(r2.message_id, 1));
    CHECK(!queue.acknowledge(r2.message_id, dest, 60000));
    CHECK(queue.query(text<75>("owner:2")).state == d::MessageState::Failed);
    auto r3 = queue.submit(owner, text<75>("owner:3"), 0, text<64>("broadcast"), 0, 1, chunk.data(),
                           2, 60001);
    CHECK(queue.transmitted(r3.message_id, 60002));
    CHECK(!queue.acknowledge(r3.message_id, text<64>("broadcast"), 60003));
    queue.tick(999999);
    CHECK(queue.query(text<75>("owner:3")).state == d::MessageState::Transmitted);
  } else if (scenario == "capacity") {
    for (unsigned i = 1; i <= 8; ++i)
      CHECK(queue
                .submit(owner, text<75>("owner:" + std::to_string(i)), 0, dest, 0, 1, chunk.data(),
                        2, 0)
                .state == d::MessageState::Queued);
    CHECK(queue.submit(owner, text<75>("owner:9"), 0, dest, 0, 1, chunk.data(), 2, 0).state ==
          d::MessageState::Rejected);
    queue.tick(60000);
    CHECK(queue.submit(owner, text<75>("owner:10"), 0, dest, 0, 1, chunk.data(), 2, 60001).state ==
          d::MessageState::Queued);
    CHECK(queue.query(id).state == d::MessageState::Unknown);
    CHECK(queue.submit(owner, id, 0, dest, 0, 1, chunk.data(), 2, 60002).state ==
          d::MessageState::Unknown);
    CHECK(queue.submit(owner, text<75>("owner:9"), 0, dest, 0, 1, chunk.data(), 2, 60002).state ==
          d::MessageState::Unknown);
  } else if (scenario == "validation") {
    chunk[0] = 0xc0;
    chunk[1] = 0x80;
    CHECK(submit(0, 1, 2).state == d::MessageState::Rejected);
    CHECK(queue.submit(owner, text<75>("other:2"), 0, dest, 0, 1, chunk.data(), 2, 0).state ==
          d::MessageState::Rejected);
    chunk.fill('x');
    for (unsigned i = 0; i < 7; ++i) {
      auto name = "new" + std::to_string(i);
      CHECK(queue.submit(text<64>(name), text<75>(name + ":1"), 0, dest, 0, 1, chunk.data(), 2, 0)
                .state == d::MessageState::Queued);
    }
    CHECK(
        queue
            .submit(text<64>("overflow"), text<75>("overflow:1"), 0, dest, 0, 1, chunk.data(), 2, 0)
            .state == d::MessageState::Rejected);
  } else
    return 3;
  std::cout << "ok " << scenario << '\n';
}
