#include "reaper/host_links.hpp"

namespace reaper::device {
namespace p = protocol;
void HostLinks::feed(HostLink link, const std::uint8_t* data, std::size_t size, std::uint64_t now) {
  now_ = now;
  current_ = link;
  auto& from = slot(link);
  from.last_read = now;
  from.decoder.feed(data, size, received, this);
}
void HostLinks::received(const p::Message& request, void* context) {
  auto& self = *static_cast<HostLinks*>(context);
  const auto link = self.current_;
  if (request.type == p::MessageType::Hello) {
    self.owner_ = link;
    self.owned_ = true;
  }
  self.session_.set_physical(link == HostLink::Usb);
  if (self.session_.handle(request, self.reply_)) {
    if (!self.write(self.reply_)) {
      self.release(link);
      return;
    }
    auto& from = self.slot(link);
    from.last_reply = self.now_;
    from.replied = true;
  }
  if (self.session_.take_error(self.reply_))
    self.write(self.reply_);
}
bool HostLinks::write(const p::Message& message) {
  std::size_t size = 0;
  return p::encode_frame(message, output_.data(), output_.size(), size) &&
         writer_(current_, output_.data(), size, context_);
}
void HostLinks::tick(std::uint64_t now) {
  for (const auto link : {HostLink::Usb, HostLink::Ble}) {
    auto& from = slot(link);
    const auto limit = link == HostLink::Usb ? kUsbStallMs : kBleStallMs;
    if (from.decoder.buffered_bytes() && now - from.last_read > limit) {
      from.decoder.reset();
      release(link);
    }
  }
}
void HostLinks::closed(HostLink link) {
  slot(link).decoder.reset();
  slot(link).replied = false;
  release(link);
}
void HostLinks::release(HostLink link) {
  if (!owns(link))
    return;
  owned_ = false;
  session_.reset();
}
bool HostLinks::ready(HostLink link, std::uint64_t now) const {
  const auto& from = slot(link);
  return owns(link) && session_.synchronized() && from.replied && now - from.last_reply < kActiveMs;
}
}  // namespace reaper::device
