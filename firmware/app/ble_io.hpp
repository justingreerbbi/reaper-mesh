#pragma once
#include <array>
#include <cstddef>
#include <cstdint>

namespace reaper::ble {
// Reject an entire ATT write before consuming any bytes when capacity is exhausted. A
// resource-error response lets the peer retry the same bytes without corrupting framing.
template <typename Space, typename Write>
bool accept(const std::uint8_t* data, std::size_t size, Space space, Write write) {
  return space() >= size && write(data, size) == size;
}

// A busy peer must not starve radio/display work or accumulate all replies before they
// can be notified. Each call consumes at most one receive-buffer's worth of bytes.
template <typename Read, typename Feed, typename Pump>
void drain(Read read, Feed feed, Pump pump, unsigned batches = 16) {
  std::array<std::uint8_t, 256> bytes;
  pump();
  for (unsigned batch = 0; batch < batches; ++batch) {
    const auto size = read(bytes.data(), bytes.size());
    if (!size)
      break;
    feed(bytes.data(), size);
    pump();
  }
}
}  // namespace reaper::ble
