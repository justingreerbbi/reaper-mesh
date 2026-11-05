#pragma once
#include <array>
#include <cstddef>
#include <cstdint>
// Boards use mbedTLS (crypto_mbedtls.cpp). Host tests link firmware/tests/crypto_host instead, and
// both must match the vectors in packages/protocol/fixtures/frame-v2.json. Every function fails
// closed: on false, output must not be used.
namespace reaper::crypto {
inline constexpr std::size_t kKeyBytes = 32, kCcmNonceBytes = 13, kCcmTagBytes = 8;
using Key = std::array<std::uint8_t, kKeyBytes>;
struct Slice {
  const std::uint8_t* data = nullptr;
  std::size_t size = 0;
};
bool hmac_sha256(const std::uint8_t* key, std::size_t key_size, const Slice* parts,
                 std::size_t count, Key& out);
bool aes256_ccm_seal(const Key& key, const std::uint8_t* nonce, const std::uint8_t* aad,
                     std::size_t aad_size, const std::uint8_t* plain, std::size_t size,
                     std::uint8_t* cipher, std::uint8_t* tag);
// False on any authentication failure. Wipe `plain` then, and never read it.
bool aes256_ccm_open(const Key& key, const std::uint8_t* nonce, const std::uint8_t* aad,
                     std::size_t aad_size, const std::uint8_t* cipher, std::size_t size,
                     std::uint8_t* plain, const std::uint8_t* tag);
// Takes the same time wherever the bytes differ.
inline bool equal(const std::uint8_t* a, const std::uint8_t* b, std::size_t size) {
  std::uint8_t difference = 0;
  for (std::size_t i = 0; i < size; ++i)
    difference = static_cast<std::uint8_t>(difference | (a[i] ^ b[i]));
  return difference == 0;
}
inline void wipe(void* data, std::size_t size) {
  auto* bytes = static_cast<volatile std::uint8_t*>(data);
  for (std::size_t i = 0; i < size; ++i)
    bytes[i] = 0;
}
}  // namespace reaper::crypto
