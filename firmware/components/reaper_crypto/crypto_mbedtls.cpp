#include "reaper/crypto.hpp"
#include "mbedtls/ccm.h"
#include "mbedtls/md.h"
namespace reaper::crypto {
bool hmac_sha256(const std::uint8_t* key, std::size_t key_size, const Slice* parts,
                 std::size_t count, Key& out) {
  const auto* info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if (!info || !key)
    return false;
  mbedtls_md_context_t context;
  mbedtls_md_init(&context);
  bool ok = mbedtls_md_setup(&context, info, 1) == 0 &&
            mbedtls_md_hmac_starts(&context, key, key_size) == 0;
  for (std::size_t i = 0; ok && i < count; ++i)
    ok = mbedtls_md_hmac_update(&context, parts[i].data, parts[i].size) == 0;
  ok = ok && mbedtls_md_hmac_finish(&context, out.data()) == 0;
  mbedtls_md_free(&context);
  return ok;
}
bool aes256_ccm_seal(const Key& key, const std::uint8_t* nonce, const std::uint8_t* aad,
                     std::size_t aad_size, const std::uint8_t* plain, std::size_t size,
                     std::uint8_t* cipher, std::uint8_t* tag) {
  mbedtls_ccm_context context;
  mbedtls_ccm_init(&context);
  const bool ok = mbedtls_ccm_setkey(&context, MBEDTLS_CIPHER_ID_AES, key.data(), 256) == 0 &&
                  mbedtls_ccm_encrypt_and_tag(&context, size, nonce, kCcmNonceBytes, aad, aad_size,
                                              plain, cipher, tag, kCcmTagBytes) == 0;
  mbedtls_ccm_free(&context);
  return ok;
}
bool aes256_ccm_open(const Key& key, const std::uint8_t* nonce, const std::uint8_t* aad,
                     std::size_t aad_size, const std::uint8_t* cipher, std::size_t size,
                     std::uint8_t* plain, const std::uint8_t* tag) {
  mbedtls_ccm_context context;
  mbedtls_ccm_init(&context);
  const bool ok = mbedtls_ccm_setkey(&context, MBEDTLS_CIPHER_ID_AES, key.data(), 256) == 0 &&
                  mbedtls_ccm_auth_decrypt(&context, size, nonce, kCcmNonceBytes, aad, aad_size,
                                           cipher, plain, tag, kCcmTagBytes) == 0;
  mbedtls_ccm_free(&context);
  return ok;
}
}  // namespace reaper::crypto
