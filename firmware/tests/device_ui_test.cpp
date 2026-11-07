#include "device_ui.hpp"
#include <cstdlib>
#include <iostream>
#include <string>
using namespace reaper::ui;
#define CHECK(value)                                              \
  do {                                                            \
    if (!(value)) {                                               \
      std::cerr << "line " << __LINE__ << ": " << #value << '\n'; \
      std::exit(1);                                               \
    }                                                             \
  } while (false)

namespace {
// Feeds a level for `ms` milliseconds in 5 ms steps and returns the last non-empty press.
Press hold(ButtonGestures& g, bool pressed, std::uint64_t& now, std::uint64_t ms) {
  Press seen = Press::None;
  for (std::uint64_t end = now + ms; now < end; now += 5) {
    const auto p = g.sample(pressed, now);
    if (p != Press::None) {
      CHECK(seen == Press::None);  // at most one press per call in these scenarios
      seen = p;
    }
  }
  return seen;
}
bool lit(const Frame& f, unsigned x, unsigned y) {
  return f[(y / 8) * kWidth + x] & (1u << (y % 8));
}
unsigned count(const Frame& f) {
  unsigned n = 0;
  for (unsigned y = 0; y < kHeight; ++y)
    for (unsigned x = 0; x < kWidth; ++x)
      n += lit(f, x, y);
  return n;
}
void print(const Frame& f, const char* title) {
  std::cout << title << '\n';
  for (unsigned y = 0; y < kHeight; ++y) {
    for (unsigned x = 0; x < kWidth; ++x)
      std::cout << (lit(f, x, y) ? '#' : '.');
    std::cout << '\n';
  }
}
Status sample() {
  Status s;
  s.name = "Base Camp";
  s.node = "node-000008b61f9fe548";
  s.version = "v0.1.0";
  s.radio = "RX";
  s.rx = 12;
  s.tx = 3;
  s.nodes = 2;
  s.rows[0] = {"Heltec Ridge", 42, true};
  s.rows[1] = {"node-0000aabbccddeeff", 7300, false};
  s.row_count = 2;
  s.usb = "USB READY";
  s.revision = 38;
  s.mode = "MESH";
  s.power_dbm = 2;
  s.heap = 186396;
  s.stack = 16916;
  s.uptime_s = 3723;
  return s;
}
}  // namespace

int main(int argc, char** argv) {
  if (argc != 2)
    return 2;
  const std::string scenario = argv[1];
  if (scenario == "gestures") {
    ButtonGestures g;
    std::uint64_t now = 0;
    CHECK(hold(g, false, now, 100) == Press::None);
    // A 10 ms bounce is ignored.
    CHECK(hold(g, true, now, 10) == Press::None);
    CHECK(hold(g, false, now, 500) == Press::None);
    // Single press: reported after the double-press window.
    CHECK(hold(g, true, now, 100) == Press::None);
    CHECK(hold(g, false, now, 500) == Press::Single);
    // Double press.
    CHECK(hold(g, true, now, 80) == Press::None);
    CHECK(hold(g, false, now, 100) == Press::None);
    CHECK(hold(g, true, now, 80) == Press::None);
    CHECK(hold(g, false, now, 500) == Press::Double);
    // The Bluetooth holds follow the long press, once each, while the same press continues.
    CHECK(hold(g, true, now, 1200) == Press::Long);
    CHECK(hold(g, true, now, 3700) == Press::None);
    CHECK(hold(g, true, now, 200) == Press::PairHold);
    CHECK(hold(g, true, now, 9900) == Press::None);
    CHECK(hold(g, true, now, 200) == Press::ForgetHold);
    CHECK(hold(g, true, now, 2000) == Press::None);
    CHECK(hold(g, false, now, 500) == Press::None);
    // Releasing early means no forget, and the next press starts over.
    CHECK(hold(g, true, now, 1200) == Press::Long);
    CHECK(hold(g, true, now, 4000) == Press::PairHold);
    CHECK(hold(g, false, now, 500) == Press::None);
    CHECK(hold(g, true, now, 1200) == Press::Long);
    CHECK(hold(g, false, now, 500) == Press::None);
    // Long press fires while held and nothing follows on release.
    CHECK(hold(g, true, now, 1200) == Press::Long);
    CHECK(hold(g, false, now, 500) == Press::None);
    // A click followed by a long hold is one long press, not a single press.
    CHECK(hold(g, true, now, 80) == Press::None);
    CHECK(hold(g, false, now, 100) == Press::None);
    CHECK(hold(g, true, now, 1200) == Press::Long);
    CHECK(hold(g, false, now, 500) == Press::None);
  } else if (scenario == "screen") {
    Screen s(30000);
    s.start(1000);
    CHECK(s.on() && s.stage() == Stage::Icon);
    s.tick(2500);
    CHECK(s.stage() == Stage::Title);
    s.tick(3500);
    CHECK(s.stage() == Stage::Running && s.page() == Page::Main && s.on());
    // Pages cycle and Home returns to Main.
    s.input(Input::NextPage, 4000);
    CHECK(s.page() == Page::Nodes);
    s.input(Input::NextPage, 4100);
    CHECK(s.page() == Page::Debug);
    s.input(Input::NextPage, 4200);
    CHECK(s.page() == Page::Main);
    s.input(Input::NextPage, 4300);
    s.input(Input::Home, 4400);
    CHECK(s.page() == Page::Main);
    // Timeout counts from the last input.
    s.tick(4400 + 29999);
    CHECK(s.on());
    s.tick(4400 + 30000);
    CHECK(!s.on());
    // Any input wakes on the main page; Toggle turns it off again.
    s.input(Input::NextPage, 40000);
    CHECK(s.on() && s.page() == Page::Main);
    s.input(Input::Toggle, 40100);
    CHECK(!s.on());
    s.input(Input::Toggle, 40200);
    CHECK(s.on());
    // Input during startup skips to the main page.
    Screen early;
    early.start(0);
    early.input(Input::Toggle, 100);
    CHECK(early.stage() == Stage::Running && early.on() && early.page() == Page::Main);
    // A zero timeout keeps the screen on.
    Screen always(0);
    always.start(0);
    always.tick(5000);
    always.tick(10000000);
    CHECK(always.on());
  } else if (scenario == "unread") {
    Screen s;
    s.start(0);
    s.tick(3000);
    s.inbox(0, 3000);
    CHECK(s.unread() == 0);
    s.inbox(2, 3000);
    CHECK(s.unread() == 2);  // new while the screen is on
    s.input(Input::Toggle, 4000);
    CHECK(s.unread() == 0);  // turning the screen off marks them seen
    s.inbox(5, 5000);
    CHECK(s.unread() == 3 && !s.on());  // wake on message is off by default
    s.inbox(1, 6000);                   // inbox restarted
    CHECK(s.unread() == 0);
  } else if (scenario == "led") {
    Indicator led;
    Indicator::Input in;
    // Counters that are already nonzero at the first update are not activity.
    in.activity = 40;
    CHECK(!led.update(in, 1000));
    // Activity gives one bounded pulse.
    in.activity = 41;
    CHECK(led.update(in, 1010));
    CHECK(led.update(in, 1010 + Indicator::kPulseMs - 1));
    CHECK(!led.update(in, 1010 + Indicator::kPulseMs));
    CHECK(!led.update(in, 1010 + Indicator::kPulseMs + 500));
    // Constant traffic stays readable as blinks: each pulse is followed by a dark gap.
    std::uint64_t now = 2000;
    bool last = false;
    unsigned rises = 0, longest_on = 0, on_for = 0, longest_off = 0, off_for = 0;
    for (std::uint32_t tick = 0; tick < 200; ++tick, now += 10) {
      ++in.activity;
      const bool lit = led.update(in, now);
      if (lit && !last)
        ++rises;
      on_for = lit ? on_for + 10 : 0;
      off_for = lit ? 0 : off_for + 10;
      longest_on = on_for > longest_on ? on_for : longest_on;
      longest_off = off_for > longest_off ? off_for : longest_off;
      last = lit;
    }
    CHECK(rises >= 15 && longest_on <= Indicator::kPulseMs && longest_off >= Indicator::kGapMs);
    // A waiting message blinks slowly until a button is pressed or an agent attaches.
    Indicator waiting;
    Indicator::Input message;
    CHECK(!waiting.update(message, 0));
    message.latest = 3;
    CHECK(waiting.update(message, 4000));
    CHECK(!waiting.update(message, 4000 + Indicator::kSlowOnMs));
    CHECK(waiting.update(message, 4000 + Indicator::kSlowPeriodMs));
    message.seen = true;
    CHECK(!waiting.update(message, 8000));
    message.seen = false;
    CHECK(!waiting.update(message, 10000));
    message.latest = 4;
    CHECK(waiting.update(message, 12000));
    // An inbox that restarted lower does not leave a false waiting message.
    message.latest = 3;
    message.seen = true;
    CHECK(!waiting.update(message, 14000));
    message.seen = false;
    message.latest = 1;
    CHECK(!waiting.update(message, 16000));
    // Turning the LED off keeps it dark at once and drops pending activity, without a pulse
    // on turning back on. Messages that are still waiting blink again.
    Indicator dark;
    Indicator::Input off;
    CHECK(!dark.update(off, 0));
    off.activity = 1;
    CHECK(dark.update(off, 100));
    off.enabled = false;
    CHECK(!dark.update(off, 110));
    off.activity = 2;
    off.latest = 5;
    CHECK(!dark.update(off, 4000));
    off.enabled = true;
    CHECK(!dark.update(off, 4300));
    CHECK(dark.update(off, 6000));
  } else if (scenario == "settings") {
    Screen s;
    s.start(0);
    s.tick(3000);
    // A new timeout applies from the last input.
    s.settings(10000, false);
    s.tick(12999);
    CHECK(s.on());
    s.tick(13000);
    CHECK(!s.on());
    // Wake on message: a new message turns the screen on at the main page.
    s.settings(10000, true);
    s.inbox(0, 14000);
    CHECK(!s.on());  // no new message
    s.inbox(1, 15000);
    CHECK(s.on() && s.page() == Page::Main && s.unread() == 1);
    // While on, a new message restarts the timeout and keeps the page.
    s.input(Input::NextPage, 16000);
    s.inbox(2, 24000);
    s.tick(33999);
    CHECK(s.on() && s.page() == Page::Nodes);
    s.tick(34000);
    CHECK(!s.on());
    // An inbox restart is not a new message.
    s.inbox(0, 35000);
    CHECK(!s.on());
    // Zero keeps the screen on.
    s.settings(0, false);
    s.input(Input::Home, 36000);
    s.tick(10000000);
    CHECK(s.on());
    // Messages during startup do not change the sequence.
    Screen early;
    early.settings(30000, true);
    early.start(0);
    early.inbox(3, 100);
    CHECK(early.stage() == Stage::Icon);
  } else if (scenario == "render") {
    Screen s;
    Frame f{};
    const auto status = sample();
    s.start(0);
    render(s, status, f);
    CHECK(count(f) > 300);  // startup icon
    CHECK(!lit(f, 0, 0) && lit(f, 48 + 16, 16 + 26));
    s.tick(2000);
    render(s, status, f);
    CHECK(count(f) > 200);  // REAPER MESH title
    s.tick(3000);
    Frame main{}, nodes{}, debug{};
    render(s, status, main);
    s.input(Input::NextPage, 3100);
    render(s, status, nodes);
    s.input(Input::NextPage, 3200);
    render(s, status, debug);
    CHECK(count(main) > 300 && count(nodes) > 200 && count(debug) > 300);
    CHECK(main != nodes && nodes != debug && main != debug);
    // Long, non-ASCII and empty strings stay within the frame and render deterministically.
    Status odd = status;
    odd.name = "\xc3\xa9t\xc3\xa9 \xe2\x9c\x93 a-very-long-device-name-that-will-not-fit";
    odd.rows[0].name = "";
    odd.radio = "FAULT";
    odd.battery = 100;
    Frame a{}, b{};
    s.input(Input::Home, 3300);
    render(s, odd, a);
    render(s, odd, b);
    CHECK(a == b);
    odd.name = "";
    render(s, odd, a);
    CHECK(count(a) > 300);  // falls back to the node ID
  } else if (scenario == "ble") {
    Screen s;
    Frame f{};
    auto status = sample();
    s.start(0);
    // Attention skips startup and wakes the screen without changing the page.
    s.attention(100);
    CHECK(s.stage() == Stage::Running && s.on());
    s.input(Input::NextPage, 200);
    s.input(Input::Toggle, 300);
    CHECK(!s.on());
    s.attention(400);
    CHECK(s.on() && s.page() == Page::Nodes);
    // The pairing page replaces whichever page is showing, and each state draws differently.
    render(s, status, f);
    const Frame nodes = f;
    status.ble.name = "Reaper-1A2B";
    status.ble.seconds = 120;
    Frame previous = nodes;
    for (const auto notice :
         {BleNotice::Open, BleNotice::Passkey, BleNotice::Full, BleNotice::Paired,
          BleNotice::Failed, BleNotice::Forgotten, BleNotice::Unavailable}) {
      status.ble.notice = notice;
      render(s, status, f);
      CHECK(f != previous && count(f) > 50);
      previous = f;
    }
    // A passkey always shows six digits, including leading zeros, and no two keys look alike.
    status.ble.notice = BleNotice::Passkey;
    status.ble.passkey = 42;
    render(s, status, f);
    const Frame low = f;
    status.ble.passkey = 999999;
    render(s, status, f);
    CHECK(f != low);
    status.ble.notice = BleNotice::None;
    render(s, status, f);
    CHECK(f == nodes);
  } else if (scenario == "battery") {
    Screen s;
    s.start(0);
    s.tick(3000);
    auto status = sample();
    status.name = "BaseCamp01";  // 2x without a battery, 1x beside one
    Frame none{}, full{}, half{}, plugged{};
    render(s, status, none);
    for (unsigned y = 0; y < 18; ++y)
      CHECK(!lit(none, 127, y));  // unknown battery: nothing in the corner
    CHECK(lit(none, 1, 13));      // 2x name reaches the bottom of its row
    status.battery = 100;
    render(s, status, full);
    status.battery = 40;
    render(s, status, half);
    status.external = true;
    render(s, status, plugged);
    // Icon outline and terminal, on the name line (y 4-10).
    CHECK(lit(full, 115, 4) && lit(full, 125, 10) && lit(full, 127, 7) && !lit(full, 127, 4));
    // Full fills the gauge; 40% fills three of its seven columns.
    CHECK(lit(full, 123, 7) && lit(half, 119, 7) && !lit(half, 120, 7) && !lit(half, 116, 7));
    // The name drops to 1x beside the battery: nothing below the shared line.
    for (unsigned y = 11; y < 18; ++y)
      for (unsigned x = 0; x < kWidth; ++x)
        CHECK(!lit(full, x, y));
    // The plugged-in bolt adds pixels only left of the percent, and nothing else changes.
    unsigned added = 0;
    for (unsigned y = 0; y < kHeight; ++y)
      for (unsigned x = 0; x < kWidth; ++x)
        if (lit(plugged, x, y) != lit(half, x, y)) {
          CHECK(lit(plugged, x, y) && y >= 4 && y < 11 && x >= 89 && x < 94);
          ++added;
        }
    CHECK(added > 5);
    // Plugged in with no battery: the bolt and "USB" at the right edge, no gauge icon.
    status.battery = -1;
    Frame usb{};
    render(s, status, usb);
    CHECK(lit(usb, 127, 5));   // right side of the "B" at the edge
    CHECK(!lit(usb, 127, 7));  // no battery terminal
    unsigned bolt = 0;
    for (unsigned y = 4; y < 11; ++y)
      for (unsigned x = 104; x < 109; ++x)
        bolt += lit(usb, x, y);
    CHECK(bolt > 5);
    for (unsigned y = 11; y < 18; ++y)
      for (unsigned x = 0; x < kWidth; ++x)
        CHECK(!lit(usb, x, y));  // the long name moved to 1x beside it
    status.external = false;
    status.battery = 40;
    // A short name stays 2x beside the battery.
    status.name = "Camp";
    Frame short_name{};
    render(s, status, short_name);
    CHECK(lit(short_name, 3, 13));  // bottom of a 2x "C"
    // Out-of-range percent is clamped and stays in the frame.
    status.battery = 250;
    Frame clamped{};
    render(s, status, clamped);
    status.battery = 100;
    render(s, status, full);
    CHECK(clamped == full);
    status.battery = -1;
    status.battery_mv = 4067;
    Frame voltage{}, unknown{};
    render(s, status, voltage);
    CHECK(lit(voltage, 127, 7) && !lit(voltage, 120, 7));
    status.battery_mv = -1;
    render(s, status, unknown);
    CHECK(lit(unknown, 127, 7) && unknown != voltage);
  } else if (scenario == "preview") {
    Screen s;
    Frame f{};
    const auto status = sample();
    s.start(0);
    render(s, status, f);
    print(f, "startup icon");
    s.tick(2000);
    render(s, status, f);
    print(f, "startup title");
    s.tick(3000);
    auto battery = status;
    battery.battery = 87;
    battery.external = true;
    render(s, battery, f);
    print(f, "main with battery");
    battery.battery = -1;
    render(s, battery, f);
    print(f, "main plugged in without a battery");
    for (const char* title : {"main", "nodes", "debug"}) {
      render(s, status, f);
      print(f, title);
      s.input(Input::NextPage, 3100);
    }
    return 0;
  } else
    return 3;
  std::cout << "ok " << scenario << '\n';
}
