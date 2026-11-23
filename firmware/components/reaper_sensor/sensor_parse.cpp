// Parsers for what the add-on hears. Every read is bounds-checked against the received length;
// a malformed frame is ignored rather than partly used.
#include "reaper/sensor_scan.hpp"

namespace reaper::sensor {
namespace {
std::uint16_t le16(const std::uint8_t* p) {
  return static_cast<std::uint16_t>(p[0] | (p[1] << 8));
}
std::int32_t le32(const std::uint8_t* p) {
  return static_cast<std::int32_t>(std::uint32_t(p[0]) | (std::uint32_t(p[1]) << 8) |
                                   (std::uint32_t(p[2]) << 16) | (std::uint32_t(p[3]) << 24));
}
void copy_address(const std::uint8_t* p, Address& out) {
  for (std::size_t i = 0; i < out.size(); ++i)
    out[i] = p[i];
}
// The ASTM F3411 payload follows a one-byte message counter.
void take_remote_id(const std::uint8_t* p, std::size_t size, RemoteIdPayload& out) {
  if (size < 2)
    return;
  out.data.assign(p + 1, size - 1);  // A longer payload is cut to the largest message pack.
  out.present = true;
}

// RSN AKM suites (00-0F-AC:n) to security bits.
std::uint32_t akm_security(std::uint8_t suite) {
  switch (suite) {
    case 1:
    case 3:
    case 5:
      return security::kWpa2 | security::kEnterprise;
    case 2:
    case 4:
    case 6:
      return security::kWpa2;
    case 8:
    case 9:
    case 24:
    case 25:
      return security::kWpa3;
    case 11:
    case 12:
    case 13:
      return security::kWpa3 | security::kEnterprise;
    case 18:
      return security::kOwe;
    default:
      return 0;
  }
}
std::uint32_t parse_rsn(const std::uint8_t* p, std::size_t size) {
  // Version (2), group cipher (4), pairwise count (2) and suites, AKM count (2) and suites.
  if (size < 8)
    return security::kWpa2;
  std::size_t cursor = 6;
  const std::size_t pairwise = le16(p + cursor);
  cursor += 2 + 4 * pairwise;
  if (cursor + 2 > size)
    return security::kWpa2;
  const std::size_t akms = le16(p + cursor);
  cursor += 2;
  std::uint32_t bits = 0;
  for (std::size_t i = 0; i < akms && cursor + 4 <= size; ++i, cursor += 4)
    if (p[cursor] == 0x00 && p[cursor + 1] == 0x0f && p[cursor + 2] == 0xac)
      bits |= akm_security(p[cursor + 3]);
  return bits ? bits : security::kWpa2;
}

// Information elements of a beacon, probe response or probe request.
void parse_elements(const std::uint8_t* p, std::size_t size, WifiFrame& out) {
  for (std::size_t i = 0; i + 2 <= size;) {
    const std::uint8_t id = p[i];
    const std::size_t length = p[i + 1];
    if (i + 2 + length > size)
      return;
    const std::uint8_t* body = p + i + 2;
    if (id == 0 && !out.ssid_present) {
      out.ssid_present = true;
      bool blank = true;
      for (std::size_t k = 0; k < length; ++k)
        blank = blank && body[k] == 0;
      out.hidden = blank;
      if (!blank)
        out.ssid.assign(body, length);
    } else if (id == 48) {
      out.security |= parse_rsn(body, length);
    } else if (id == 221 && length >= 4) {
      if (body[0] == 0x00 && body[1] == 0x50 && body[2] == 0xf2 && body[3] == 0x01)
        out.security |= security::kWpa;
      else if (body[0] == 0xfa && body[1] == 0x0b && body[2] == 0xbc && body[3] == 0x0d)
        take_remote_id(body + 4, length - 4, out.remote_id);
    }
    i += 2 + length;
  }
}

// The NAN service ID for Remote ID: the first six bytes of SHA-256("org.opendroneid.remoteid").
constexpr std::uint8_t kRemoteIdService[6] = {0x88, 0x69, 0x19, 0x9d, 0x92, 0x09};

void parse_nan(const std::uint8_t* p, std::size_t size, WifiFrame& out) {
  for (std::size_t i = 0; i + 3 <= size;) {
    const std::uint8_t id = p[i];
    const std::size_t length = le16(p + i + 1);
    if (i + 3 + length > size)
      return;
    const std::uint8_t* body = p + i + 3;
    // Service descriptor attribute: service ID (6), instance (1), requestor (1), control (1).
    if (id == 0x03 && length >= 9) {
      bool match = true;
      for (std::size_t k = 0; k < 6; ++k)
        match = match && body[k] == kRemoteIdService[k];
      const std::uint8_t control = body[8];
      std::size_t cursor = 9;
      if (match && (control & 0x40))  // Binding bitmap.
        cursor += 2;
      for (std::uint8_t bit : {std::uint8_t(0x04), std::uint8_t(0x08)})  // Filters.
        if (match && (control & bit)) {
          if (cursor >= length)
            return;
          cursor += 1 + body[cursor];
        }
      if (match && (control & 0x10) && cursor < length) {  // Service info.
        const std::size_t info = body[cursor];
        if (cursor + 1 + info <= length)
          take_remote_id(body + cursor + 1, info, out.remote_id);
      }
    }
    i += 3 + length;
  }
}

std::size_t trimmed(const std::uint8_t* p, std::size_t size) {
  std::size_t length = 0;
  while (length < size && p[length] != 0)
    ++length;
  while (length && p[length - 1] == ' ')
    --length;
  return length;
}

template <class T>
bool update(T& field, const T& value) {
  if (field == value)
    return false;
  field = value;
  return true;
}

bool apply_message(const std::uint8_t* m, Drone& drone) {
  const std::uint8_t type = m[0] >> 4;
  bool changed = false;
  if (type == 0) {  // Basic ID.
    const std::size_t length = trimmed(m + 2, 20);
    if (!length)
      return false;
    Bytes<20> id;
    id.assign(m + 2, length);
    changed |= update(drone.uas_id, id);
    changed |= update(drone.id_type, static_cast<std::uint8_t>(m[1] >> 4));
    changed |= update(drone.ua_type, static_cast<std::uint8_t>(m[1] & 15));
  } else if (type == 1) {  // Location.
    const std::uint8_t flags = m[1] & 15;
    // The course is sent as 0 to 179 plus an east-west bit; a larger value means unknown.
    const unsigned direction = m[2] + ((flags & 2) ? 180u : 0u);
    const bool heading = m[2] <= 179;
    changed |= update(drone.has_heading, heading);
    if (heading)
      changed |= update(drone.heading_cdeg, static_cast<std::uint32_t>(direction * 100));
    const bool speed = m[3] != 255;
    changed |= update(drone.has_speed, speed);
    if (speed)
      changed |= update(drone.speed_cms,
                        static_cast<std::uint32_t>((flags & 1) ? m[3] * 75u + 6375u : m[3] * 25u));
    const std::int32_t latitude = le32(m + 5), longitude = le32(m + 9);
    const bool position = (latitude || longitude) && latitude >= -900000000 &&
                          latitude <= 900000000 && longitude >= -1800000000 &&
                          longitude <= 1800000000;
    changed |= update(drone.has_position, position);
    if (position) {
      changed |= update(drone.latitude, latitude);
      changed |= update(drone.longitude, longitude);
    }
    // Altitudes are 0.5 m steps from -1000 m; zero means unknown. Reported in decimeters.
    const std::uint16_t altitude = le16(m + 15), height = le16(m + 17);
    changed |= update(drone.has_altitude, altitude != 0);
    if (altitude)
      changed |= update(drone.altitude_dm, static_cast<std::int32_t>(altitude) * 5 - 10000);
    changed |= update(drone.has_height, height != 0);
    if (height)
      changed |= update(drone.height_dm, static_cast<std::int32_t>(height) * 5 - 10000);
  } else if (type == 4) {  // System: the operator's position.
    const std::int32_t latitude = le32(m + 2), longitude = le32(m + 6);
    const bool known = (latitude || longitude) && latitude >= -900000000 && latitude <= 900000000 &&
                       longitude >= -1800000000 && longitude <= 1800000000;
    changed |= update(drone.has_operator, known);
    if (known) {
      changed |= update(drone.operator_latitude, latitude);
      changed |= update(drone.operator_longitude, longitude);
    }
  } else if (type == 5) {  // Operator ID.
    Bytes<20> id;
    id.assign(m + 2, trimmed(m + 2, 20));
    changed |= update(drone.operator_id, id);
  }
  return changed;
}
}  // namespace

bool valid_channel(std::uint8_t channel, Band& band) {
  for (auto c : kChannels24)
    if (c == channel) {
      band = Band::Ghz24;
      return true;
    }
  for (auto c : kChannels5)
    if (c == channel) {
      band = Band::Ghz5;
      return true;
    }
  return false;
}

bool parse_wifi(const std::uint8_t* frame, std::size_t length, WifiFrame& out) {
  out = WifiFrame{};
  if (!frame || length < 24 || ((frame[0] >> 2) & 3) != 0)
    return false;
  const std::uint8_t subtype = frame[0] >> 4;
  if (subtype == 8 || subtype == 5) {
    if (length < 36)
      return false;
    out.kind = subtype == 8 ? WifiFrame::Kind::Beacon : WifiFrame::Kind::ProbeResponse;
    copy_address(frame + 16, out.address);
    parse_elements(frame + 36, length - 36, out);
    if (!out.security && (frame[34] & 0x10))  // Privacy without RSN or WPA: WEP.
      out.security = security::kWep;
    return true;
  }
  if (subtype == 4) {
    out.kind = WifiFrame::Kind::ProbeRequest;
    copy_address(frame + 10, out.address);
    parse_elements(frame + 24, length - 24, out);
    return true;
  }
  // Public action, vendor specific, Wi-Fi Alliance OUI, NAN.
  if (subtype == 13 && length >= 30 && frame[24] == 4 && frame[25] == 9 && frame[26] == 0x50 &&
      frame[27] == 0x6f && frame[28] == 0x9a && frame[29] == 0x13) {
    out.kind = WifiFrame::Kind::Nan;
    copy_address(frame + 10, out.address);
    parse_nan(frame + 30, length - 30, out);
    return true;
  }
  return false;
}

bool parse_ble(const std::uint8_t* data, std::size_t length, BleAdvert& out) {
  out = BleAdvert{};
  if (!data)
    return false;
  for (std::size_t i = 0; i < length;) {
    const std::size_t size = data[i];
    if (!size)
      break;  // Padding.
    if (i + 1 + size > length)
      return false;
    const std::uint8_t type = data[i + 1];
    const std::uint8_t* body = data + i + 2;
    const std::size_t body_size = size - 1;
    if ((type == 0x09 || (type == 0x08 && !out.name.length)) && body_size)
      out.name.assign(body, body_size);
    else if (type == 0xff && body_size >= 2) {
      out.has_manufacturer = true;
      out.manufacturer = le16(body);
      if (out.manufacturer == 0x004c && body_size >= 3 && body[2] == 0x12)
        out.tracker = Tracker::AppleFindMy;
    } else if ((type == 0x02 || type == 0x03) && body_size % 2 == 0) {
      for (std::size_t k = 0; k + 1 < body_size && out.services.length + 2 <= 32; k += 2) {
        out.services.data[out.services.length++] = body[k];
        out.services.data[out.services.length++] = body[k + 1];
        const auto uuid = le16(body + k);
        if (uuid == 0xfeed || uuid == 0xfeec)
          out.tracker = Tracker::Tile;
      }
    } else if (type == 0x16 && body_size >= 2) {
      const auto uuid = le16(body);
      if (uuid == 0xfffa && body_size >= 3 && body[2] == 0x0d)
        take_remote_id(body + 3, body_size - 3, out.remote_id);
      else if (uuid == 0xfd5a)
        out.tracker = Tracker::Samsung;
      else if (uuid == 0xfeaa && body_size >= 3 && (body[2] == 0x40 || body[2] == 0x41))
        out.tracker = Tracker::GoogleFindHub;
      else if (uuid == 0xfeed || uuid == 0xfeec)
        out.tracker = Tracker::Tile;
    }
    i += 1 + size;
  }
  return true;
}

bool apply_remote_id(const std::uint8_t* data, std::size_t length, Drone& drone) {
  if (!data || length < 25)
    return false;
  if ((data[0] >> 4) == 0xf) {  // Message pack: size, count, then the messages.
    const std::size_t size = data[1], count = data[2];
    if (size != 25 || count > 9 || 3 + count * 25 > length)
      return false;
    bool changed = false;
    for (std::size_t i = 0; i < count; ++i)
      if ((data[3 + i * 25] >> 4) != 0xf)
        changed |= apply_message(data + 3 + i * 25, drone);
    return changed;
  }
  return apply_message(data, drone);
}
}  // namespace reaper::sensor
