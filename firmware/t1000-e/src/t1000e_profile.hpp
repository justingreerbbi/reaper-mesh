#pragma once
#include "reaper/lr1110.hpp"
namespace reaper::board {
// The owner confirmed this T1000-E is the US/915 MHz unit with its built-in antenna intact
// (2026-11-17). This is a development-unit fact, not validation of other units or a compliance
// claim.
inline constexpr bool kUsBandOwnerConfirmed = true;
inline constexpr bool kAntennaVerified = true;

// LR1110 wiring from Seeed's T1000-E reference firmware: RFSW0-RFSW3 are DIO5-DIO8. Receive uses
// RFSW0 and RFSW3, the high-power PA RFSW1 and RFSW3, the low-power PA all three, and GNSS RFSW2.
//
// TCXO: Seeed's reference code sets 3.0 V while firmware in wide use on this board sets 1.6 V. The
// lower value is used: it cannot overstress the TCXO, and if it were too low the LR1110 would
// report HF_XOSC_START and the radio would stay off with that reason shown, not transmit.
inline constexpr std::uint8_t kSw0 = 1 << 0, kSw1 = 1 << 1, kSw2 = 1 << 2, kSw3 = 1 << 3;
inline constexpr radio::Lr1110Wiring kRadioWiring{
    0x00,  // LR11XX_SYSTEM_TCXO_CTRL_1_6V
    164,   // 5 ms
    kSw0 | kSw1 | kSw2 | kSw3,
    0,                   // standby
    kSw0 | kSw3,         // receive
    kSw0 | kSw1 | kSw3,  // transmit, low-power PA
    kSw1 | kSw3,         // transmit, high-power PA
    0,                   // transmit, 2.4 GHz PA (not wired)
    kSw2,                // GNSS
    0,                   // Wi-Fi scanning
};
}  // namespace reaper::board
