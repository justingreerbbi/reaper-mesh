#pragma once
namespace reaper::device {
// Firmware images are named {device}-reaper-mesh-v{semver} (decision D8). 0.x is pre-release.
// The desk relay test build says so in its name, so it can't be mistaken for normal firmware.
#ifdef REAPER_TEST_RELAYED_ONLY
#define REAPER_FIRMWARE_SUFFIX "-relay-test"
#else
#define REAPER_FIRMWARE_SUFFIX ""
#endif
#if defined(REAPER_TBEAM_V12)
inline constexpr char kFirmwareVersion[] = "tbeam-reaper-mesh-v0.11.1" REAPER_FIRMWARE_SUFFIX;
#elif defined(REAPER_HELTEC_STICK_V3)
inline constexpr char kFirmwareVersion[] =
    "heltec-stick-reaper-mesh-v0.11.1" REAPER_FIRMWARE_SUFFIX;
#else
inline constexpr char kFirmwareVersion[] = "heltec-reaper-mesh-v0.11.1" REAPER_FIRMWARE_SUFFIX;
#endif
// Short form shown in the corner of the device screen.
inline constexpr char kDisplayVersion[] = "v0.11.1";
}  // namespace reaper::device
