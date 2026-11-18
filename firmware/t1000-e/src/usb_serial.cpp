#include "usb_serial.hpp"
#include <zephyr/drivers/uart.h>
#include <zephyr/kernel.h>
#include <zephyr/sys/ring_buffer.h>
#include <atomic>
// The ring buffers have one producer and one consumer each (the interrupt and the main thread),
// which they support without locks; only a reset from the main thread takes the lock.
namespace {
const device* const port = DEVICE_DT_GET(DT_NODELABEL(cdc_acm_uart));
RING_BUF_DECLARE(input, 4096);
RING_BUF_DECLARE(output, 8192);
std::atomic<bool> overflow{false};
bool dtr = false;

void on_irq(const device* dev, void*) {
  uart_irq_update(dev);
  while (uart_irq_is_pending(dev) > 0) {
    if (uart_irq_rx_ready(dev) > 0) {
      std::uint8_t bytes[64];
      const int size = uart_fifo_read(dev, bytes, sizeof(bytes));
      if (size > 0 && ring_buf_put(&input, bytes, static_cast<std::uint32_t>(size)) !=
                          static_cast<std::uint32_t>(size))
        overflow = true;
    }
    if (uart_irq_tx_ready(dev) > 0) {
      std::uint8_t* bytes = nullptr;
      const auto size = ring_buf_get_ptr(&output, &bytes, 0);
      if (!size) {
        uart_irq_tx_disable(dev);
        break;
      }
      const int sent = uart_fifo_fill(dev, bytes, static_cast<int>(size < 64 ? size : 64));
      if (sent > 0)
        ring_buf_consume(&output, static_cast<std::size_t>(sent));
    }
    uart_irq_update(dev);
  }
}
}  // namespace

bool UsbSerial::begin() {
  if (!device_is_ready(port) || uart_irq_callback_set(port, on_irq) != 0)
    return false;
  uart_irq_rx_enable(port);
  return true;
}
std::size_t UsbSerial::read(std::uint8_t* out, std::size_t capacity) {
  return ring_buf_get(&input, out, static_cast<std::uint32_t>(capacity));
}
bool UsbSerial::write(const std::uint8_t* data, std::size_t size) {
  if (size > ring_buf_capacity_get(&output))
    return false;
  const auto deadline = k_uptime_get() + 500;
  for (;;) {
    if (ring_buf_space_get(&output) >= size) {
      ring_buf_put(&output, data, static_cast<std::uint32_t>(size));
      uart_irq_tx_enable(port);
      return true;
    }
    uart_irq_tx_enable(port);
    if (k_uptime_get() >= deadline)
      return false;
    k_msleep(1);
  }
}
bool UsbSerial::take_closed() {
  std::uint32_t line = 0;
  const bool now = uart_line_ctrl_get(port, UART_LINE_CTRL_DTR, &line) == 0 && line;
  const bool closed = dtr && !now;
  dtr = now;
  if (closed || overflow.exchange(false)) {
    const unsigned key = irq_lock();
    ring_buf_reset(&input);
    irq_unlock(key);
    return true;
  }
  return false;
}
bool UsbSerial::bootloader_requested() {
  std::uint32_t baud = 0, line = 0;
  return uart_line_ctrl_get(port, UART_LINE_CTRL_BAUD_RATE, &baud) == 0 && baud == 1200 &&
         uart_line_ctrl_get(port, UART_LINE_CTRL_DTR, &line) == 0 && !line;
}
