#pragma once
#include "reaper/schema.generated.hpp"
#include <array>

namespace reaper::protocol {
inline constexpr std::size_t kMaxPayload = 2048;
inline constexpr std::size_t kMaxRaw = kMaxPayload + 10;
inline constexpr std::size_t kMaxEncoded = kMaxRaw + kMaxRaw / 254 + 1;
inline constexpr std::size_t kMaxText = 75;
// Largest value of the bytes kind; it must fit FieldValue's text storage.
inline constexpr std::size_t kMaxBytes = 64;
static_assert(kMaxBytes <= kMaxText);
// Second envelope magic byte: 'M' (RM) for the node protocol, 'S' (RS) for the sensor protocol.
inline constexpr std::uint8_t kNodeMagic = 0x4d;
inline constexpr std::uint8_t kSensorMagic = 0x53;

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
bool encode_payload(const Message& message, std::uint8_t* output, std::size_t capacity,
                    std::size_t& length);
bool decode_frame(const std::uint8_t* encoded, std::size_t size, Message& output);
bool encode_frame(const Message& message, std::uint8_t* output, std::size_t capacity,
                  std::size_t& length);
bool valid_message_text(const std::uint8_t*, std::size_t);
std::uint32_t crc32(const std::uint8_t* data, std::size_t size);

// Pieces shared by every schema's codec. Each schema wraps these with its own descriptors.
namespace codec {
bool valid_field(Kind kind, const FieldValue& value);
// Decodes the TLV fields that follow a payload's two header bytes. Unknown tags are skipped by
// length; duplicate tags, tag zero, overruns and missing required fields fail.
bool decode_fields(const std::uint8_t* data, std::size_t size, const FieldDescriptor* descriptors,
                   std::size_t count, FieldValue* fields);
// Appends fields at cursor, staying within capacity and max_payload.
bool encode_fields(const FieldValue* fields, const FieldDescriptor* descriptors, std::size_t count,
                   std::uint8_t* output, std::size_t capacity, std::size_t max_payload,
                   std::size_t& cursor);
// COBS-decodes one frame and checks magic, envelope version, flags, length and CRC. The payload
// starts at raw[6].
bool open_envelope(std::uint8_t magic, std::size_t max_payload, const std::uint8_t* encoded,
                   std::size_t size, std::array<std::uint8_t, kMaxRaw>& raw, std::size_t& payload);
// raw holds the payload at offset 6. Writes the header and CRC, then the COBS frame and its
// delimiter. Fails with length zero if output cannot hold it.
bool seal_envelope(std::uint8_t magic, std::array<std::uint8_t, kMaxRaw>& raw, std::size_t payload,
                   std::uint8_t* output, std::size_t capacity, std::size_t& length);
}  // namespace codec

// Fixed receive buffer of Capacity encoded bytes. Oversized input is discarded until the next
// delimiter.
template <class M, bool (*Decode)(const std::uint8_t*, std::size_t, M&), std::size_t Capacity>
class BasicFrameDecoder {
 public:
  using Handler = void (*)(const M&, void*);
  struct Counts {
    std::size_t accepted = 0;
    std::size_t rejected = 0;
  };
  Counts feed(const std::uint8_t* data, std::size_t size, Handler handler, void* context) {
    Counts counts{};
    if (!data || !handler)
      return counts;
    for (std::size_t i = 0; i < size; ++i) {
      if (data[i] == 0) {
        if (discarding_) {
          reset();
          continue;
        }
        if (!length_)
          continue;
        M message{};
        const bool accepted = Decode(buffer_.data(), length_, message);
        length_ = 0;
        if (accepted) {
          ++counts.accepted;
          handler(message, context);
        } else
          ++counts.rejected;
      } else if (!discarding_) {
        if (length_ == buffer_.size()) {
          length_ = 0;
          discarding_ = true;
          ++counts.rejected;
        } else
          buffer_[length_++] = data[i];
      }
    }
    return counts;
  }
  void reset() {
    length_ = 0;
    discarding_ = false;
  }
  std::size_t buffered_bytes() const { return length_; }

 private:
  std::array<std::uint8_t, Capacity> buffer_{};
  std::size_t length_ = 0;
  bool discarding_ = false;
};
using FrameDecoder = BasicFrameDecoder<Message, decode_frame, kMaxEncoded>;
}  // namespace reaper::protocol
