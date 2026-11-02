#include "reaper/configuration.hpp"
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <string>

namespace d = reaper::device;
namespace p = reaper::protocol;
#define CHECK(expression) do { if (!(expression)) { std::cerr << "failed line " << __LINE__ << ": " << #expression << '\n'; return 1; } } while (false)

template <std::size_t N> d::Text<N> text(const std::string& value) {
  d::Text<N> result{};
  if (!result.assign(reinterpret_cast<const std::uint8_t*>(value.data()), value.size())) std::abort();
  return result;
}
struct Store : d::Storage {
  std::array<std::uint8_t, d::kMaxRecord> data{};
  std::size_t size = 0;
  unsigned writes = 0;
  bool failed_read = false;
  bool uncertain_writes_next = false;
  bool copy_uncertain = false;
  bool definite_failure = false;
  bool observed_old_state = false;
  d::Configuration* observe = nullptr;
  d::ReadStatus read(std::uint8_t* output, std::size_t capacity, std::size_t& length) noexcept override {
    length = 0;
    if (failed_read || size > capacity) return d::ReadStatus::Failed;
    if (!size) return d::ReadStatus::Missing;
    std::memcpy(output, data.data(), size); length = size;
    return d::ReadStatus::Loaded;
  }
  d::CommitStatus commit(const std::uint8_t* input, std::size_t length) noexcept override {
    ++writes;
    if (observe) {
      d::Snapshot current{};
      observed_old_state = observe->snapshot(current) && current.revision == 0;
    }
    if (definite_failure) return d::CommitStatus::NotCommitted;
    if (!uncertain_writes_next || copy_uncertain) {
      if (length > data.size()) std::abort();
      std::memcpy(data.data(), input, length); size = length;
    }
    return uncertain_writes_next ? d::CommitStatus::Indeterminate : d::CommitStatus::Committed;
  }
};
d::Command command(std::uint32_t sequence = 1, std::uint32_t revision = 0, std::string label = "changed", std::string owner = "agent-A") {
  d::Command result{};
  result.id = text<75>(owner + ":" + std::to_string(sequence));
  result.boot = text<64>("boot-A"); result.expected_revision = revision;
  result.settings.region = d::Region::Us; result.settings.label = text<64>(label);
  return result;
}

int main(int argc, char** argv) {
  if (argc != 2) return 2;
  const std::string scenario = argv[1];
  Store store;
  d::Configuration authority(store, text<64>("boot-A"));
  d::Snapshot snapshot{};
  if (scenario == "commit") {
    CHECK(authority.snapshot(snapshot) && snapshot.revision == 0 && snapshot.settings.region == d::Region::Unset);
    store.observe = &authority;
    const auto result = authority.apply(command());
    CHECK(result.outcome == d::Outcome::Committed && result.revision == 1);
    CHECK(store.observed_old_state); // Nothing is published before the storage callback returns.
    CHECK(authority.snapshot(snapshot) && snapshot.revision == 1);
    CHECK(authority.query(command().id).outcome == d::Outcome::Committed);
  } else if (scenario == "retry") {
    CHECK(authority.apply(command()).outcome == d::Outcome::Committed);
    CHECK(authority.apply(command()).outcome == d::Outcome::Committed && store.writes == 1);
    CHECK(authority.apply(command(1, 0, "different")).outcome == d::Outcome::Rejected);
    CHECK(store.writes == 1);
  } else if (scenario == "conflict") {
    CHECK(authority.apply(command()).outcome == d::Outcome::Committed);
    CHECK(authority.apply(command(1, 0, "other", "agent-B")).outcome == d::Outcome::Conflict);
    CHECK(store.writes == 1);
    CHECK(authority.apply(command(1, 0, "other", "agent-B")).outcome == d::Outcome::Conflict);
  } else if (scenario == "failure") {
    store.definite_failure = true;
    CHECK(authority.apply(command()).outcome == d::Outcome::Rejected);
    CHECK(authority.snapshot(snapshot) && snapshot.revision == 0);
    store.definite_failure = false;
    CHECK(authority.apply(command()).outcome == d::Outcome::Rejected && store.writes == 1);
    CHECK(authority.apply(command(2)).outcome == d::Outcome::Committed && store.writes == 2);
  } else if (scenario == "uncertain-old" || scenario == "uncertain-new") {
    store.uncertain_writes_next = true; store.copy_uncertain = scenario == "uncertain-new";
    CHECK(authority.apply(command()).outcome == d::Outcome::Unknown);
    CHECK(!authority.healthy() && !authority.snapshot(snapshot));
    CHECK(!authority.admit(text<64>("new-owner")));
    CHECK(authority.apply(command(2)).outcome == d::Outcome::Unknown && store.writes == 1);
    CHECK(authority.query(command().id).outcome == d::Outcome::Unknown);
    store.uncertain_writes_next = false;
    d::Configuration rebooted(store, text<64>("boot-B"));
    CHECK(rebooted.snapshot(snapshot));
    CHECK(snapshot.revision == (store.copy_uncertain ? 1U : 0U));
    CHECK(rebooted.query(command().id).outcome == d::Outcome::Unknown);
    CHECK(rebooted.apply(command()).outcome == d::Outcome::Rejected && store.writes == 1);
  } else if (scenario == "reboot") {
    CHECK(authority.apply(command()).outcome == d::Outcome::Committed);
    d::Configuration rebooted(store, text<64>("boot-B"));
    CHECK(rebooted.snapshot(snapshot) && snapshot.revision == 1);
    CHECK(rebooted.query(command().id).outcome == d::Outcome::Unknown);
    CHECK(rebooted.apply(command()).outcome == d::Outcome::Rejected);
    auto next = command(2, 1); next.boot = text<64>("boot-B");
    CHECK(rebooted.apply(next).outcome == d::Outcome::Committed);
  } else if (scenario == "eviction") {
    for (std::uint32_t i = 1; i <= 100; ++i) CHECK(authority.apply(command(i, i - 1)).outcome == d::Outcome::Committed);
    CHECK(authority.query(command().id).outcome == d::Outcome::Unknown);
    CHECK(authority.apply(command(1, 100)).outcome == d::Outcome::Unknown && store.writes == 100);
    CHECK(authority.query(command(100).id).outcome == d::Outcome::Committed);
  } else if (scenario == "owners") {
    for (unsigned i = 0; i < d::Configuration::kOwnerCapacity; ++i) CHECK(authority.admit(text<64>("owner-" + std::to_string(i))));
    CHECK(authority.admit(text<64>("owner-0")));
    CHECK(!authority.admit(text<64>("new-owner")));
    CHECK(authority.apply(command()).outcome == d::Outcome::Rejected && store.writes == 0);
    CHECK(authority.apply(command(1, 0, "old-owner", "owner-0")).outcome == d::Outcome::Committed);
  } else if (scenario == "corruption") {
    CHECK(authority.apply(command()).outcome == d::Outcome::Committed);
    const Store good = store;
    for (std::size_t i = 0; i < good.size; ++i) {
      store = good; store.data[i] ^= 1;
      d::Configuration broken(store, text<64>("boot-B"));
      CHECK(!broken.healthy() && !broken.snapshot(snapshot));
      CHECK(broken.apply(command()).outcome == d::Outcome::Rejected); // Old boot is still rejected.
      CHECK(store.writes == 1); // Loading corruption never erases/overwrites it.
    }
    store = good; store.failed_read = true;
    d::Configuration unavailable(store, text<64>("boot-B"));
    CHECK(!unavailable.healthy());
  } else if (scenario == "record") {
    d::Snapshot original{}; original.revision = 0xffffffff;
    original.settings.region = d::Region::Us; original.settings.label = text<64>(std::string(64, 'x'));
    std::array<std::uint8_t, d::kMaxRecord> encoded{}; std::size_t size = 0;
    CHECK(d::encode_record(original, encoded.data(), encoded.size(), size) && size == 77);
    for (std::size_t length = 0; length < size; ++length) CHECK(!d::decode_record(encoded.data(), length, snapshot));
    CHECK(d::decode_record(encoded.data(), size, snapshot) && snapshot.revision == 0xffffffff);
    store.data = encoded; store.size = size;
    d::Configuration exhausted(store, text<64>("boot-A"));
    CHECK(exhausted.apply(command(1, 0xffffffff)).outcome == d::Outcome::Rejected && store.writes == 0);
    original.settings.label = text<64>("bad\nlabel");
    CHECK(!d::encode_record(original, encoded.data(), encoded.size(), size) && size == 0);
  } else if (scenario == "radio") {
    CHECK(authority.apply(command()).outcome == d::Outcome::Committed);
    auto radio = command(2, 1); radio.has_radio = true;
    radio.settings.radio.mode = d::RadioMode::Receive; radio.settings.radio.power = 5; radio.settings.radio.relay = true;
    radio.settings.radio.channels = text<71>("Public|Camp|Team|||||");
    CHECK(authority.apply(radio).outcome == d::Outcome::Committed && store.data[2] == 2);
    CHECK(authority.apply(radio).outcome == d::Outcome::Committed && store.writes == 2);
    d::Configuration restarted(store, text<64>("boot-B"));
    CHECK(restarted.snapshot(snapshot) && snapshot.settings.radio.power == 5 && snapshot.settings.radio.relay);
    CHECK(authority.apply(command(3, 2, "legacy-label")).outcome == d::Outcome::Committed);
    CHECK(authority.snapshot(snapshot) && snapshot.settings.radio.mode == d::RadioMode::Receive);
    auto disable = command(4, 3); disable.settings.region = d::Region::Unset;
    CHECK(authority.apply(disable).outcome == d::Outcome::Committed);
    CHECK(authority.snapshot(snapshot) && snapshot.settings.radio.mode == d::RadioMode::Off && snapshot.settings.radio.power == 5);
    auto invalid = command(5, 4); invalid.has_radio = true; invalid.settings.radio.power = 11;
    CHECK(authority.apply(invalid).outcome == d::Outcome::Rejected);
    // Maximal extended record is bounded and rejects every incomplete prefix.
    snapshot.settings.region = d::Region::Us; snapshot.settings.label = text<64>(std::string(64, 'x'));
    snapshot.settings.radio.channels = text<71>("Public|Channel1|Channel2|Channel3|Channel4|Channel5|Channel6|Channel7");
    std::array<std::uint8_t, d::kMaxRecord> encoded{}; std::size_t size = 0;
    CHECK(d::encode_record(snapshot, encoded.data(), encoded.size(), size) && size == 151);
    for (std::size_t n = 0; n < size; ++n) { d::Snapshot out{}; CHECK(!d::decode_record(encoded.data(), n, out)); }
  } else if (scenario == "validation") {
    CHECK(!authority.admit(text<64>("bad:owner")));
    auto bad = command(); bad.id = text<75>("agent-A:01");
    CHECK(authority.apply(bad).outcome == d::Outcome::Rejected);
    bad = command(); bad.settings.label = text<64>("bad\nlabel");
    CHECK(authority.apply(bad).outcome == d::Outcome::Rejected);
    bad = command(); bad.settings.label.length = 65;
    CHECK(authority.apply(bad).outcome == d::Outcome::Rejected && store.writes == 0);
    CHECK(authority.apply(command()).outcome == d::Outcome::Committed);
  } else if (scenario == "wire") {
    p::Message message{}; message.type = p::MessageType::Configure;
    const auto set = [](p::FieldValue& field, const std::string& value) {
      field.present = true; field.length = value.size();
      std::memcpy(field.text.data(), value.data(), value.size());
    };
    set(message.fields[p::kConfigureLink], "link-A");
    set(message.fields[p::kConfigureBoot], "boot-A");
    set(message.fields[p::kConfigureId], "agent-A:1");
    set(message.fields[p::kConfigureRegion], "US");
    set(message.fields[p::kConfigureLabel], "from framed USB");
    message.fields[p::kConfigureExpectedRevision].present = true;
    std::array<std::uint8_t, p::kMaxEncoded + 1> frame{}; std::size_t size = 0;
    CHECK(p::encode_frame(message, frame.data(), frame.size(), size));
    p::Message decoded{};
    CHECK(p::decode_frame(frame.data(), size - 1, decoded));
    d::Command parsed{};
    CHECK(d::decode_command(decoded, parsed));
    CHECK(authority.apply(parsed).outcome == d::Outcome::Committed);
    CHECK(authority.snapshot(snapshot) && snapshot.settings.label.length == 15);
    decoded.fields[p::kConfigureId].length = 76;
    CHECK(!d::decode_command(decoded, parsed));
    CHECK(authority.apply(parsed).outcome == d::Outcome::Committed && store.writes == 1);
  } else if (scenario == "position") {
    auto change = command(); change.has_position = true; change.settings.position = {true, 1, 0, 3600000000U};
    CHECK(authority.apply(change).outcome == d::Outcome::Committed && store.data[2] == 4);
    CHECK(authority.apply(change).outcome == d::Outcome::Committed && store.writes == 1);
    auto reuse = change; reuse.settings.position.share = false;
    CHECK(authority.apply(reuse).outcome == d::Outcome::Rejected);
    d::Configuration rebooted(store, text<64>("boot-B")); CHECK(rebooted.snapshot(snapshot) && d::same_position(snapshot.settings.position, change.settings.position));
    CHECK(authority.apply(command(2, 1, "legacy")).outcome == d::Outcome::Committed);
    CHECK(authority.snapshot(snapshot) && d::same_position(snapshot.settings.position, change.settings.position));
    auto invalid = command(3, 2); invalid.has_position = true; invalid.settings.position.latitude = 1800000001;
    CHECK(authority.apply(invalid).outcome == d::Outcome::Rejected);
    invalid.settings.position.latitude = 0; invalid.settings.position.source = 2;
    CHECK(authority.apply(invalid).outcome == d::Outcome::Rejected);
    auto failed = command(3, 2); failed.has_position = true; store.definite_failure = true;
    CHECK(authority.apply(failed).outcome == d::Outcome::Rejected);
    CHECK(authority.snapshot(snapshot) && snapshot.settings.position.share);
    store.definite_failure = false;
    auto disable = command(4, 2); disable.has_position = true;
    CHECK(authority.apply(disable).outcome == d::Outcome::Committed && store.data[2] < 4);
    CHECK(authority.snapshot(snapshot) && !snapshot.settings.position.share);
    change = command(5, 3); change.has_position = true; change.settings.position = {true, 1, 900000000, 1800000000};
    store.uncertain_writes_next = store.copy_uncertain = true;
    CHECK(authority.apply(change).outcome == d::Outcome::Unknown && !authority.snapshot(snapshot));
    d::Configuration recovered(store, text<64>("boot-C")); CHECK(recovered.snapshot(snapshot) && snapshot.revision == 4 && snapshot.settings.position.share);
    CHECK(recovered.query(change.id).outcome == d::Outcome::Unknown);
    for (std::size_t n = 0; n < store.size; ++n) CHECK(!d::decode_record(store.data.data(), n, snapshot));
  } else if (scenario == "discovery") {
    auto change = command(); change.has_discovery = true; change.settings.discovery = {true, true, 60};
    CHECK(authority.apply(change).outcome == d::Outcome::Committed && store.data[2] == 3);
    d::Configuration reloaded(store, text<64>("boot-A")); CHECK(reloaded.snapshot(snapshot) && snapshot.settings.discovery.beacon && snapshot.settings.discovery.respond);
    CHECK(authority.apply(command(2, 1, "legacy")).outcome == d::Outcome::Committed);
    CHECK(authority.snapshot(snapshot) && snapshot.settings.discovery.interval == 60 && snapshot.settings.discovery.respond);
    auto bad = command(3, 2); bad.has_discovery = true; bad.settings.discovery.interval = 59;
    CHECK(authority.apply(bad).outcome == d::Outcome::Rejected);
  } else return 3;
  std::cout << "ok " << scenario << '\n';
}
