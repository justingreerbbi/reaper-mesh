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
// The proof for an epoch, from a chain long enough for every test here.
Key proof_at(std::uint32_t epoch, std::uint8_t seed = 0x44) {
  auto proof = filled(seed);
  for (std::uint32_t at = 3000; at > epoch; --at) {
    Key previous{};
    m::previous_proof(proof, previous);
    proof = previous;
  }
  return proof;
}
Key chain_at(std::uint8_t seed, std::uint32_t epoch) {
  auto chain = filled(seed);
  for (std::uint32_t i = 0; i < epoch; ++i)
    m::ratchet_chain(chain);
  return chain;
}
int main(int argc, char** argv) {
  if (argc != 2)
    return 2;
  const std::string scenario = argv[1];
  const auto relay1 = filled(0x11), device1 = filled(0x12), relay2 = filled(0x21),
             device2 = filled(0x22), team = filled(0x33), proof1 = filled(0x13),
             proof2 = filled(0x23);
  Flash flash;
  d::Network network(flash);
  network.begin();
  CHECK(network.mode() == d::NetworkMode::Unset && network.view().healthy);
  if (scenario == "store") {
    // A blank board has no network, and its link can do nothing.
    m::FrameLink link;
    link.seed(filled(1));
    CHECK(!network.apply(link) && !link.can_originate());
    CHECK(!std::strcmp(network.fill(kTeam, 1, 5, &relay1, &device1, &proof1), "ok"));
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
    CHECK(!std::strcmp(rebooted.fill(kTeam, 2, 0, &relay2, &device2, &proof2), "ok"));
    CHECK(!flash.contains(relay1) && !flash.contains(device1) && flash.contains(relay2));
    CHECK(!rebooted.team_loaded());
    // Moving to Open mode stores no secrets.
    CHECK(!std::strcmp(rebooted.fill(kOpen, 0, 0, nullptr, nullptr, nullptr), "ok"));
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
      CHECK(!std::strcmp(before.fill(kTeam, 1, 0, &relay1, &device1, &proof1), "ok"));
      test.steps_left = cut;
      before.fill(kTeam, 2, 0, &relay2, &device2, &proof2);
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
         {network.fill(0, 0, 0, nullptr, nullptr, nullptr),   // Erase is its own command.
          network.fill(3, 1, 0, &relay1, &device1, &proof1),  // Unknown mode.
          network.fill(kOpen, 1, 0, nullptr, nullptr, nullptr),
          network.fill(kOpen, 0, 0, &relay1, nullptr, nullptr),
          network.fill(kTeam, 0, 0, &relay1, &device1, &proof1),  // Generation 0.
          network.fill(kTeam, 1, 0, nullptr, &device1, &proof1),
          network.fill(kTeam, 1, 0, &relay1, nullptr, &proof1),
          network.fill(kTeam, 1, 0, &relay1, &device1, nullptr),
          network.fill(kTeam, 1, 0, &zero, &device1, &proof1),
          network.fill(kTeam, 1, 0, &relay1, &zero, &proof1),
          network.fill(kTeam, 1, 0, &relay1, &device1, &zero),
          network.fill(kTeam, 0x10000, 0, &relay1, &device1, &proof1),
          network.fill(kTeam, 1, 0x10000, &relay1, &device1, &proof1)})
      CHECK(!std::strcmp(state, "invalid"));
    CHECK(flash.writes == 0 && network.mode() == d::NetworkMode::Unset);
    CHECK(!std::strcmp(network.load_team(1, 0, team), "not-team"));
    CHECK(!std::strcmp(network.fill(kOpen, 0, 0, nullptr, nullptr, nullptr), "ok"));
    CHECK(!std::strcmp(network.load_team(1, 0, team), "not-team"));
    CHECK(!std::strcmp(network.fill(kTeam, 3, 7, &relay1, &device1, &proof1), "ok"));
    CHECK(!std::strcmp(network.load_team(2, 7, team), "mismatch"));
    CHECK(!std::strcmp(network.load_team(3, 6, team), "mismatch"));         // Below the floor.
    CHECK(!std::strcmp(network.load_team(3, 7 + 1025, team), "mismatch"));  // Past the look-ahead.
    CHECK(!std::strcmp(network.load_team(3, 7, zero), "invalid") && !network.team_loaded());
    CHECK(!std::strcmp(network.load_team(3, 7, team), "ok"));
    // A retried fill after a lost reply changes nothing: no flash wear, and the team key stays.
    const auto writes = flash.writes;
    const auto revision = network.revision();
    CHECK(!std::strcmp(network.fill(kTeam, 3, 7, &relay1, &device1, &proof1), "ok"));
    CHECK(flash.writes == writes && network.team_loaded() && network.revision() == revision);
    // A failed save keeps the current network.
    flash.steps_left = 0;
    CHECK(!std::strcmp(network.fill(kTeam, 4, 0, &relay2, &device2, &proof2), "storage-failed"));
    flash.steps_left = -1;
    CHECK(network.view().generation == 3 && network.team_loaded());
  } else if (scenario == "erase") {
    CHECK(!std::strcmp(network.fill(kTeam, 1, 0, &relay1, &device1, &proof1), "ok"));
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
  } else if (scenario == "rotate") {
    const auto start = proof_at(5);
    CHECK(!std::strcmp(network.fill(kTeam, 1, 5, &relay1, &device1, &start), "ok"));
    CHECK(network.view().epoch == 5 && network.view().proven_epoch == 5);
    CHECK(!std::strcmp(network.load_team(1, 5, team), "ok"));
    m::FrameLink link;
    link.seed(filled(1));
    CHECK(network.apply(link));
    const auto revision = network.revision();
    std::uint16_t epoch = 0;
    Key announced{};
    CHECK(!network.take_announcement(epoch, announced));
    // The first advance keeps epoch 5 as the previous one, so its key stays.
    auto proof = proof_at(6);
    CHECK(!std::strcmp(network.advance(6, proof), "ok"));
    CHECK(network.view().proven_epoch == 6 && network.view().epoch == 6);
    CHECK(flash.contains(relay1) && flash.contains(proof));
    CHECK(network.take_announcement(epoch, announced) && epoch == 6 && announced == proof);
    CHECK(!network.take_announcement(epoch, announced));  // Once only.
    network.sync(link);
    CHECK(link.floor() == 5 && link.team_epoch() == 6);
    // The next one erases it, and the team key is never stored at any epoch.
    proof = proof_at(7);
    CHECK(!std::strcmp(network.advance(7, proof), "ok"));
    CHECK(!flash.contains(relay1) && flash.contains(chain_at(0x11, 1)));
    CHECK(!flash.contains(team) && !flash.contains(chain_at(0x33, 2)));
    network.sync(link);
    CHECK(link.floor() == 6 && link.team_epoch() == 7);
    // None of this touched the revision, which would cancel messages in flight.
    CHECK(network.revision() == revision);
    // A proof can skip ahead, within the look-ahead.
    proof = proof_at(20);
    CHECK(!std::strcmp(network.advance(20, proof), "ok"));
    network.sync(link);
    CHECK(link.floor() == 19 && link.team_epoch() == 20);
    CHECK(network.view().proven_epoch == 20 && network.revision() == revision);
    CHECK(network.take_announcement(epoch, announced) && epoch == 20);
    // A wrong proof, an old epoch, and a jump past the look-ahead change nothing.
    const auto writes = flash.writes;
    CHECK(!std::strcmp(network.advance(21, proof_at(21, 0x45)), "invalid"));
    CHECK(!std::strcmp(network.advance(21, proof), "invalid"));
    CHECK(!std::strcmp(network.advance(19, proof_at(19)), "mismatch"));
    CHECK(!std::strcmp(network.advance(20, proof_at(19)), "invalid"));
    CHECK(!std::strcmp(network.advance(20 + 1025, proof_at(20 + 1025)), "invalid"));
    CHECK(!std::strcmp(network.advance(0x10000, proof), "invalid"));
    CHECK(flash.writes == writes && network.view().proven_epoch == 20);
    CHECK(!network.take_announcement(epoch, announced));
    // Asking to announce the current epoch again costs no flash.
    CHECK(!std::strcmp(network.advance(20, proof), "ok"));
    CHECK(flash.writes == writes && network.take_announcement(epoch, announced) && epoch == 20);
    // After a restart it has the floor and proof, and has lost the team key.
    d::Network rebooted(flash);
    rebooted.begin();
    CHECK(rebooted.view().epoch == 19 && rebooted.view().proven_epoch == 20);
    CHECK(!rebooted.team_loaded());
    CHECK(!std::strcmp(rebooted.view().proof, network.view().proof));
    CHECK(*rebooted.view().proof);
    // An agent reloads at the epoch it holds: at or above the floor, and never below it.
    const auto team_20 = chain_at(0x33, 20), team_18 = chain_at(0x33, 18),
               team_23 = chain_at(0x33, 23);
    CHECK(!std::strcmp(rebooted.load_team(1, 18, team_18), "mismatch"));
    CHECK(!std::strcmp(rebooted.load_team(1, 20, team_20), "ok"));
    CHECK(rebooted.view().epoch == 20 && rebooted.team_loaded());
    // Moving the same team forward leaves the revision alone, and a new key does not.
    const auto loaded = rebooted.revision();
    CHECK(!std::strcmp(rebooted.load_team(1, 23, team_23), "ok"));
    CHECK(rebooted.revision() == loaded && rebooted.view().epoch == 23);
    CHECK(!std::strcmp(rebooted.load_team(1, 23, team_23), "ok"));
    CHECK(rebooted.revision() == loaded);
    const auto other_team = filled(0x34);
    CHECK(!std::strcmp(rebooted.load_team(1, 23, other_team), "ok"));
    CHECK(rebooted.revision() != loaded);
    // A proof carries a loaded team key along with it.
    d::Network follower(flash);
    follower.begin();
    CHECK(!std::strcmp(follower.load_team(1, 20, team_20), "ok"));
    m::FrameLink heard;
    heard.seed(filled(2));
    CHECK(follower.apply(heard));
    CHECK(follower.hear_proof(25, proof_at(25), heard, 0));
    follower.sync(heard);
    CHECK(heard.team_epoch() == 25 && follower.view().epoch == 25);
    const auto expected = chain_at(0x33, 25);
    CHECK(heard.team_chain() == expected);
    CHECK(!follower.hear_proof(25, proof_at(25), heard, 0));  // Old news, so not forwarded again.
    CHECK(!follower.hear_proof(24, proof_at(24), heard, 0));
    // Open mode has no epochs.
    CHECK(!std::strcmp(follower.fill(kOpen, 0, 0, nullptr, nullptr, nullptr), "ok"));
    CHECK(!std::strcmp(follower.advance(1, proof_at(1)), "not-team"));
  } else if (scenario == "thief") {
    // The relay-only radio is left with what a thief of one relay key could push at it.
    const auto start = proof_at(0);
    CHECK(!std::strcmp(network.fill(kTeam, 1, 0, &relay1, &device1, &start), "ok"));
    m::FrameLink link;
    link.seed(filled(1));
    CHECK(network.apply(link));
    const auto revision = network.revision();
    const auto writes = flash.writes;
    const auto frame_at = [&](std::uint32_t epoch) {
      const auto chain = chain_at(0x11, epoch), other_team = filled(0x77);
      m::FrameLink stolen;
      stolen.seed(filled(static_cast<std::uint8_t>(3 + epoch % 200)));
      stolen.set_chains(chain, &other_team, static_cast<std::uint16_t>(epoch));
      m::Frame frame{};
      stolen.seal({}, frame);
      m::Packet p{};
      p.key.origin = 2;
      p.key.boot = 2;
      p.key.sequence = 1;
      p.destination = 3;
      p.count = 1;
      p.size = p.total = 1;
      stolen.seal(p, frame);
      return frame;
    };
    m::Packet out{};
    std::uint64_t now = 0;
    // Walking forward repeatedly: each frame passes and is forwarded, and none of it sticks.
    for (std::uint32_t epoch = 200; epoch <= 1000; epoch += 200, now += 20000) {
      const auto frame = frame_at(epoch);
      CHECK(link.receive(frame.bytes.data(), frame.size, now, out) == m::FrameResult::RelayOnly);
      network.sync(link);
      CHECK(link.floor() == 0);
    }
    CHECK(flash.writes == writes && network.revision() == revision);
    CHECK(network.view().proven_epoch == 0 && flash.contains(relay1));
    // Honest traffic at the real epoch still gets through.
    const auto honest = frame_at(1);
    CHECK(link.receive(honest.bytes.data(), honest.size, now, out) == m::FrameResult::RelayOnly);
    // Proofs it makes up fail, and it cannot compute the real ones from a relay key.
    m::FrameLink thief;
    thief.seed(filled(0x79));
    const auto far_chain = chain_at(0x11, 500);
    CHECK(thief.set_chains(far_chain, nullptr, 500));
    m::Frame junk{};
    CHECK(thief.seal_proof(500, relay1, 3, junk));
    CHECK(link.receive(junk.bytes.data(), junk.size, now, out) == m::FrameResult::Proof);
    CHECK(!network.hear_proof(500, m::frame_proof(junk.bytes.data()), link, now + 20000));
    CHECK(flash.writes == writes && network.view().proven_epoch == 0);
    // A replayed real proof moves it only to where the team really is. Replaying again does
    // nothing.
    CHECK(network.hear_proof(1, proof_at(1), link, now + 20000));
    const auto settled = flash.writes;
    CHECK(!network.hear_proof(1, proof_at(1), link, now + 20000));
    CHECK(flash.writes == settled);
    // Junk proofs are bounded by the budget before any hashing is done on them.
    const auto later = now + 40000;
    CHECK(!network.hear_proof(1024, relay1, link, later));
    CHECK(!network.hear_proof(1024, relay1, link, later));
    CHECK(!link.spend(1000, later));
  } else if (scenario == "rotatecut") {
    // A power cut at any step of an advance leaves one whole record, the old epoch or the new.
    for (int cut = 0; cut < 6; ++cut) {
      Flash test;
      d::Network before(test);
      before.begin();
      const auto start = proof_at(5);
      CHECK(!std::strcmp(before.fill(kTeam, 1, 5, &relay1, &device1, &start), "ok"));
      CHECK(!std::strcmp(before.advance(6, proof_at(6)), "ok"));
      test.steps_left = cut;
      before.advance(8, proof_at(8));
      test.steps_left = -1;
      d::Network after(test);
      after.begin();
      CHECK(after.view().healthy && after.mode() == d::NetworkMode::Team);
      const auto proven = after.view().proven_epoch;
      CHECK(proven == 6 || proven == 8);
      if (proven == 8) {
        CHECK(!test.contains(relay1) && !test.contains(chain_at(0x11, 1)));
        CHECK(test.contains(chain_at(0x11, 2)) && after.view().epoch == 7);
      } else {
        CHECK(test.contains(relay1) && after.view().epoch == 5);
      }
      // Either way it can still take the next proof.
      CHECK(!std::strcmp(after.advance(9, proof_at(9)), "ok"));
      CHECK(after.view().proven_epoch == 9 && test.contains(chain_at(0x11, 3)));
    }
    // A failed save reports storage, keeps the old epoch and announces nothing.
    const auto start = proof_at(0);
    CHECK(!std::strcmp(network.fill(kTeam, 1, 0, &relay1, &device1, &start), "ok"));
    flash.steps_left = 0;
    CHECK(!std::strcmp(network.advance(1, proof_at(1)), "storage-failed"));
    flash.steps_left = -1;
    std::uint16_t epoch = 0;
    Key announced{};
    CHECK(network.view().proven_epoch == 0 && !network.take_announcement(epoch, announced));
  } else if (scenario == "oldrecord") {
    // A record from the previous format reads as no network, and is cleared on the next save.
    auto& old = flash.sectors[1];
    std::fill(old.begin(), old.begin() + 80, std::uint8_t(0x5a));
    old[0] = 'R';
    old[1] = 'K';
    old[2] = 1;
    d::Network booted(flash);
    booted.begin();
    CHECK(booted.mode() == d::NetworkMode::Unset && booted.view().healthy);
    CHECK(!std::strcmp(booted.fill(kOpen, 0, 0, nullptr, nullptr, nullptr), "ok"));
    CHECK(std::all_of(old.begin(), old.end(), [](auto b) { return b == 0xff; }));
  } else if (scenario == "corrupt") {
    CHECK(!std::strcmp(network.fill(kTeam, 1, 0, &relay1, &device1, &proof1), "ok"));
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
    CHECK(!std::strcmp(unreadable.fill(kOpen, 0, 0, nullptr, nullptr, nullptr), "storage-failed"));
  } else {
    return 3;
  }
  std::cout << "ok " << scenario << '\n';
  return 0;
}
