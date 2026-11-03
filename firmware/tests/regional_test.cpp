#include "reaper/regional.hpp"
#include <iostream>
#include <limits>
namespace m = reaper::mesh;
#define CHECK(v)                                              \
  do {                                                        \
    if (!(v)) {                                               \
      std::cerr << "line " << __LINE__ << ": " << #v << '\n'; \
      return 1;                                               \
    }                                                         \
  } while (false)
int main() {
  CHECK(m::airtime_us(214) == 84544);
  CHECK(m::airtime_us(54) == 25664);
  CHECK(m::airtime_us(0) == 0 && m::airtime_us(255) == 0);
  auto slow = m::kUs915Lab1;
  slow.spreading_factor = 12;
  slow.bandwidth_hz = 125000;
  CHECK(m::airtime_us(214, slow) > 7000000);
  slow.bandwidth_hz = 123;
  CHECK(m::airtime_us(214, slow) == 0);
  m::AirtimeBudget budget;
  for (unsigned i = 0; i < 11; ++i)
    CHECK(budget.reserve(0, m::airtime_us(214)));
  CHECK(!budget.reserve(0, m::airtime_us(214)));
  CHECK(budget.available(1000) == 80016);
  CHECK(budget.reserve(2000, m::airtime_us(214)));
  CHECK(!budget.reserve(1999, 1));
  CHECK(budget.available(std::numeric_limits<std::uint64_t>::max()) == 1000000);
  CHECK(budget.reserve(std::numeric_limits<std::uint64_t>::max(), 1000000));
  CHECK(!budget.reserve(std::numeric_limits<std::uint64_t>::max(), 1));
  std::cout << "ok regional\n";
}
