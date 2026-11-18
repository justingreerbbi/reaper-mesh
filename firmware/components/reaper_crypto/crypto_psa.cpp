#include "reaper/crypto.hpp"
#include <psa/crypto.h>
// The Zephyr boards' backend (T1000-E). Zephyr's mbedTLS offers only the PSA Crypto API, so this
// computes what crypto_mbedtls.cpp does through it. Both must match
// packages/protocol/fixtures/frame-v2.json; keys are volatile and destroyed after each call.
namespace reaper::crypto {
namespace {
constexpr psa_algorithm_t kCcm =
    PSA_ALG_AEAD_WITH_SHORTENED_TAG(PSA_ALG_CCM, static_cast<std::uint32_t>(kCcmTagBytes));
bool ready() {
  static const bool initialized = psa_crypto_init() == PSA_SUCCESS;
  return initialized;
}
// A volatile key that only exists for one operation.
class TempKey {
 public:
  TempKey(psa_key_type_t type, psa_algorithm_t algorithm, psa_key_usage_t usage,
          const std::uint8_t* bytes, std::size_t size) {
    psa_key_attributes_t attributes = PSA_KEY_ATTRIBUTES_INIT;
    psa_set_key_type(&attributes, type);
    psa_set_key_algorithm(&attributes, algorithm);
    psa_set_key_usage_flags(&attributes, usage);
    psa_set_key_bits(&attributes, size * 8);
    ok_ = ready() && psa_import_key(&attributes, bytes, size, &id_) == PSA_SUCCESS;
    psa_reset_key_attributes(&attributes);
  }
  ~TempKey() {
    if (ok_)
      psa_destroy_key(id_);
  }
  TempKey(const TempKey&) = delete;
  TempKey& operator=(const TempKey&) = delete;
  bool ok() const { return ok_; }
  psa_key_id_t id() const { return id_; }

 private:
  psa_key_id_t id_ = PSA_KEY_ID_NULL;
  bool ok_ = false;
};
}  // namespace
bool hmac_sha256(const std::uint8_t* key, std::size_t key_size, const Slice* parts,
                 std::size_t count, Key& out) {
  if (!key || !key_size)
    return false;
  const auto algorithm = PSA_ALG_HMAC(PSA_ALG_SHA_256);
  TempKey handle(PSA_KEY_TYPE_HMAC, algorithm, PSA_KEY_USAGE_SIGN_MESSAGE, key, key_size);
  if (!handle.ok())
    return false;
  psa_mac_operation_t operation = PSA_MAC_OPERATION_INIT;
  bool ok = psa_mac_sign_setup(&operation, handle.id(), algorithm) == PSA_SUCCESS;
  for (std::size_t i = 0; ok && i < count; ++i)
    ok = psa_mac_update(&operation, parts[i].data, parts[i].size) == PSA_SUCCESS;
  std::size_t length = 0;
  ok = ok && psa_mac_sign_finish(&operation, out.data(), out.size(), &length) == PSA_SUCCESS &&
       length == out.size();
  if (!ok) {
    psa_mac_abort(&operation);
    wipe(out.data(), out.size());
  }
  return ok;
}
bool aes256_ccm_seal(const Key& key, const std::uint8_t* nonce, const std::uint8_t* aad,
                     std::size_t aad_size, const std::uint8_t* plain, std::size_t size,
                     std::uint8_t* cipher, std::uint8_t* tag) {
  TempKey handle(PSA_KEY_TYPE_AES, kCcm, PSA_KEY_USAGE_ENCRYPT, key.data(), key.size());
  if (!handle.ok())
    return false;
  // One-shot PSA AEAD writes the tag after the ciphertext; the frame keeps them apart.
  psa_aead_operation_t operation = PSA_AEAD_OPERATION_INIT;
  std::size_t written = 0, finished = 0, tag_size = 0;
  bool ok = psa_aead_encrypt_setup(&operation, handle.id(), kCcm) == PSA_SUCCESS &&
            psa_aead_set_lengths(&operation, aad_size, size) == PSA_SUCCESS &&
            psa_aead_set_nonce(&operation, nonce, kCcmNonceBytes) == PSA_SUCCESS &&
            psa_aead_update_ad(&operation, aad, aad_size) == PSA_SUCCESS &&
            psa_aead_update(&operation, plain, size, cipher, size, &written) == PSA_SUCCESS &&
            psa_aead_finish(&operation, cipher + written, size - written, &finished, tag,
                            kCcmTagBytes, &tag_size) == PSA_SUCCESS &&
            written + finished == size && tag_size == kCcmTagBytes;
  if (!ok)
    psa_aead_abort(&operation);
  return ok;
}
bool aes256_ccm_open(const Key& key, const std::uint8_t* nonce, const std::uint8_t* aad,
                     std::size_t aad_size, const std::uint8_t* cipher, std::size_t size,
                     std::uint8_t* plain, const std::uint8_t* tag) {
  TempKey handle(PSA_KEY_TYPE_AES, kCcm, PSA_KEY_USAGE_DECRYPT, key.data(), key.size());
  if (!handle.ok())
    return false;
  psa_aead_operation_t operation = PSA_AEAD_OPERATION_INIT;
  std::size_t written = 0, finished = 0;
  bool ok = psa_aead_decrypt_setup(&operation, handle.id(), kCcm) == PSA_SUCCESS &&
            psa_aead_set_lengths(&operation, aad_size, size) == PSA_SUCCESS &&
            psa_aead_set_nonce(&operation, nonce, kCcmNonceBytes) == PSA_SUCCESS &&
            psa_aead_update_ad(&operation, aad, aad_size) == PSA_SUCCESS &&
            psa_aead_update(&operation, cipher, size, plain, size, &written) == PSA_SUCCESS &&
            psa_aead_verify(&operation, plain + written, size - written, &finished, tag,
                            kCcmTagBytes) == PSA_SUCCESS &&
            written + finished == size;
  if (!ok) {
    psa_aead_abort(&operation);
    wipe(plain, size);
  }
  return ok;
}
}  // namespace reaper::crypto
