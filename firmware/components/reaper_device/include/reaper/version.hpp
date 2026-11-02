#pragma once
namespace reaper::device {
#ifdef REAPER_TBEAM_V12
inline constexpr char kFirmwareVersion[] = "tbeam-usb-prototype-1";
inline constexpr char kDisplayVersion[] = "REAPER TBEAM 1";
#else
inline constexpr char kFirmwareVersion[] = "usb-prototype-6";
inline constexpr char kDisplayVersion[] = "REAPER USB 6";
#endif
}
