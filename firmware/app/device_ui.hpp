#pragma once
#include <array>
#include <cstddef>
#include <cstdint>
// Board-independent device screen: button gestures, screen state and page drawing.
// No hardware access: boards supply the raw button level and send the finished frame.
namespace reaper::ui {
inline constexpr unsigned kWidth = 128, kHeight = 64;
// SSD1306 page order: byte (y / 8) * 128 + x holds 8 vertical pixels, least significant on top.
using Frame = std::array<std::uint8_t, kWidth * kHeight / 8>;

enum class Press { None, Single, Double, Long };
// Debounces a raw button level and reports single, double and long presses.
// A single press is reported once the double-press window has passed.
class ButtonGestures {
 public:
  static constexpr std::uint64_t kDebounceMs = 30, kDoubleMs = 300, kLongMs = 1000;
  Press sample(bool pressed, std::uint64_t now);

 private:
  bool raw_ = false, stable_ = false, long_sent_ = false;
  std::uint64_t raw_since_ = 0, down_at_ = 0, released_at_ = 0;
  unsigned clicks_ = 0;
};

enum class Page : std::uint8_t { Main, Nodes, Debug };
inline constexpr unsigned kPages = 3;
enum class Stage : std::uint8_t { Icon, Title, Running };
enum class Input { Toggle, NextPage, Home };

// Screen power, current page and the startup sequence. Times are milliseconds since boot.
class Screen {
 public:
  static constexpr std::uint64_t kIconMs = 1500, kTitleMs = 1000, kDefaultTimeoutMs = 30000;
  // A timeout of 0 keeps the screen on.
  explicit Screen(std::uint64_t timeout_ms = kDefaultTimeoutMs) : timeout_(timeout_ms) {}
  void start(std::uint64_t now);
  // Any input during startup skips to the main page. With the screen off, any input wakes it
  // on the main page. With it on: Toggle turns it off, NextPage cycles, Home returns to Main.
  void input(Input, std::uint64_t now);
  void tick(std::uint64_t now);
  // Device screen settings. With `wake`, a new message turns the screen on at the main page,
  // or restarts the timeout when it is already on.
  void settings(std::uint64_t timeout_ms, bool wake) {
    timeout_ = timeout_ms;
    wake_ = wake;
  }
  // Latest inbox sequence; messages that arrive after the screen last turned off count as new.
  void inbox(std::uint32_t latest, std::uint64_t now);
  bool on() const { return on_; }
  Stage stage() const { return stage_; }
  Page page() const { return page_; }
  std::uint32_t unread() const { return latest_ - seen_; }

 private:
  void wake(std::uint64_t now);
  void sleep();
  std::uint64_t timeout_, started_ = 0, active_ = 0;
  Stage stage_ = Stage::Icon;
  Page page_ = Page::Main;
  bool on_ = true, wake_ = false;
  std::uint32_t latest_ = 0, seen_ = 0;
};

struct NodeRow {
  const char* name = "";
  std::uint32_t age_s = 0;
  bool position = false;
};
// Values shown on the pages. Strings must stay valid while render() runs.
struct Status {
  const char* name = "";      // configured device label; the node ID is shown when empty
  const char* node = "";      // node ID
  const char* version = "";   // short firmware version, for example "v0.1.0"
  const char* radio = "OFF";  // RX, TX, OFF or FAULT
  std::uint32_t rx = 0, tx = 0, nodes = 0;
  std::uint32_t unread = 0;  // filled in by render() from the Screen
  int battery = -1;          // percent from a hardware measurement; negative when unknown
  bool external = false;     // plugged in (USB power present), shown with or without a battery
  std::array<NodeRow, 5> rows{};
  std::size_t row_count = 0;
  const char* usb = "";
  bool storage_ok = true;
  std::uint32_t revision = 0;
  const char* mode = "";
  int power_dbm = 0;
  std::uint32_t heap = 0, stack = 0;
  std::uint64_t uptime_s = 0;
};
void render(const Screen&, const Status&, Frame&);
}  // namespace reaper::ui
