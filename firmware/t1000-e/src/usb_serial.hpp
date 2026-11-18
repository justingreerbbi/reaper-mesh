#pragma once
#include <cstddef>
#include <cstdint>
// The USB CDC ACM port the agent talks to. Received bytes and bytes to send pass through ring
// buffers filled and drained in the USB interrupt; read() and write() run on the main thread.
class UsbSerial {
 public:
  bool begin();
  std::size_t read(std::uint8_t* out, std::size_t capacity);
  // Queues a whole frame, waiting at most 500 ms for space. False means it was not sent.
  bool write(const std::uint8_t* data, std::size_t size);
  // True once after the host closed the port or input overflowed, so the session resets.
  bool take_closed();
  // The 1200-baud touch: a host that opens the port at 1200 baud and closes it asks for the UF2
  // bootloader, so firmware can be updated without pressing the button.
  bool bootloader_requested();
};
