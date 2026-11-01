#pragma once
#include "reaper/schema.generated.hpp"
#include <array>

namespace reaper::protocol {
inline constexpr std::size_t kMaxPayload = 2048;
inline constexpr std::size_t kMaxRaw = kMaxPayload + 10;
inline constexpr std::size_t kMaxEncoded = kMaxRaw + kMaxRaw / 254 + 1;
inline constexpr std::size_t kMaxText = 75;

struct FieldValue {
  bool present = false;
  std::uint32_t number = 0;
  std::array<std::uint8_t, kMaxText> text{};
  std::size_t length = 0;
};
struct Message {
  MessageType type{};
  std::array<FieldValue, kMaxFields> fields{};
};

// Decode commits output only on success. Failed encoding sets length to zero;
// the caller must never transmit a failed encoding's partially filled buffer.
bool decode_payload(const std::uint8_t* data, std::size_t size, Message& output);
bool encode_payload(const Message& message, std::uint8_t* output, std::size_t capacity, std::size_t& length);
bool decode_frame(const std::uint8_t* encoded, std::size_t size, Message& output);
bool encode_frame(const Message& message, std::uint8_t* output, std::size_t capacity, std::size_t& length);
std::uint32_t crc32(const std::uint8_t* data, std::size_t size);

class FrameDecoder {
 public:
  using Handler = void (*)(const Message&, void*);
  struct Counts { std::size_t accepted = 0; std::size_t rejected = 0; };
  Counts feed(const std::uint8_t* data, std::size_t size, Handler handler, void* context);
  void reset() { length_ = 0; discarding_ = false; }
  std::size_t buffered_bytes() const { return length_; }
 private:
  std::array<std::uint8_t, kMaxEncoded> buffer_{};
  std::size_t length_ = 0;
  bool discarding_ = false;
};
} // namespace reaper::protocol
