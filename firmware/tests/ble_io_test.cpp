#include "ble_io.hpp"
#include <algorithm>
#include <cstring>
#include <deque>
#include <iostream>
#include <string>
#include <vector>
#define CHECK(v)                                              \
  do {                                                        \
    if (!(v)) {                                               \
      std::cerr << "line " << __LINE__ << ": " << #v << '\n'; \
      return 1;                                               \
    }                                                         \
  } while (false)
int main(int argc, char** argv) {
  if (argc != 2)
    return 2;
  const std::string scenario = argv[1];
  if (scenario == "congestion") {
    std::deque<std::uint8_t> input(4090, 1);
    const std::array<std::uint8_t, 20> chunk{2, 3, 4};
    const auto accept = [&] {
      return reaper::ble::accept(
          chunk.data(), chunk.size(), [&] { return 4096 - input.size(); },
          [&](const std::uint8_t* bytes, std::size_t size) {
            input.insert(input.end(), bytes, bytes + size);
            return size;
          });
    };
    if (accept() || input.size() != 4090)
      return 1;
    std::vector<std::uint8_t> received;
    reaper::ble::drain(
        [&](std::uint8_t* bytes, std::size_t size) {
          size = std::min(size, input.size());
          for (std::size_t i = 0; i < size; ++i) {
            bytes[i] = input.front();
            input.pop_front();
          }
          return size;
        },
        [&](const std::uint8_t* bytes, std::size_t size) {
          received.insert(received.end(), bytes, bytes + size);
        },
        [] {});
    CHECK(received.size() == 4090 && input.empty());
    CHECK(accept() && input.size() == 20);
    CHECK(std::equal(input.begin(), input.end(), chunk.begin()));
  } else if (scenario == "fairness") {
    unsigned reads = 0, pumps = 0, processed = 0;
    std::size_t queued_reply = 0, maximum = 0;
    reaper::ble::drain(
        [&](std::uint8_t* bytes, std::size_t capacity) {
          ++reads;
          std::memset(bytes, 1, capacity);
          return capacity;  // Continuously writing peer.
        },
        [&](const std::uint8_t*, std::size_t size) {
          processed += size;
          queued_reply += 1024;
          maximum = std::max(maximum, queued_reply);
        },
        [&] {
          ++pumps;
          queued_reply = 0;
        });
    CHECK(reads == 16 && processed == 4096 && pumps == 17);
    CHECK(maximum == 1024 && queued_reply == 0);  // Replies never accumulate to overflow.
  } else
    return 3;
  std::cout << "ok " << scenario << '\n';
}
