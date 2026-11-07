# Embedded protocol foundation

This directory contains the portable C++17 protocol/configuration/session components and the target-built ESP-IDF board applications (Heltec V3 and T-Beam V1.2). Installed builds and hardware verification are tracked in [Status](../docs/overview/status.md); see [first flash and recovery](../docs/guides/first-flash.md) for the original bring-up.
`components/reaper_protocol/` implements the draft USB envelope and typed TLV payloads with fixed-size arrays, caller-owned output buffers, and no heap allocation in codec code. `schema.generated.hpp` comes from the same `packages/protocol/schema.json` as the TypeScript declarations. Never hand-edit the generated header. Field index constants are zero-based; wire field tags are one-based.

## Layout

| Path | Contents |
| --- | --- |
| `components/` | Portable components shared by every board and by host tests |
| `app/` | Shared board application: `main.cpp`, NVS storage, mesh service, Bluetooth link, device UI, and the `radio_bus.hpp`, `status_display.hpp`, `board_input.hpp` and `board_power.hpp` interfaces |
| `heltec-v3/`, `tbeam-v12/` | One ESP-IDF project per board: `main/` holds the board profile (`board_profile.hpp` or `tbeam_profile.hpp`) and the board's implementations of those interfaces; its `CMakeLists.txt` compiles them together with `app/` |
| `tests/` | Host tests and stubs for the standalone CMake/CTest build |

Board differences that remain inside `app/` are selected with `REAPER_TBEAM_V12`. A new board gets its own project folder with a profile and the board implementations; it should not need to copy `app/`.

## Build and test

```sh
npm ci --ignore-scripts
npm run check
```

The host suite requires a C++17 compiler (`c++` on PATH, or set `CXX` to one compiler executable). It compiles with strict warnings and UBSan. Linux also enables ASan. On this macOS host AppleClang ASan startup stalled, including outside the sandbox; its results are unverified. macOS defaults to UBSan and can opt into a working ASan runtime with `REAPER_ASAN=1`. Compiler/test subprocesses have bounded timeouts; sanitizer errors are fatal.

An independent regular host build is available:

```sh
cmake -S firmware -B build/host-protocol
cmake --build build/host-protocol
ctest --test-dir build/host-protocol --output-on-failure
build/host-protocol/codec_bridge selftest
```

The CLI bridge allocates host input/output storage; it is excluded from codec allocation claims and is not intended for untrusted hardware input. The CMake project only builds the host library/bridge. CI runs compiler-backed tests through `npm run check`, this CTest suite separately, and both ESP-IDF target builds; the host suite requires no firmware SDK.

## Contracts and limits

- Envelope limits match the web implementation: 2,048-byte payload, 2,058-byte raw envelope, 2,067-byte encoded frame plus a zero delimiter.
- Generated descriptors supply message/field tags, validation kinds, optionality, and maximum field count. Semantic kind rules match the documented TypeScript contract and are tested across languages.
- `decode_payload` and `decode_frame` update the caller's message only on success. Partial/invalid fields must never reach device state.
- Encoders report failure with output length zero; ignore partially written output on failure. `encode_frame` requires at least a 2,068-byte caller buffer regardless of actual encoded size.
- A decoded `Message` owns copied scalar/text fields. Text has explicit byte lengths and is not null-terminated; no serial-buffer pointers are retained.
- Stream callbacks receive a temporary const message valid only during the callback. Copy into a bounded queue if needed. Calls are single-threaded and non-reentrant; the board adapter must synchronize access and reset framing on connection changes.
- Measured on the macOS arm64 host ABI: `sizeof(Message)=1,448`, `sizeof(FrameDecoder)=2,088` bytes. Nested calls also consume stack scratch storage. These are not ESP32 measurements; choose task-stack/queue budgets after target compilation and measurement.

`packages/protocol/fixtures/messages-v1.json` freezes examples of the message types, including capability metadata and boundary counters. Generation does not rewrite these fixtures. Change them only through an explicit reviewed protocol-version decision, not to make failing tests green. Cross-language tests cover optional/unknown/reordered fields, truncation, bit corruption, invalid Unicode/IDs, overflow, framing recovery, and seeded malformed traffic. They do not establish released firmware compatibility because none exists yet.

## Qualification still required

The board adapter, atomic NVS authority, independent mesh core and both radio drivers are implemented, and two-board delivery passes on hardware. Three-node relays, range, RF coexistence, interrupted flash/power loss and extended field soak remain qualification gates. No simulation substitutes for these measurements. See [Status](../docs/overview/status.md).

## Target build

Run `bash tools/bootstrap-esp-idf.sh`, then `bash tools/build-firmware.sh` from the repository root. The pinned SDK/tools and build artifacts are ignored. Review build/heltec-v3/reaper-manifest.json and [Flashing firmware](../docs/guides/flashing-firmware.md) before any hardware write. The Heltec app uses UART0 GPIO43/44 at 115200, initializes the status OLED and probes SX1262 over bounded DMA-backed SPI. Radio is off by default; explicit mesh mode requires the confirmed US band/antenna facts and a chosen network. The partition table has two application slots and the application runs from the first; OTA updates and rollback are not implemented.

## Device screen and buttons

Both boards share the screen pages, button gestures and SSD1306 driver in `app/`. See
[device screen and buttons](../docs/reference/device-display.md) for the design, board pins and
code map.
