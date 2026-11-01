#pragma once
#include "reaper/protocol.hpp"

namespace reaper::device {
template <std::size_t N> struct Text {
  std::array<std::uint8_t, N> bytes{};
  std::size_t length = 0;
  bool assign(const std::uint8_t* data, std::size_t size) {
    if (size > N || (!data && size)) return false;
    bytes.fill(0);
    for (std::size_t i = 0; i < size; ++i) bytes[i] = data[i];
    length = size;
    return true;
  }
};
enum class Region : std::uint8_t { Unset = 0, Us = 1, Eu = 2 };
struct Settings { Region region = Region::Unset; Text<64> label{}; };
struct Snapshot { Settings settings{}; std::uint32_t revision = 0; };
struct Command { Text<75> id{}; Text<64> boot{}; std::uint32_t expected_revision = 0; Settings settings{}; };
enum class Outcome { Committed, Conflict, Rejected, Unknown };
struct Result { Outcome outcome = Outcome::Unknown; std::uint32_t revision = 0; };
enum class ReadStatus { Missing, Loaded, Failed };
enum class CommitStatus { Committed, NotCommitted, Indeterminate };
inline constexpr std::size_t kMaxRecord = 77;

// Implementations must retain the prior complete record or the next complete record.
// Committed means durably accepted; NotCommitted guarantees no change. Any ambiguous
// error MUST return Indeterminate. No auto-erase/reformat on load errors is allowed.
struct Storage {
  virtual ~Storage() = default;
  virtual ReadStatus read(std::uint8_t* output, std::size_t capacity, std::size_t& size) noexcept = 0;
  virtual CommitStatus commit(const std::uint8_t* record, std::size_t size) noexcept = 0;
};

bool encode_record(const Snapshot&, std::uint8_t*, std::size_t capacity, std::size_t& size);
bool decode_record(const std::uint8_t*, std::size_t size, Snapshot&);
bool decode_command(const protocol::Message&, Command&);

// Serialized, single-threaded authority. Board integration must own the execution
// context and allocate a new collision-resistant boot identity on each actual boot.
class Configuration {
 public:
  static constexpr std::size_t kReceiptCapacity = 32;
  static constexpr std::size_t kOwnerCapacity = 8;
  Configuration(Storage&, const Text<64>& boot);
  bool healthy() const { return healthy_; }
  bool snapshot(Snapshot& output) const;
  bool admit(const Text<64>& owner);
  Result apply(const Command& command);
  Result query(const Text<75>& id) const;
 private:
  struct Owner { bool used = false; Text<64> id{}; std::uint32_t highest = 0; };
  struct Receipt { bool used = false; Command command{}; Result result{}; };
  Storage& storage_;
  Text<64> boot_{};
  Snapshot snapshot_{};
  bool healthy_ = false;
  std::array<Owner, kOwnerCapacity> owners_{};
  std::array<Receipt, kReceiptCapacity> receipts_{};
  std::size_t next_receipt_ = 0;
  void retain(const Command&, Result);
};
} // namespace reaper::device
