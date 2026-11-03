#include "device_ui.hpp"
#include <cstdio>
#include <cstring>
namespace reaper::ui {
namespace {
// Original 5x7 font for printable ASCII (0x20-0x7e). Each byte is one row, bit 4 = leftmost.
constexpr std::uint8_t kFont[95][7] = {
    {0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00},  // space
    {0x04, 0x04, 0x04, 0x04, 0x04, 0x00, 0x04},  // !
    {0x0a, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00},  // "
    {0x0a, 0x0a, 0x1f, 0x0a, 0x1f, 0x0a, 0x0a},  // #
    {0x04, 0x0f, 0x14, 0x0e, 0x05, 0x1e, 0x04},  // $
    {0x18, 0x19, 0x02, 0x04, 0x08, 0x13, 0x03},  // %
    {0x0c, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0d},  // &
    {0x04, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00},  // '
    {0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02},  // (
    {0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08},  // )
    {0x00, 0x04, 0x15, 0x0e, 0x15, 0x04, 0x00},  // *
    {0x00, 0x04, 0x04, 0x1f, 0x04, 0x04, 0x00},  // +
    {0x00, 0x00, 0x00, 0x00, 0x0c, 0x04, 0x08},  // ,
    {0x00, 0x00, 0x00, 0x1f, 0x00, 0x00, 0x00},  // -
    {0x00, 0x00, 0x00, 0x00, 0x00, 0x0c, 0x0c},  // .
    {0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x00},  // /
    {0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e},  // 0
    {0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e},  // 1
    {0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f},  // 2
    {0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e},  // 3
    {0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02},  // 4
    {0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e},  // 5
    {0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e},  // 6
    {0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08},  // 7
    {0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e},  // 8
    {0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c},  // 9
    {0x00, 0x0c, 0x0c, 0x00, 0x0c, 0x0c, 0x00},  // :
    {0x00, 0x0c, 0x0c, 0x00, 0x0c, 0x04, 0x08},  // ;
    {0x02, 0x04, 0x08, 0x10, 0x08, 0x04, 0x02},  // <
    {0x00, 0x00, 0x1f, 0x00, 0x1f, 0x00, 0x00},  // =
    {0x08, 0x04, 0x02, 0x01, 0x02, 0x04, 0x08},  // >
    {0x0e, 0x11, 0x01, 0x02, 0x04, 0x00, 0x04},  // ?
    {0x0e, 0x11, 0x01, 0x0d, 0x15, 0x15, 0x0e},  // @
    {0x0e, 0x11, 0x11, 0x11, 0x1f, 0x11, 0x11},  // A
    {0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e},  // B
    {0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e},  // C
    {0x1c, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1c},  // D
    {0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f},  // E
    {0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10},  // F
    {0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f},  // G
    {0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11},  // H
    {0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e},  // I
    {0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c},  // J
    {0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11},  // K
    {0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f},  // L
    {0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11},  // M
    {0x11, 0x11, 0x19, 0x15, 0x13, 0x11, 0x11},  // N
    {0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e},  // O
    {0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10},  // P
    {0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d},  // Q
    {0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11},  // R
    {0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e},  // S
    {0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04},  // T
    {0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e},  // U
    {0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04},  // V
    {0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0a},  // W
    {0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11},  // X
    {0x11, 0x11, 0x11, 0x0a, 0x04, 0x04, 0x04},  // Y
    {0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f},  // Z
    {0x0e, 0x08, 0x08, 0x08, 0x08, 0x08, 0x0e},  // [
    {0x00, 0x10, 0x08, 0x04, 0x02, 0x01, 0x00},  // backslash
    {0x0e, 0x02, 0x02, 0x02, 0x02, 0x02, 0x0e},  // ]
    {0x04, 0x0a, 0x11, 0x00, 0x00, 0x00, 0x00},  // ^
    {0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1f},  // _
    {0x08, 0x04, 0x02, 0x00, 0x00, 0x00, 0x00},  // `
    {0x00, 0x00, 0x0e, 0x01, 0x0f, 0x11, 0x0f},  // a
    {0x10, 0x10, 0x16, 0x19, 0x11, 0x11, 0x1e},  // b
    {0x00, 0x00, 0x0e, 0x10, 0x10, 0x11, 0x0e},  // c
    {0x01, 0x01, 0x0d, 0x13, 0x11, 0x11, 0x0f},  // d
    {0x00, 0x00, 0x0e, 0x11, 0x1f, 0x10, 0x0e},  // e
    {0x06, 0x09, 0x08, 0x1c, 0x08, 0x08, 0x08},  // f
    {0x00, 0x0f, 0x11, 0x11, 0x0f, 0x01, 0x0e},  // g
    {0x10, 0x10, 0x16, 0x19, 0x11, 0x11, 0x11},  // h
    {0x04, 0x00, 0x0c, 0x04, 0x04, 0x04, 0x0e},  // i
    {0x02, 0x00, 0x06, 0x02, 0x02, 0x12, 0x0c},  // j
    {0x10, 0x10, 0x12, 0x14, 0x18, 0x14, 0x12},  // k
    {0x0c, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e},  // l
    {0x00, 0x00, 0x1a, 0x15, 0x15, 0x11, 0x11},  // m
    {0x00, 0x00, 0x16, 0x19, 0x11, 0x11, 0x11},  // n
    {0x00, 0x00, 0x0e, 0x11, 0x11, 0x11, 0x0e},  // o
    {0x00, 0x00, 0x1e, 0x11, 0x1e, 0x10, 0x10},  // p
    {0x00, 0x00, 0x0d, 0x13, 0x0f, 0x01, 0x01},  // q
    {0x00, 0x00, 0x16, 0x19, 0x10, 0x10, 0x10},  // r
    {0x00, 0x00, 0x0e, 0x10, 0x0e, 0x01, 0x1e},  // s
    {0x08, 0x08, 0x1c, 0x08, 0x08, 0x09, 0x06},  // t
    {0x00, 0x00, 0x11, 0x11, 0x11, 0x13, 0x0d},  // u
    {0x00, 0x00, 0x11, 0x11, 0x11, 0x0a, 0x04},  // v
    {0x00, 0x00, 0x11, 0x11, 0x15, 0x15, 0x0a},  // w
    {0x00, 0x00, 0x11, 0x0a, 0x04, 0x0a, 0x11},  // x
    {0x00, 0x00, 0x11, 0x11, 0x0f, 0x01, 0x0e},  // y
    {0x00, 0x00, 0x1f, 0x02, 0x04, 0x08, 0x1f},  // z
    {0x02, 0x04, 0x04, 0x08, 0x04, 0x04, 0x02},  // {
    {0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04},  // |
    {0x08, 0x04, 0x04, 0x02, 0x04, 0x04, 0x08},  // }
    {0x00, 0x00, 0x08, 0x15, 0x02, 0x00, 0x00},  // ~
};
// Original 32x32 Reaper mark: a hooded figure. Replace these rows to change the startup icon.
constexpr const char* kIcon[32] = {
    "................................", "..........############..........",
    "........################........", ".......##################.......",
    "......####################......", ".....######################.....",
    "....######............######....", "....#####..............#####....",
    "...#####................#####...", "...####..................####...",
    "..#####..................#####..", "..####....##........##....####..",
    "..####...####......####...####..", "..####....##........##....####..",
    "..####....................####..", "..#####..................#####..",
    "..#####..................#####..", ".######..................######.",
    ".#######......####......#######.", ".########..............########.",
    ".#########............#########.", "##########............##########",
    "###########..........###########", "############........############",
    "#############......#############", "##############....##############",
    "################################", "################################",
    "################################", ".##############################.",
    "..############################..", "................................",
};
constexpr unsigned kCell = 6;  // 5-pixel glyph plus one column of spacing

void pixel(Frame& f, unsigned x, unsigned y) {
  if (x < kWidth && y < kHeight)
    f[(y / 8) * kWidth + x] |= static_cast<std::uint8_t>(1u << (y % 8));
}
// Number of characters that render() will draw for a UTF-8 string (one per code point).
unsigned glyphs(const char* s) {
  unsigned n = 0;
  for (; *s; ++s)
    if ((static_cast<unsigned char>(*s) & 0xc0) != 0x80)
      ++n;
  return n;
}
// Draws up to `limit` characters; non-ASCII code points show as '?'. Returns the width drawn.
unsigned text(Frame& f, unsigned x, unsigned y, const char* s, unsigned scale = 1,
              unsigned limit = 21) {
  unsigned drawn = 0;
  for (; *s && drawn < limit; ++s) {
    auto c = static_cast<unsigned char>(*s);
    if ((c & 0xc0) == 0x80)
      continue;
    if (c < 0x20 || c > 0x7e)
      c = '?';
    const auto* rows = kFont[c - 0x20];
    for (unsigned row = 0; row < 7; ++row)
      for (unsigned col = 0; col < 5; ++col)
        if (rows[row] & (0x10u >> col))
          for (unsigned dy = 0; dy < scale; ++dy)
            for (unsigned dx = 0; dx < scale; ++dx)
              pixel(f, x + (drawn * kCell + col) * scale + dx, y + row * scale + dy);
    ++drawn;
  }
  return drawn * kCell * scale;
}
void right(Frame& f, unsigned right_edge, unsigned y, const char* s, unsigned scale = 1) {
  const unsigned width = glyphs(s) * kCell * scale;
  text(f, width > right_edge ? 0 : right_edge - width + scale, y, s, scale);
}
void centered(Frame& f, unsigned y, const char* s, unsigned scale = 1) {
  const unsigned width = glyphs(s) * kCell * scale;
  text(f, width > kWidth ? 0 : (kWidth - width + scale) / 2, y, s, scale);
}
void line(Frame& f, unsigned y) {
  for (unsigned x = 0; x < kWidth; ++x)
    pixel(f, x, y);
}
void age(char* out, std::size_t size, std::uint64_t seconds) {
  if (seconds < 60)
    std::snprintf(out, size, "%us", static_cast<unsigned>(seconds));
  else if (seconds < 3600)
    std::snprintf(out, size, "%um", static_cast<unsigned>(seconds / 60));
  else if (seconds < 86400)
    std::snprintf(out, size, "%uh", static_cast<unsigned>(seconds / 3600));
  else
    std::snprintf(out, size, "%ud", static_cast<unsigned>(seconds / 86400));
}
void header(Frame& f, const char* title, Page page) {
  text(f, 0, 0, title);
  char number[8];
  std::snprintf(number, sizeof(number), "%u/%u", static_cast<unsigned>(page) + 1, kPages);
  right(f, kWidth - 1, 0, number);
  line(f, 9);
}
// 5x7 charge bolt, same row format as kFont.
constexpr std::uint8_t kBolt[7] = {0x02, 0x04, 0x08, 0x1f, 0x02, 0x04, 0x08};
// Top-right battery: optional charge bolt, percent and a gauge icon, on the same line as a
// 1x name and centered beside a 2x one. Returns its left edge.
unsigned battery(Frame& f, int percent, bool charging) {
  constexpr unsigned x0 = kWidth - 13, y0 = 4;  // 11x7 body plus a 2-pixel terminal
  for (unsigned x = x0; x < x0 + 11; ++x) {
    pixel(f, x, y0);
    pixel(f, x, y0 + 6);
  }
  for (unsigned y = 1; y < 6; ++y) {
    pixel(f, x0, y0 + y);
    pixel(f, x0 + 10, y0 + y);
  }
  for (unsigned y = 2; y < 5; ++y) {
    pixel(f, x0 + 11, y0 + y);
    pixel(f, x0 + 12, y0 + y);
  }
  const unsigned value = percent > 100 ? 100u : static_cast<unsigned>(percent);
  for (unsigned x = 0; x < (value * 7 + 50) / 100; ++x)
    for (unsigned y = 2; y < 5; ++y)
      pixel(f, x0 + 2 + x, y0 + y);
  char label[8];
  std::snprintf(label, sizeof(label), "%u%%", value);
  unsigned left = x0 - 1 - glyphs(label) * kCell;
  text(f, left, y0, label);
  if (charging) {
    left -= 7;
    for (unsigned row = 0; row < 7; ++row)
      for (unsigned col = 0; col < 5; ++col)
        if (kBolt[row] & (0x10u >> col))
          pixel(f, left + col, y0 + row);
  }
  return left;
}
void main_page(Frame& f, const Status& s) {
  const char* name = *s.name ? s.name : s.node;
  const unsigned room = s.battery >= 0 ? battery(f, s.battery, s.charging) : kWidth;
  if (glyphs(name) * kCell * 2 <= room)
    text(f, 0, 0, name, 2);
  else
    text(f, 0, 4, name, 1, (room - 1) / kCell);
  line(f, 18);
  text(f, 0, 27, "RADIO");
  text(f, 40, 23, s.radio, 2);
  char counts[24];
  std::snprintf(counts, sizeof(counts), "NEW %lu", static_cast<unsigned long>(s.unread));
  text(f, 0, 44, counts);
  std::snprintf(counts, sizeof(counts), "NODES %lu", static_cast<unsigned long>(s.nodes));
  right(f, kWidth - 1, 44, counts);
  right(f, kWidth - 1, 56, s.version);
}
void nodes_page(Frame& f, const Status& s) {
  char title[24];
  std::snprintf(title, sizeof(title), "NODES %lu", static_cast<unsigned long>(s.nodes));
  header(f, title, Page::Nodes);
  if (!s.row_count) {
    text(f, 0, 14, "No nodes heard yet");
    return;
  }
  for (std::size_t i = 0; i < s.row_count && i < s.rows.size(); ++i) {
    const auto& row = s.rows[i];
    const unsigned y = 13 + static_cast<unsigned>(i) * 10;
    const unsigned width = text(f, 0, y, row.name, 1, 14);
    if (row.position)
      text(f, width, y, " *");
    char when[8];
    age(when, sizeof(when), row.age_s);
    right(f, kWidth - 1, y, when);
  }
}
void debug_page(Frame& f, const Status& s) {
  header(f, "DEBUG", Page::Debug);
  char buffer[32];
  text(f, 0, 11, s.node);
  std::snprintf(buffer, sizeof(buffer), "%s REV %lu", s.usb,
                static_cast<unsigned long>(s.revision));
  text(f, 0, 20, buffer);
  std::snprintf(buffer, sizeof(buffer), "%s %s %udBm", s.storage_ok ? "NVS OK" : "NVS FAULT",
                s.mode, s.power_dbm);
  text(f, 0, 29, buffer);
  std::snprintf(buffer, sizeof(buffer), "RX %lu TX %lu", static_cast<unsigned long>(s.rx),
                static_cast<unsigned long>(s.tx));
  text(f, 0, 38, buffer);
  std::snprintf(buffer, sizeof(buffer), "HEAP %luK STACK %luK",
                static_cast<unsigned long>(s.heap / 1024),
                static_cast<unsigned long>(s.stack / 1024));
  text(f, 0, 47, buffer);
  const auto up = s.uptime_s;
  std::snprintf(buffer, sizeof(buffer), "UP %luh %02lum %02lus",
                static_cast<unsigned long>(up / 3600), static_cast<unsigned long>(up / 60 % 60),
                static_cast<unsigned long>(up % 60));
  text(f, 0, 56, buffer);
}
}  // namespace

Press ButtonGestures::sample(bool pressed, std::uint64_t now) {
  if (pressed != raw_) {
    raw_ = pressed;
    raw_since_ = now;
  }
  if (raw_ != stable_ && now - raw_since_ >= kDebounceMs) {
    stable_ = raw_;
    if (stable_) {
      down_at_ = now;
      long_sent_ = false;
    } else if (!long_sent_) {
      released_at_ = now;
      if (++clicks_ == 2) {
        clicks_ = 0;
        return Press::Double;
      }
    }
  }
  if (stable_ && !long_sent_ && now - down_at_ >= kLongMs) {
    long_sent_ = true;
    clicks_ = 0;
    return Press::Long;
  }
  if (!stable_ && clicks_ == 1 && now - released_at_ >= kDoubleMs) {
    clicks_ = 0;
    return Press::Single;
  }
  return Press::None;
}

void Screen::start(std::uint64_t now) {
  started_ = active_ = now;
  stage_ = Stage::Icon;
  page_ = Page::Main;
  on_ = true;
}
void Screen::wake(std::uint64_t now) {
  on_ = true;
  page_ = Page::Main;
  active_ = now;
}
void Screen::sleep() {
  on_ = false;
  seen_ = latest_;
}
void Screen::input(Input in, std::uint64_t now) {
  if (stage_ != Stage::Running) {
    stage_ = Stage::Running;
    wake(now);
    return;
  }
  if (!on_) {
    wake(now);
    return;
  }
  active_ = now;
  if (in == Input::Toggle)
    sleep();
  else if (in == Input::NextPage)
    page_ = static_cast<Page>((static_cast<unsigned>(page_) + 1) % kPages);
  else
    page_ = Page::Main;
}
void Screen::tick(std::uint64_t now) {
  if (stage_ == Stage::Icon && now - started_ >= kIconMs)
    stage_ = Stage::Title;
  if (stage_ == Stage::Title && now - started_ >= kIconMs + kTitleMs) {
    stage_ = Stage::Running;
    active_ = now;
  }
  if (stage_ == Stage::Running && on_ && timeout_ && now - active_ >= timeout_)
    sleep();
}
void Screen::inbox(std::uint32_t latest, std::uint64_t now) {
  if (latest < seen_)
    seen_ = latest;
  const bool arrived = latest > latest_;
  latest_ = latest;
  if (arrived && wake_ && stage_ == Stage::Running) {
    if (on_)
      active_ = now;
    else
      wake(now);
  }
}

void render(const Screen& screen, const Status& status, Frame& frame) {
  frame.fill(0);
  if (screen.stage() == Stage::Icon) {
    for (unsigned y = 0; y < 32; ++y)
      for (unsigned x = 0; x < 32; ++x)
        if (kIcon[y][x] == '#')
          pixel(frame, 48 + x, 16 + y);
    return;
  }
  if (screen.stage() == Stage::Title) {
    centered(frame, 10, "REAPER", 2);
    centered(frame, 30, "MESH", 2);
    centered(frame, 54, status.version);
    return;
  }
  Status shown = status;
  shown.unread = screen.unread();
  if (screen.page() == Page::Nodes)
    nodes_page(frame, shown);
  else if (screen.page() == Page::Debug)
    debug_page(frame, shown);
  else
    main_page(frame, shown);
}
}  // namespace reaper::ui
