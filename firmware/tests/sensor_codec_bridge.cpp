// Host test bridge for the sensor protocol codec: reads hex streams, one per line, and writes the
// re-encoded frames it accepted. tests/simulator/sensor-embedded.test.ts compares the output with
// the agent's codec.
#include "reaper/sensor_protocol.hpp"
#include <algorithm>
#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>

namespace s = reaper::sensor;
namespace {
int nibble(char value) {
  if (value >= '0' && value <= '9')
    return value - '0';
  if (value >= 'a' && value <= 'f')
    return value - 'a' + 10;
  return -1;
}
void received(const s::Message& message, void* context) {
  auto& count = *static_cast<std::size_t*>(context);
  std::array<std::uint8_t, s::kMaxEncoded + 1> encoded{};
  std::size_t size = 0;
  if (!s::encode_frame(message, encoded.data(), encoded.size(), size))
    std::abort();
  if (count++)
    std::cout << '|';
  constexpr char digits[] = "0123456789abcdef";
  for (std::size_t i = 0; i < size; ++i)
    std::cout << digits[encoded[i] >> 4] << digits[encoded[i] & 15];
}
}  // namespace

int main(int argc, char** argv) {
  if (argc == 2 && std::string(argv[1]) == "selftest") {
    s::Message sentinel{};
    sentinel.type = s::MessageType::Status;
    const std::uint8_t bad[] = {1, 255};
    if (s::decode_payload(bad, sizeof(bad), sentinel) || sentinel.type != s::MessageType::Status)
      return 2;
    std::size_t length = 99;
    std::uint8_t small[1]{};
    if (s::encode_frame(sentinel, small, sizeof(small), length) || length != 0)
      return 3;
    // An inverted version range is refused, as in the node codec.
    s::Message hello{};
    hello.type = s::MessageType::Hello;
    hello.fields[s::kHelloLink].present = true;
    hello.fields[s::kHelloLink].length = 1;
    hello.fields[s::kHelloLink].text[0] = 'A';
    hello.fields[s::kHelloMinVersion].present = true;
    hello.fields[s::kHelloMinVersion].number = 2;
    hello.fields[s::kHelloMaxVersion].present = true;
    hello.fields[s::kHelloMaxVersion].number = 1;
    std::array<std::uint8_t, s::kMaxEncoded + 1> encoded{};
    if (s::encode_frame(hello, encoded.data(), encoded.size(), length) || length != 0)
      return 4;
    s::FrameDecoder parser;
    const std::uint8_t partial[] = {3, 1};
    std::size_t count = 0;
    parser.feed(partial, sizeof(partial), received, &count);
    if (parser.buffered_bytes() != 2)
      return 5;
    parser.reset();
    if (parser.buffered_bytes() != 0)
      return 6;
    std::cout << "ok sizeof(Message)=" << sizeof(s::Message)
              << " sizeof(FrameDecoder)=" << sizeof(parser) << '\n';
    return 0;
  }
  // Host test harness only: input/output allocation here is not used by the codec.
  const std::size_t chunk = argc == 2 ? std::stoul(argv[1]) : 1;
  if (chunk == 0)
    return 1;
  std::string line;
  while (std::getline(std::cin, line)) {
    if (line.size() % 2 || line.size() > 200000)
      return 2;
    std::vector<std::uint8_t> bytes;
    for (std::size_t i = 0; i < line.size(); i += 2) {
      const int high = nibble(line[i]), low = nibble(line[i + 1]);
      if (high < 0 || low < 0)
        return 3;
      bytes.push_back(static_cast<std::uint8_t>((high << 4) | low));
    }
    s::FrameDecoder decoder;
    std::size_t count = 0;
    for (std::size_t cursor = 0; cursor < bytes.size();) {
      const auto size = std::min(chunk, bytes.size() - cursor);
      decoder.feed(bytes.data() + cursor, size, received, &count);
      if (decoder.buffered_bytes() > s::kMaxEncoded)
        return 4;
      cursor += size;
    }
    if (!count)
      std::cout << "ERR";
    std::cout << '\n';
  }
}
