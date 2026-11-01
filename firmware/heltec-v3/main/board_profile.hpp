#pragma once
namespace reaper::board {
// Owner confirms this development board is the US model and the supplied
// US/915 MHz antenna is attached (2026-11-01). This is a development-board
// fact, not automatic validation of other hardware or a compliance claim.
inline constexpr bool kUsBandOwnerConfirmed = true;
inline constexpr bool kAntennaVerified = true;
}
