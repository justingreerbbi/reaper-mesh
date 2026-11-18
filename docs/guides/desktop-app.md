# Desktop app

The Reaper Mesh desktop app is the [web portal](web-portal.md) and the
[firmware installer](flashing-firmware.md) as an app for macOS, Windows and Linux. It talks to your
radio over USB directly, so it needs no particular browser. It is the same portal, built from the
same code, so everything the portal does works the same way (D58).

## Download and install

Get it from the [download page](https://reapermesh.com/download/), which always links to the newest
[release](https://github.com/justingreerbbi/reaper-mesh/releases).

| System | File | Requirements |
| --- | --- | --- |
| macOS | `Reaper-Mesh-macOS.dmg` | macOS 11 or later, Apple silicon or Intel |
| Windows | `Reaper-Mesh-Windows-x64-setup.exe` | 64-bit Windows 10 or later. The installer adds Microsoft WebView2 if it is missing |
| Linux | `Reaper-Mesh-Linux-x86_64.AppImage`, or `Reaper-Mesh-Linux-amd64.deb` for Ubuntu and Debian | 64-bit, with WebKitGTK 4.1 (Ubuntu 22.04 or later) |

> [!NOTE]
> The app is not signed by Apple or Microsoft yet, so the first launch asks for permission:
>
> - **macOS:** if it says it can't check the app, open **System Settings → Privacy & Security** and
>   choose **Open Anyway**.
> - **Windows:** on "Windows protected your PC", choose **More info**, then **Run anyway**.
> - **Linux:** make the AppImage executable (`chmod +x`) and run it. To open USB ports without
>   sudo, add yourself to the `dialout` group (`sudo usermod -aG dialout $USER`) and log in again.

## Using it

- The window opens on the **portal**. Choose **Connect over USB**; the app shows its own list of USB
  ports instead of the browser's.
- **Go → Install Firmware** (⌘2 or Ctrl+2) opens the installer, and **Go → Web Portal** (⌘1 or
  Ctrl+1) returns. The installer installs every [supported board](../boards/README.md) as it does in a
  browser, including the T1000-E without any special mode.
- Links to the website and other sites open in your normal browser.
- Settings exports and firmware downloads are saved to your **Downloads** folder.
- The app keeps its own messages, settings and team keys, separate from any browser's. To move a
  team, export it from one and import it in the other, as between browsers.

**Not in the desktop app yet:** Bluetooth. Connect over USB, or use the portal in Chrome or Edge for
Bluetooth. Automatic updates are not built either; download a new release when one comes out.

## How it works

The app is built with [Tauri 2](https://tauri.app/): the portal runs in the system's own web view
(WebKit on macOS, WebView2 on Windows, WebKitGTK on Linux) and a small Rust program provides what
those web views lack.

| Piece | Where | What it does |
| --- | --- | --- |
| Pages | `dist/desktop/` | The portal (`web/`) and installer (`flash/`) exactly as the website serves them, with the firmware the site build published (`tools/build-desktop.ts`) |
| Web Serial shim | `agents/desktop/serial-shim.ts` | Injected before each page's own scripts. It provides the standard `navigator.serial` API on top of the Rust serial commands, so the portal, `packages/agent-core` and the installer run unchanged |
| Serial bridge | `agents/desktop/src-tauri/src/serial.rs` | Lists USB serial ports, opens them, reads, writes and sets DTR and RTS, through the `serialport` crate |
| Window and menu | `agents/desktop/src-tauri/src/main.rs` | The window, the Go menu, keeping navigation on the app's pages, and downloads |

The page can only call the five serial commands and Tauri's core channel features
(`capabilities/default.json`), and its content security policy allows scripts only from the app
itself, plus the map's tile server for images.

## Build it yourself

You need the [project tools](../contributing/development.md), Rust (rustup installs the version
pinned in `agents/desktop/src-tauri/rust-toolchain.toml`) and each system's build tools:

| System | Install first |
| --- | --- |
| macOS | Xcode Command Line Tools (`xcode-select --install`) |
| Windows | Visual Studio Build Tools with **Desktop development with C++**, and Node.js. WebView2 is part of Windows 10 and 11 |
| Ubuntu | `sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libudev-dev build-essential` |

Then, from the repository root:

```bash
npm ci --ignore-scripts
```

Build the site, which also brings in any firmware you have built. Add `--allow-dirty` to use local
firmware builds from uncommitted changes:

```bash
npm run build:web && npm run build:flasher && node tools/build-site.ts --allow-dirty
```

Run the app while developing (rebuilds the Rust side as it changes):

```bash
npm run desktop:dev
```

Or build the installable app for this system:

```bash
npm run desktop:build
```

The result is in `agents/desktop/src-tauri/target/release/bundle/`: `macos/Reaper Mesh.app` and a
`.dmg` on macOS, an NSIS `-setup.exe` on Windows, and an AppImage and `.deb` on Linux. Release builds
for all three systems come from GitHub Actions; see [Releases](../contributing/releases.md).
