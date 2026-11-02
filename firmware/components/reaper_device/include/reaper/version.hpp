#pragma once
namespace reaper::device {
#ifdef REAPER_TBEAM_V12
inline constexpr char kFirmwareVersion[] = "tbeam-usb-prototype-3";
inline constexpr char kDisplayVersion[] = "REAPER TBEAM 3";
#else
inline constexpr char kFirmwareVersion[] = "usb-prototype-8";
inline constexpr char kDisplayVersion[] = "REAPER USB 8";
#endif
}
