#pragma once
namespace reaper::device {
// Firmware images are named {device}-reaper-mesh-v{semver} (decision D8). 0.x is pre-release.
#ifdef REAPER_TBEAM_V12
inline constexpr char kFirmwareVersion[] = "tbeam-reaper-mesh-v0.1.0";
#else
inline constexpr char kFirmwareVersion[] = "heltec-reaper-mesh-v0.1.0";
#endif
// Short form shown in the corner of the device screen.
inline constexpr char kDisplayVersion[] = "v0.1.0";
}  // namespace reaper::device
