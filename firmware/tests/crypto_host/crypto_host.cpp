// Test-only crypto for host builds, which have no ESP-IDF. Never linked into firmware: boards use
// mbedTLS. tests/simulator/frame-cpp.test.ts checks this against Node's crypto.
#include "reaper/crypto.hpp"
#include <cstring>
namespace reaper::crypto {
namespace {
constexpr std::uint32_t kRound[64] = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2};
std::uint32_t rotate(std::uint32_t value, unsigned bits) {
  return (value >> bits) | (value << (32 - bits));
}
class Sha256 {
 public:
  void update(const std::uint8_t* data, std::size_t size) {
    total_ += size;
    for (std::size_t i = 0; i < size; ++i) {
      block_[used_++] = data[i];
      if (used_ == block_.size()) {
        compress();
        used_ = 0;
      }
    }
  }
  void finish(Key& out) {
    const std::uint64_t bits = total_ * 8;
    const std::uint8_t one = 0x80, zero = 0;
    update(&one, 1);
    while (used_ != 56)
      update(&zero, 1);
    for (int shift = 56; shift >= 0; shift -= 8) {
      const auto byte = static_cast<std::uint8_t>(bits >> shift);
      update(&byte, 1);
    }
    for (std::size_t i = 0; i < 8; ++i)
      for (std::size_t j = 0; j < 4; ++j)
        out[i * 4 + j] = static_cast<std::uint8_t>(state_[i] >> (24 - j * 8));
  }

 private:
  void compress() {
    std::array<std::uint32_t, 64> w{};
    for (std::size_t i = 0; i < 16; ++i)
      w[i] = std::uint32_t(block_[i * 4]) << 24 | std::uint32_t(block_[i * 4 + 1]) << 16 |
             std::uint32_t(block_[i * 4 + 2]) << 8 | block_[i * 4 + 3];
    for (std::size_t i = 16; i < 64; ++i) {
      const auto s0 = rotate(w[i - 15], 7) ^ rotate(w[i - 15], 18) ^ (w[i - 15] >> 3);
      const auto s1 = rotate(w[i - 2], 17) ^ rotate(w[i - 2], 19) ^ (w[i - 2] >> 10);
      w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    auto s = state_;
    for (std::size_t i = 0; i < 64; ++i) {
      const auto t1 = s[7] + (rotate(s[4], 6) ^ rotate(s[4], 11) ^ rotate(s[4], 25)) +
                      ((s[4] & s[5]) ^ (~s[4] & s[6])) + kRound[i] + w[i];
      const auto t2 = (rotate(s[0], 2) ^ rotate(s[0], 13) ^ rotate(s[0], 22)) +
                      ((s[0] & s[1]) ^ (s[0] & s[2]) ^ (s[1] & s[2]));
      s = {t1 + t2, s[0], s[1], s[2], s[3] + t1, s[4], s[5], s[6]};
    }
    for (std::size_t i = 0; i < 8; ++i)
      state_[i] += s[i];
  }
  std::array<std::uint32_t, 8> state_{0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
                                      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};
  std::array<std::uint8_t, 64> block_{};
  std::size_t used_ = 0;
  std::uint64_t total_ = 0;
};
using Block = std::array<std::uint8_t, 16>;
std::uint8_t twice(std::uint8_t value) {
  return static_cast<std::uint8_t>((value << 1) ^ ((value & 0x80) ? 0x1b : 0));
}
std::uint8_t multiply(std::uint8_t a, std::uint8_t b) {
  std::uint8_t result = 0;
  for (; b; b >>= 1, a = twice(a))
    if (b & 1)
      result ^= a;
  return result;
}
// Builds the S-box from its definition: the field inverse followed by the affine transform.
std::array<std::uint8_t, 256> sbox() {
  std::array<std::uint8_t, 256> box{};
  for (unsigned i = 0; i < 256; ++i) {
    std::uint8_t inverse = 0;
    for (unsigned j = 1; i && j < 256; ++j)
      if (multiply(static_cast<std::uint8_t>(i), static_cast<std::uint8_t>(j)) == 1)
        inverse = static_cast<std::uint8_t>(j);
    std::uint8_t value = 0x63;
    for (unsigned shift = 0; shift < 5; ++shift)
      value ^= static_cast<std::uint8_t>((inverse << shift) | (inverse >> (8 - shift)));
    box[i] = value;
  }
  return box;
}
class Aes256 {
 public:
  explicit Aes256(const Key& key) {
    std::memcpy(schedule_.data(), key.data(), key.size());
    std::uint8_t round = 1;
    for (std::size_t i = 32; i < schedule_.size(); i += 4) {
      std::array<std::uint8_t, 4> word{schedule_[i - 4], schedule_[i - 3], schedule_[i - 2],
                                       schedule_[i - 1]};
      if (i % 32 == 0) {
        word = {box()[word[1]], box()[word[2]], box()[word[3]], box()[word[0]]};
        word[0] ^= round;
        round = twice(round);
      } else if (i % 32 == 16) {
        for (auto& byte : word)
          byte = box()[byte];
      }
      for (std::size_t j = 0; j < 4; ++j)
        schedule_[i + j] = schedule_[i + j - 32] ^ word[j];
    }
  }
  Block encrypt(Block state) const {
    add(state, 0);
    for (std::size_t round = 1; round <= 14; ++round) {
      Block next{};
      for (std::size_t i = 0; i < 16; ++i)
        next[i] = box()[state[(i + (i % 4) * 4) % 16]];
      state = next;
      if (round != 14)
        for (std::size_t c = 0; c < 4; ++c) {
          const auto* in = next.data() + c * 4;
          state[c * 4] = twice(in[0]) ^ twice(in[1]) ^ in[1] ^ in[2] ^ in[3];
          state[c * 4 + 1] = in[0] ^ twice(in[1]) ^ twice(in[2]) ^ in[2] ^ in[3];
          state[c * 4 + 2] = in[0] ^ in[1] ^ twice(in[2]) ^ twice(in[3]) ^ in[3];
          state[c * 4 + 3] = twice(in[0]) ^ in[0] ^ in[1] ^ in[2] ^ twice(in[3]);
        }
      add(state, round);
    }
    return state;
  }

 private:
  static const std::array<std::uint8_t, 256>& box() {
    static const auto table = sbox();
    return table;
  }
  void add(Block& state, std::size_t round) const {
    for (std::size_t i = 0; i < 16; ++i)
      state[i] ^= schedule_[round * 16 + i];
  }
  std::array<std::uint8_t, 240> schedule_{};
};
// RFC 3610 with a 13-byte nonce, a 2-byte length field and an 8-byte tag.
Block ccm_mac(const Aes256& aes, const std::uint8_t* nonce, const std::uint8_t* aad,
              std::size_t aad_size, const std::uint8_t* plain, std::size_t size) {
  Block mac{};
  mac[0] = static_cast<std::uint8_t>((aad_size ? 0x40 : 0) | (3 << 3) | 1);
  std::memcpy(mac.data() + 1, nonce, kCcmNonceBytes);
  mac[14] = static_cast<std::uint8_t>(size >> 8);
  mac[15] = static_cast<std::uint8_t>(size);
  mac = aes.encrypt(mac);
  std::size_t used = 0;
  const auto absorb = [&](std::uint8_t byte) {
    mac[used++] ^= byte;
    if (used == mac.size()) {
      mac = aes.encrypt(mac);
      used = 0;
    }
  };
  if (aad_size) {
    absorb(static_cast<std::uint8_t>(aad_size >> 8));
    absorb(static_cast<std::uint8_t>(aad_size));
    for (std::size_t i = 0; i < aad_size; ++i)
      absorb(aad[i]);
    if (used) {
      mac = aes.encrypt(mac);
      used = 0;
    }
  }
  for (std::size_t i = 0; i < size; ++i)
    absorb(plain[i]);
  if (used)
    mac = aes.encrypt(mac);
  return mac;
}
Block ccm_stream(const Aes256& aes, const std::uint8_t* nonce, std::uint16_t counter) {
  Block block{};
  block[0] = 1;
  std::memcpy(block.data() + 1, nonce, kCcmNonceBytes);
  block[14] = static_cast<std::uint8_t>(counter >> 8);
  block[15] = static_cast<std::uint8_t>(counter);
  return aes.encrypt(block);
}
void ccm_crypt(const Aes256& aes, const std::uint8_t* nonce, const std::uint8_t* in,
               std::size_t size, std::uint8_t* out) {
  for (std::size_t i = 0; i < size; i += 16) {
    const auto stream = ccm_stream(aes, nonce, static_cast<std::uint16_t>(i / 16 + 1));
    for (std::size_t j = 0; j < 16 && i + j < size; ++j)
      out[i + j] = in[i + j] ^ stream[j];
  }
}
}  // namespace
bool hmac_sha256(const std::uint8_t* key, std::size_t key_size, const Slice* parts,
                 std::size_t count, Key& out) {
  if (!key)
    return false;
  std::array<std::uint8_t, 64> pad{};
  if (key_size > pad.size()) {
    Sha256 digest;
    digest.update(key, key_size);
    Key hashed{};
    digest.finish(hashed);
    std::memcpy(pad.data(), hashed.data(), hashed.size());
  } else {
    std::memcpy(pad.data(), key, key_size);
  }
  for (auto& byte : pad)
    byte ^= 0x36;
  Sha256 inner;
  inner.update(pad.data(), pad.size());
  for (std::size_t i = 0; i < count; ++i)
    inner.update(parts[i].data, parts[i].size);
  Key middle{};
  inner.finish(middle);
  for (auto& byte : pad)
    byte ^= 0x36 ^ 0x5c;
  Sha256 outer;
  outer.update(pad.data(), pad.size());
  outer.update(middle.data(), middle.size());
  outer.finish(out);
  return true;
}
bool aes256_ccm_seal(const Key& key, const std::uint8_t* nonce, const std::uint8_t* aad,
                     std::size_t aad_size, const std::uint8_t* plain, std::size_t size,
                     std::uint8_t* cipher, std::uint8_t* tag) {
  const Aes256 aes(key);
  const auto mac = ccm_mac(aes, nonce, aad, aad_size, plain, size);
  const auto first = ccm_stream(aes, nonce, 0);
  for (std::size_t i = 0; i < kCcmTagBytes; ++i)
    tag[i] = mac[i] ^ first[i];
  ccm_crypt(aes, nonce, plain, size, cipher);
  return true;
}
bool aes256_ccm_open(const Key& key, const std::uint8_t* nonce, const std::uint8_t* aad,
                     std::size_t aad_size, const std::uint8_t* cipher, std::size_t size,
                     std::uint8_t* plain, const std::uint8_t* tag) {
  const Aes256 aes(key);
  ccm_crypt(aes, nonce, cipher, size, plain);
  const auto mac = ccm_mac(aes, nonce, aad, aad_size, plain, size);
  const auto first = ccm_stream(aes, nonce, 0);
  std::array<std::uint8_t, kCcmTagBytes> expected{};
  for (std::size_t i = 0; i < expected.size(); ++i)
    expected[i] = mac[i] ^ first[i];
  return equal(expected.data(), tag, expected.size());
}
}  // namespace reaper::crypto
