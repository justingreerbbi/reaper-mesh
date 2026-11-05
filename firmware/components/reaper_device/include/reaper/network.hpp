#pragma once
#include "reaper/frame.hpp"
#include "reaper/session.hpp"
// Which network this radio belongs to and the keys it holds (D50). The relay chain and device key
// live in their own flash area. The team chain is memory only, so a radio that reboots with no
// agent attached is a relay. Single serialized execution context, no allocation.
namespace reaper::device {
// Two flash sectors. Updates go to the unused one, then the old one is erased, so a power cut
// leaves one valid record and no update leaves an old key behind.
class KeySectors {
 public:
  static constexpr unsigned kSectors = 2;
  virtual bool read(unsigned sector, std::uint8_t*, std::size_t) = 0;
  virtual bool erase(unsigned sector) = 0;
  virtual bool write(unsigned sector, const std::uint8_t*, std::size_t) = 0;

 protected:
  ~KeySectors() = default;
};
class Network final : public NetworkControl {
 public:
  explicit Network(KeySectors& sectors) : sectors_(sectors) {}
  // Reads flash. A read failure leaves the radio with no network, which keeps it silent.
  void begin();
  NetworkView view() const override;
  const char* fill(std::uint32_t mode, std::uint32_t generation, std::uint32_t epoch,
                   const crypto::Key* relay_chain, const crypto::Key* device_key,
                   const crypto::Key* proof) override;
  const char* load_team(std::uint32_t generation, std::uint32_t epoch,
                        const crypto::Key& team_chain) override;
  const char* advance(std::uint32_t epoch, const crypto::Key& proof) override;
  const char* erase() override;
  // Rises whenever the keys change, so the mesh service knows to apply them.
  std::uint32_t revision() const { return revision_; }
  NetworkMode mode() const { return record_.mode; }
  bool team_loaded() const { return team_loaded_; }
  // Gives the frame link exactly the keys this radio holds. False leaves it holding none.
  bool apply(mesh::FrameLink&) const;
  // Checks a proof heard over the radio, within the link's budget. True if it was new and valid.
  bool hear_proof(std::uint16_t epoch, const crypto::Key& proof, mesh::FrameLink&,
                  std::uint64_t now);
  // Brings the link and this up to date with each other without disturbing traffic: unlike apply,
  // messages in flight carry on across an epoch change.
  void sync(mesh::FrameLink&);
  // The epoch and proof an agent asked to have announced, once.
  bool take_announcement(std::uint16_t& epoch, crypto::Key& proof);

 private:
  static constexpr std::size_t kRecordBytes = 114;
  struct Record {
    NetworkMode mode = NetworkMode::Unset;
    std::uint32_t sequence = 0;
    // The relay chain is at `epoch`, the floor. `proven` is the newest epoch with a proof seen.
    std::uint16_t generation = 0, epoch = 0, proven = 0;
    crypto::Key relay_chain{}, device_key{}, proof{};
  };
  static void encode(const Record&, std::uint8_t*);
  static bool decode(const std::uint8_t*, Record&);
  bool save(Record&);
  void forget_team();
  bool accept_proof(std::uint32_t epoch, const crypto::Key& proof);
  KeySectors& sectors_;
  Record record_{};
  crypto::Key team_chain_{}, announcement_{};
  std::uint16_t team_epoch_ = 0, announced_epoch_ = 0;
  bool team_loaded_ = false, healthy_ = false, announce_ = false;
  int active_ = -1;
  std::uint32_t revision_ = 0;
};
}  // namespace reaper::device
