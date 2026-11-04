#include "reaper/protocol.hpp"
#include <cstring>
#include <limits>

namespace reaper::protocol {
namespace {
const MessageDescriptor* descriptor(MessageType type) {
  for (const auto& item : kMessages)
    if (item.type == type)
      return &item;
  return nullptr;
}
std::uint32_t read32(const std::uint8_t* p) {
  return std::uint32_t(p[0]) | (std::uint32_t(p[1]) << 8) | (std::uint32_t(p[2]) << 16) |
         (std::uint32_t(p[3]) << 24);
}
void write32(std::uint8_t* p, std::uint32_t value) {
  for (unsigned i = 0; i < 4; ++i)
    p[i] = static_cast<std::uint8_t>(value >> (8 * i));
}
bool id_byte(std::uint8_t b) {
  return (b >= 'A' && b <= 'Z') || (b >= 'a' && b <= 'z') || (b >= '0' && b <= '9') || b == '_' ||
         b == '-';
}
bool identity(const std::uint8_t* p, std::size_t n) {
  if (n == 0 || n > 64)
    return false;
  for (std::size_t i = 0; i < n; ++i)
    if (!id_byte(p[i]))
      return false;
  return true;
}
bool equals(const FieldValue& value, const char* literal) {
  const auto size = std::strlen(literal);
  return size == value.length && std::memcmp(value.text.data(), literal, size) == 0;
}
bool utf8(const std::uint8_t* p, std::size_t size) {
  for (std::size_t i = 0; i < size;) {
    const auto first = p[i++];
    if (first < 0x80)
      continue;
    unsigned tail;
    std::uint32_t code;
    std::uint32_t minimum;
    if (first >= 0xc2 && first <= 0xdf) {
      tail = 1;
      code = first & 0x1f;
      minimum = 0x80;
    } else if (first >= 0xe0 && first <= 0xef) {
      tail = 2;
      code = first & 0x0f;
      minimum = 0x800;
    } else if (first >= 0xf0 && first <= 0xf4) {
      tail = 3;
      code = first & 7;
      minimum = 0x10000;
    } else
      return false;
    if (tail > size - i)
      return false;
    while (tail--) {
      const auto next = p[i++];
      if ((next & 0xc0) != 0x80)
        return false;
      code = (code << 6) | (next & 0x3f);
    }
    if (code < minimum || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
      return false;
  }
  return true;
}
bool valid(Kind kind, const FieldValue& value) {
  if (kind == Kind::U32)
    return true;
  if (value.length > kMaxText)
    return false;
  const auto* p = value.text.data();
  const auto size = value.length;
  if (kind == Kind::Id)
    return identity(p, size);
  if (kind == Kind::Version) {
    // Like an identity, plus '.' for semantic versions such as tbeam-reaper-mesh-v0.1.0.
    if (size == 0 || size > 64)
      return false;
    for (std::size_t i = 0; i < size; ++i)
      if (!id_byte(p[i]) && p[i] != '.')
        return false;
    return true;
  }
  if (kind == Kind::CommandId) {
    std::size_t split = 0;
    while (split < size && p[split] != ':')
      ++split;
    if (!identity(p, split) || split + 1 >= size || size - split - 1 > 10 || p[split + 1] == '0')
      return false;
    std::uint64_t number = 0;
    for (std::size_t i = split + 1; i < size; ++i) {
      if (p[i] < '0' || p[i] > '9')
        return false;
      number = number * 10 + (p[i] - '0');
    }
    return number > 0 && number <= std::numeric_limits<std::uint32_t>::max();
  }
  if (kind == Kind::RadioMode)
    return equals(value, "off") || equals(value, "receive") || equals(value, "mesh");
  if (kind == Kind::Channels) {
    if (size < 13 || size > 69 || std::memcmp(p, "Public", 6))
      return false;
    unsigned separators = 0, width = 0;
    for (std::size_t i = 6; i < size; ++i) {
      if (p[i] == '|') {
        ++separators;
        width = 0;
      } else if (!separators || !id_byte(p[i]) || ++width > 8)
        return false;
    }
    return separators == 7;
  }
  if (kind == Kind::ChannelIds) {
    // Eight 8-digit lowercase hex IDs separated by '|'; meaning is checked by the device.
    if (size != 71)
      return false;
    for (std::size_t i = 0; i < size; ++i)
      if (i % 9 == 8 ? p[i] != '|'
                     : !((p[i] >= '0' && p[i] <= '9') || (p[i] >= 'a' && p[i] <= 'f')))
        return false;
    return true;
  }
  if (kind == Kind::Hex) {
    if (!size || size > 64 || size % 2)
      return false;
    for (std::size_t i = 0; i < size; ++i)
      if (!((p[i] >= '0' && p[i] <= '9') || (p[i] >= 'a' && p[i] <= 'f')))
        return false;
    return true;
  }
  if (kind == Kind::MessageState)
    return equals(value, "receiving") || equals(value, "queued") || equals(value, "transmitted") ||
           equals(value, "acknowledged") || equals(value, "failed") || equals(value, "rejected") ||
           equals(value, "unknown");
  if (kind == Kind::Region)
    return equals(value, "UNSET") || equals(value, "US") || equals(value, "EU");
  if (kind == Kind::Outcome)
    return equals(value, "committed") || equals(value, "conflict") || equals(value, "rejected") ||
           equals(value, "unknown");
  if (kind == Kind::Label) {
    if (size > 64 || !utf8(p, size))
      return false;
    for (std::size_t i = 0; i < size; ++i)
      if (p[i] < 0x20 || p[i] == 0x7f)
        return false;
    return true;
  }
  return false;
}
bool versions(const Message& message) {
  if (message.type == MessageType::Hello)
    return message.fields[kHelloMinVersion].number <= message.fields[kHelloMaxVersion].number;
  if (message.type == MessageType::Welcome)
    return message.fields[kWelcomeMinVersion].number <= message.fields[kWelcomeMaxVersion].number;
  return true;
}
}  // namespace

bool valid_message_text(const std::uint8_t* p, std::size_t size) {
  if (!p || !size || size > 1024 || !utf8(p, size))
    return false;
  for (std::size_t i = 0; i < size; ++i)
    if ((p[i] < 32 && p[i] != 9 && p[i] != 10) || p[i] == 127)
      return false;
  return true;
}

bool decode_payload(const std::uint8_t* data, std::size_t size, Message& output) {
  if (!data || size < 2 || size > kMaxPayload || data[0] != 1)
    return false;
  Message next{};
  next.type = static_cast<MessageType>(data[1]);
  const auto* desc = descriptor(next.type);
  if (!desc)
    return false;
  std::array<bool, 256> seen{};
  for (std::size_t cursor = 2; cursor < size;) {
    if (size - cursor < 3)
      return false;
    const auto tag = data[cursor];
    const std::size_t length = data[cursor + 1] | (std::size_t(data[cursor + 2]) << 8);
    cursor += 3;
    if (!tag || seen[tag] || length > size - cursor)
      return false;
    seen[tag] = true;
    if (tag <= desc->count) {
      auto& value = next.fields[tag - 1];
      const auto kind = desc->fields[tag - 1].kind;
      value.present = true;
      if (kind == Kind::U32) {
        if (length != 4)
          return false;
        value.number = read32(data + cursor);
      } else {
        if (length > kMaxText)
          return false;
        value.length = length;
        std::memcpy(value.text.data(), data + cursor, length);
      }
      if (!valid(kind, value))
        return false;
    }
    cursor += length;
  }
  for (std::size_t i = 0; i < desc->count; ++i)
    if (!next.fields[i].present && !desc->fields[i].optional)
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
  for (std::size_t i = 0; i < desc->count; ++i) {
    const auto& value = message.fields[i];
    const auto kind = desc->fields[i].kind;
    if (!value.present) {
      if (desc->fields[i].optional)
        continue;
      return false;
    }
    if (!valid(kind, value))
      return false;
    const auto size = kind == Kind::U32 ? 4 : value.length;
    if (size + 3 > capacity - cursor || size + 3 > kMaxPayload - cursor)
      return false;
    output[cursor++] = static_cast<std::uint8_t>(i + 1);
    output[cursor++] = static_cast<std::uint8_t>(size);
    output[cursor++] = static_cast<std::uint8_t>(size >> 8);
    if (kind == Kind::U32)
      write32(output + cursor, value.number);
    else
      std::memcpy(output + cursor, value.text.data(), size);
    cursor += size;
  }
  length = cursor;
  return true;
}

std::uint32_t crc32(const std::uint8_t* data, std::size_t size) {
  std::uint32_t crc = 0xffffffff;
  for (std::size_t i = 0; i < size; ++i) {
    crc ^= data[i];
    for (unsigned bit = 0; bit < 8; ++bit)
      crc = (crc >> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return crc ^ 0xffffffff;
}

bool decode_frame(const std::uint8_t* encoded, std::size_t size, Message& output) {
  if (!encoded || size == 0 || size > kMaxEncoded)
    return false;
  std::array<std::uint8_t, kMaxRaw> raw{};
  std::size_t cursor = 0, count = 0;
  while (cursor < size) {
    const auto code = encoded[cursor++];
    if (!code || std::size_t(code - 1) > size - cursor)
      return false;
    for (unsigned i = 1; i < code; ++i) {
      if (!encoded[cursor] || count >= raw.size())
        return false;
      raw[count++] = encoded[cursor++];
    }
    if (code < 255 && cursor < size) {
      if (count >= raw.size())
        return false;
      raw[count++] = 0;
    }
  }
  if (count < 11 || raw[0] != 0x52 || raw[1] != 0x4d || raw[2] != 1 || raw[3] != 0)
    return false;
  const std::size_t payload = raw[4] | (std::size_t(raw[5]) << 8);
  if (payload == 0 || payload > kMaxPayload || count != payload + 10 ||
      read32(raw.data() + count - 4) != crc32(raw.data(), count - 4))
    return false;
  return decode_payload(raw.data() + 6, payload, output);
}

bool encode_frame(const Message& message, std::uint8_t* output, std::size_t capacity,
                  std::size_t& length) {
  length = 0;
  if (!output || capacity < kMaxEncoded + 1)
    return false;
  std::array<std::uint8_t, kMaxRaw> raw{};
  std::size_t payload = 0;
  if (!encode_payload(message, raw.data() + 6, kMaxPayload, payload))
    return false;
  raw[0] = 0x52;
  raw[1] = 0x4d;
  raw[2] = 1;
  raw[4] = static_cast<std::uint8_t>(payload);
  raw[5] = static_cast<std::uint8_t>(payload >> 8);
  const auto raw_size = payload + 10;
  write32(raw.data() + raw_size - 4, crc32(raw.data(), raw_size - 4));
  std::size_t code_index = 0, cursor = 1;
  std::uint8_t code = 1;
  for (std::size_t i = 0; i < raw_size; ++i) {
    if (raw[i] == 0) {
      output[code_index] = code;
      code_index = cursor++;
      code = 1;
    } else {
      output[cursor++] = raw[i];
      if (++code == 255) {
        output[code_index] = code;
        code_index = cursor++;
        code = 1;
      }
    }
  }
  output[code_index] = code;
  output[cursor++] = 0;
  length = cursor;
  return true;
}

FrameDecoder::Counts FrameDecoder::feed(const std::uint8_t* data, std::size_t size, Handler handler,
                                        void* context) {
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
      Message message{};
      const bool accepted = decode_frame(buffer_.data(), length_, message);
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
}  // namespace reaper::protocol
