#pragma once
namespace reaper::board {
// Heltec Wireless Stick Lite V3. The owner has not yet confirmed that this unit is the US model or
// that a US/915 MHz antenna is attached, so the radio cannot transmit until both are set true
// here. Receive and the startup probe still work. This is a development-board fact, not automatic
// validation of other hardware or a compliance claim.
inline constexpr bool kUsBandOwnerConfirmed = false;
inline constexpr bool kAntennaVerified = false;
}  // namespace reaper::board
