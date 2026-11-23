#pragma once
// Sensor protocol v1: the signals add-on's link to an app (D60). It shares the node codec, with
// the RS envelope magic, its own schema and a smaller payload limit. See
// docs/reference/sensor-protocol.md.
#include "reaper/protocol.hpp"
#include "reaper/sensor_schema.generated.hpp"

namespace reaper::sensor {
inline constexpr std::size_t kMaxPayload = 512;
inline constexpr std::size_t kMaxRaw = kMaxPayload + 10;
inline constexpr std::size_t kMaxEncoded = kMaxRaw + kMaxRaw / 254 + 1;

struct Message {
  MessageType type{};
  std::array<protocol::FieldValue, kMaxFields> fields{};
};

// Same contract as the node codec: decode commits output only on success, and a failed encode
// sets length to zero. encode_frame needs at least kMaxEncoded + 1 bytes of output.
bool decode_payload(const std::uint8_t* data, std::size_t size, Message& output);
bool encode_payload(const Message& message, std::uint8_t* output, std::size_t capacity,
                    std::size_t& length);
bool decode_frame(const std::uint8_t* encoded, std::size_t size, Message& output);
bool encode_frame(const Message& message, std::uint8_t* output, std::size_t capacity,
                  std::size_t& length);

using FrameDecoder = protocol::BasicFrameDecoder<Message, decode_frame, kMaxEncoded>;
}  // namespace reaper::sensor
