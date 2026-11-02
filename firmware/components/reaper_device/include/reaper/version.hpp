#pragma once
namespace reaper::device {
#ifdef REAPER_TBEAM_V12
inline constexpr char kFirmwareVersion[] = "tbeam-usb-prototype-2";
inline constexpr char kDisplayVersion[] = "REAPER TBEAM 2";
#else
inline constexpr char kFirmwareVersion[] = "usb-prototype-7";
inline constexpr char kDisplayVersion[] = "REAPER USB 7";
#endif
}
