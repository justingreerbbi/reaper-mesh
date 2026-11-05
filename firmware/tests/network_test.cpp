#include "reaper/network.hpp"
#include <algorithm>
#include <cstring>
#include <iostream>
#include <string>
namespace d = reaper::device;
namespace m = reaper::mesh;
using Key = reaper::crypto::Key;
#define CHECK(v)                                              \
  do {                                                        \
    if (!(v)) {                                               \
      std::cerr << "line " << __LINE__ << ": " << #v << '\n'; \
      return 1;                                               \
    }                                                         \
  } while (false)
// Flash: erasing makes a sector blank, and writing can only clear bits. A power cut stops every
// operation from a chosen step onward.
struct Flash final : d::KeySectors {
  std::array<std::array<std::uint8_t, 4096>, 2> sectors{};
  int steps_left = -1;
  bool read_fails = false;
  unsigned writes = 0;
  Flash() {
    for (auto& sector : sectors)
      sector.fill(0xff);
  }
  bool step() {
    if (steps_left == 0)
      return false;
    if (steps_left > 0)
      --steps_left;
    return true;
  }
  bool read(unsigned sector, std::uint8_t* out, std::size_t size) override {
    if (read_fails || steps_left == 0)
      return false;
    std::memcpy(out, sectors[sector].data(), size);
    return true;
  }
  bool erase(unsigned sector) override {
    if (!step())
      return false;
    sectors[sector].fill(0xff);
    return true;
  }
  bool write(unsigned sector, const std::uint8_t* bytes, std::size_t size) override {
    if (!step())
      return false;
    ++writes;
    for (std::size_t i = 0; i < size; ++i)
      sectors[sector][i] &= bytes[i];
    return true;
  }
  bool contains(const Key& key) const {
    for (const auto& sector : sectors)
      if (std::search(sector.begin(), sector.end(), key.begin(), key.end()) != sector.end())
        return true;
    return false;
  }
};
Key filled(std::uint8_t value) {
  Key key{};
  key.fill(value);
  return key;
}
constexpr std::uint32_t kOpen = 1, kTeam = 2;
int main(int argc, char** argv) {
  if (argc != 2)
    return 2;
  const std::string scenario = argv[1];
  const auto relay1 = filled(0x11), device1 = filled(0x12), relay2 = filled(0x21),
             device2 = filled(0x22), team = filled(0x33);
  Flash flash;
  d::Network network(flash);
  network.begin();
  CHECK(network.mode() == d::NetworkMode::Unset && network.view().healthy);
  if (scenario == "store") {
    // A blank board has no network, and its link can do nothing.
    m::FrameLink link;
    link.seed(filled(1));
    CHECK(!network.apply(link) && !link.can_originate());
    CHECK(!std::strcmp(network.fill(kTeam, 1, 5, &relay1, &device1), "ok"));
    CHECK(flash.contains(relay1) && flash.contains(device1));
    // The team key reaches flash at no point, and is gone after a reboot.
    CHECK(!std::strcmp(network.load_team(1, 5, team), "ok") && network.team_loaded());
    CHECK(network.apply(link) && link.can_originate());
    CHECK(!flash.contains(team));
    // The same values the portal computes, so the two can compare keys without sending them.
    CHECK(!std::strcmp(network.view().relay_fingerprint, "53bb84e9427aeb94"));
    CHECK(!std::strcmp(network.view().team_fingerprint, "992f5023c1997e44"));
    d::Network rebooted(flash);
    rebooted.begin();
    CHECK(rebooted.mode() == d::NetworkMode::Team && !rebooted.team_loaded());
    CHECK(rebooted.view().generation == 1 && rebooted.view().epoch == 5);
    CHECK(rebooted.apply(link) && !link.can_originate());  // A relay until its agent returns.
    CHECK(*rebooted.view().relay_fingerprint && !*rebooted.view().team_fingerprint);
    // Replacing the keys leaves no copy of the old ones, and needs the team key loaded again.
    CHECK(!std::strcmp(rebooted.fill(kTeam, 2, 0, &relay2, &device2), "ok"));
    CHECK(!flash.contains(relay1) && !flash.contains(device1) && flash.contains(relay2));
    CHECK(!rebooted.team_loaded());
    // Moving to Open mode stores no secrets.
    CHECK(!std::strcmp(rebooted.fill(kOpen, 0, 0, nullptr, nullptr), "ok"));
    CHECK(!flash.contains(relay2) && !flash.contains(device2));
    CHECK(rebooted.mode() == d::NetworkMode::Open);
    CHECK(rebooted.apply(link) && link.can_originate());
    d::Network again(flash);
    again.begin();
    CHECK(again.mode() == d::NetworkMode::Open);
  } else if (scenario == "powercut") {
    // Cut power at every step of a key change. Exactly one whole network survives, either the old
    // or the new, and finishing the boot leaves no second copy behind.
    for (int cut = 0; cut < 6; ++cut) {
      Flash test;
      d::Network before(test);
      before.begin();
      CHECK(!std::strcmp(before.fill(kTeam, 1, 0, &relay1, &device1), "ok"));
      test.steps_left = cut;
      before.fill(kTeam, 2, 0, &relay2, &device2);
      test.steps_left = -1;
      d::Network after(test);
      after.begin();
      const auto generation = after.view().generation;
      CHECK(after.view().healthy);
      CHECK(after.mode() == d::NetworkMode::Team && (generation == 1 || generation == 2));
      if (generation == 2)
        CHECK(!test.contains(relay1) && test.contains(relay2));
      else
        CHECK(test.contains(relay1));
    }
  } else if (scenario == "rules") {
    const auto zero = filled(0);
    for (const auto* state :
         {network.fill(0, 0, 0, nullptr, nullptr),   // Erase is its own command.
          network.fill(3, 1, 0, &relay1, &device1),  // Unknown mode.
          network.fill(kOpen, 1, 0, nullptr, nullptr), network.fill(kOpen, 0, 0, &relay1, nullptr),
          network.fill(kTeam, 0, 0, &relay1, &device1),  // Generation 0.
          network.fill(kTeam, 1, 0, nullptr, &device1), network.fill(kTeam, 1, 0, &relay1, nullptr),
          network.fill(kTeam, 1, 0, &zero, &device1), network.fill(kTeam, 1, 0, &relay1, &zero),
          network.fill(kTeam, 0x10000, 0, &relay1, &device1),
          network.fill(kTeam, 1, 0x10000, &relay1, &device1)})
      CHECK(!std::strcmp(state, "invalid"));
    CHECK(flash.writes == 0 && network.mode() == d::NetworkMode::Unset);
    CHECK(!std::strcmp(network.load_team(1, 0, team), "not-team"));
    CHECK(!std::strcmp(network.fill(kOpen, 0, 0, nullptr, nullptr), "ok"));
    CHECK(!std::strcmp(network.load_team(1, 0, team), "not-team"));
    CHECK(!std::strcmp(network.fill(kTeam, 3, 7, &relay1, &device1), "ok"));
    CHECK(!std::strcmp(network.load_team(2, 7, team), "mismatch"));
    CHECK(!std::strcmp(network.load_team(3, 8, team), "mismatch"));
    CHECK(!std::strcmp(network.load_team(3, 7, zero), "invalid") && !network.team_loaded());
    CHECK(!std::strcmp(network.load_team(3, 7, team), "ok"));
    // A retried fill after a lost reply changes nothing: no flash wear, and the team key stays.
    const auto writes = flash.writes;
    const auto revision = network.revision();
    CHECK(!std::strcmp(network.fill(kTeam, 3, 7, &relay1, &device1), "ok"));
    CHECK(flash.writes == writes && network.team_loaded() && network.revision() == revision);
    // A failed save keeps the current network.
    flash.steps_left = 0;
    CHECK(!std::strcmp(network.fill(kTeam, 4, 0, &relay2, &device2), "storage-failed"));
    flash.steps_left = -1;
    CHECK(network.view().generation == 3 && network.team_loaded());
  } else if (scenario == "erase") {
    CHECK(!std::strcmp(network.fill(kTeam, 1, 0, &relay1, &device1), "ok"));
    CHECK(!std::strcmp(network.load_team(1, 0, team), "ok"));
    const auto revision = network.revision();
    CHECK(!std::strcmp(network.erase(), "ok"));
    CHECK(network.revision() != revision);
    CHECK(network.mode() == d::NetworkMode::Unset && !network.team_loaded());
    for (const auto& sector : flash.sectors)
      CHECK(std::all_of(sector.begin(), sector.end(), [](auto b) { return b == 0xff; }));
    m::FrameLink link;
    link.seed(filled(1));
    CHECK(!network.apply(link) && !link.can_originate());
    d::Network rebooted(flash);
    rebooted.begin();
    CHECK(rebooted.mode() == d::NetworkMode::Unset);
  } else if (scenario == "corrupt") {
    CHECK(!std::strcmp(network.fill(kTeam, 1, 0, &relay1, &device1), "ok"));
    // Damage to the only record leaves no network, and never an invented one.
    for (auto& sector : flash.sectors)
      sector[20] ^= 1;
    d::Network damaged(flash);
    damaged.begin();
    CHECK(damaged.mode() == d::NetworkMode::Unset && damaged.view().healthy);
    // A flash that cannot be read fails closed and accepts nothing.
    flash.read_fails = true;
    d::Network unreadable(flash);
    unreadable.begin();
    CHECK(unreadable.mode() == d::NetworkMode::Unset && !unreadable.view().healthy);
    CHECK(!std::strcmp(unreadable.fill(kOpen, 0, 0, nullptr, nullptr), "storage-failed"));
  } else {
    return 3;
  }
  std::cout << "ok " << scenario << '\n';
  return 0;
}
