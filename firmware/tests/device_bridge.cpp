#include "reaper/session.hpp"
#include <iostream>
#include <string>
#include <vector>
#include <cstring>
#include <cstdlib>

namespace p = reaper::protocol; namespace d = reaper::device;
struct Store : d::Storage {
  std::array<std::uint8_t, d::kMaxRecord> record{}; std::size_t size = 0; unsigned writes = 0; bool uncertain = false;
  d::ReadStatus read(std::uint8_t* out, std::size_t capacity, std::size_t& length) noexcept override {
    length = size; if (!size) return d::ReadStatus::Missing;
    if (size > capacity) return d::ReadStatus::Failed;
    std::memcpy(out, record.data(), size); return d::ReadStatus::Loaded;
  }
  d::CommitStatus commit(const std::uint8_t* data, std::size_t length) noexcept override {
    ++writes; if (uncertain) return d::CommitStatus::Indeterminate;
    std::memcpy(record.data(), data, length); size = length; return d::CommitStatus::Committed;
  }
};
template<std::size_t N> d::Text<N> text(const char* value) {
  d::Text<N> out; out.assign(reinterpret_cast<const std::uint8_t*>(value), std::strlen(value)); return out;
}
void print(const p::Message& message) {
  std::array<std::uint8_t, p::kMaxEncoded + 1> bytes{}; std::size_t size = 0;
  if (!p::encode_frame(message, bytes.data(), bytes.size(), size)) std::exit(3);
  constexpr char digits[] = "0123456789abcdef";
  for (std::size_t i = 0; i < size; ++i) std::cout << digits[bytes[i] >> 4] << digits[bytes[i] & 15];
}
int main(int argc, char** argv) {
  Store store; store.uncertain = argc > 1 && std::string(argv[1]) == "uncertain";
  d::Configuration authority(store, text<64>("boot-A"));
  d::MessageQueue messages(text<64>("boot-A"));
  d::RadioInfo info; info.state = text<64>("off"); info.reason = text<64>("radio-off"); info.probe = true; info.heap_free = 200000; info.stack_free = 10000;
  d::Inbox inbox;
  const bool with_inbox = argc > 1 && std::string(argv[1]) == "inbox";
  if (with_inbox) {
    const auto body = std::string(31, 'x') + "\xf0\x9f\x93\xbb" + std::string(989, 'z');
    if (!inbox.append(text<64>("node-B"), text<64>("remote_1"), 0, reinterpret_cast<const std::uint8_t*>(body.data()), body.size())) return 4;
  }
  d::Session session(authority, text<64>("device-A"), text<64>("boot-A"),
    argc > 1 && (std::string(argv[1]) == "messages" || with_inbox) ? &messages : nullptr,
    with_inbox ? &info : nullptr, with_inbox ? &inbox : nullptr);
  std::string line;
  while (std::getline(std::cin, line)) {
    if (line.size() % 2 || line.size() > 2 * (p::kMaxEncoded + 1)) return 2;
    std::vector<std::uint8_t> bytes;
    for (std::size_t i = 0; i < line.size(); i += 2) bytes.push_back(static_cast<std::uint8_t>(std::stoul(line.substr(i, 2), nullptr, 16)));
    p::Message input{}, output{};
    if (!bytes.empty() && bytes.back() == 0 && p::decode_frame(bytes.data(), bytes.size() - 1, input) && session.handle(input, output)) {
      print(output);
      if (session.take_error(output)) { std::cout << '|'; print(output); }
    } else std::cout << "NONE";
    std::cout << '\n';
  }
  std::cout << "writes=" << store.writes << '\n';
}
