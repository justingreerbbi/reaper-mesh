#include "reaper/sensor_protocol.hpp"

namespace reaper::sensor {
namespace {
const MessageDescriptor* descriptor(MessageType type) {
  for (const auto& item : kMessages)
    if (item.type == type)
      return &item;
  return nullptr;
}
bool versions(const Message& message) {
  if (message.type == MessageType::Hello)
    return message.fields[kHelloMinVersion].number <= message.fields[kHelloMaxVersion].number;
  if (message.type == MessageType::Welcome)
    return message.fields[kWelcomeMinVersion].number <= message.fields[kWelcomeMaxVersion].number;
  return true;
}
}  // namespace

bool decode_payload(const std::uint8_t* data, std::size_t size, Message& output) {
  if (!data || size < 2 || size > kMaxPayload || data[0] != 1)
    return false;
  Message next{};
  next.type = static_cast<MessageType>(data[1]);
  const auto* desc = descriptor(next.type);
  if (!desc || !protocol::codec::decode_fields(data + 2, size - 2, desc->fields, desc->count,
                                               next.fields.data()))
    return false;
  if (!versions(next))
    return false;
  output = next;
  return true;
}

bool encode_payload(const Message& message, std::uint8_t* output, std::size_t capacity,
                    std::size_t& length) {
  length = 0;
  const auto* desc = descriptor(message.type);
  if (!output || capacity < 2 || !desc || !versions(message))
    return false;
  std::size_t cursor = 2;
  output[0] = 1;
  output[1] = static_cast<std::uint8_t>(message.type);
  if (!protocol::codec::encode_fields(message.fields.data(), desc->fields, desc->count, output,
                                      capacity, kMaxPayload, cursor))
    return false;
  length = cursor;
  return true;
}

bool decode_frame(const std::uint8_t* encoded, std::size_t size, Message& output) {
  std::array<std::uint8_t, protocol::kMaxRaw> raw{};
  std::size_t payload = 0;
  return protocol::codec::open_envelope(protocol::kSensorMagic, kMaxPayload, encoded, size, raw,
                                        payload) &&
         decode_payload(raw.data() + 6, payload, output);
}

bool encode_frame(const Message& message, std::uint8_t* output, std::size_t capacity,
                  std::size_t& length) {
  length = 0;
  if (!output || capacity < kMaxEncoded + 1)
    return false;
  std::array<std::uint8_t, protocol::kMaxRaw> raw{};
  std::size_t payload = 0;
  if (!encode_payload(message, raw.data() + 6, kMaxPayload, payload))
    return false;
  return protocol::codec::seal_envelope(protocol::kSensorMagic, raw, payload, output, capacity,
                                        length);
}
}  // namespace reaper::sensor
