# Releases

A release is one version number for everything that ships together: the firmware for every board,
the desktop app for macOS, Windows and Linux, and the web portal and installer the website serves.
Releases are published on [GitHub](https://github.com/justingreerbbi/reaper-mesh/releases), and the
website's [download page](https://reapermesh.com/download/) always links to the newest one.

Nothing is released until the owner says so: pushing a version tag is what starts it.

## Cut a release

1. **Write the changelog.** Every change since the last release should be under
   `## Unreleased` in [the changelog](../overview/changelog.md), with what was and was not verified on
   hardware.
2. **Set the version** on a branch, for example `release/v0.12.0`. This writes it into the firmware
   (`version.hpp`), the desktop app (`tauri.conf.json`, `Cargo.toml`, `Cargo.lock`) and
   `package.json`, and turns the Unreleased section into `## v0.12.0 — date` under a new empty one:

   ```bash
   node tools/release-version.ts set 0.12.0
   ```

3. **Review, commit and merge** the change (`chore(release): v0.12.0`) through a pull request, as
   usual.
4. **Tag the merge commit on main and push the tag.** This starts the release:

   ```bash
   git tag -s v0.12.0 -m "Reaper Mesh v0.12.0"
   ```

   ```bash
   git push origin v0.12.0
   ```

5. **Watch** Actions → **Release**. It takes about 30 minutes. When it finishes, the release is on
   GitHub and the download page's buttons fetch it.

Before core v1, versions stay at `0.x` (D42). Bump the minor version for anything that needs boards
updated together, and the patch version for the rest.

## What the release workflow does

`.github/workflows/release.yml` runs on a pushed `v1.2.3` tag, or by hand from a tag (Actions →
Release → Run workflow → choose the tag).

1. **Version check:** `tools/release-version.ts check` fails unless every file carries the tag's
   version and the changelog has its section.
2. **Checks:** the full [CI workflow](development.md#continuous-integration), which builds and
   validates the firmware for every board and the website from the tagged commit.
3. **Desktop app:** built on GitHub's macOS, Windows and Ubuntu 22.04 machines from that same
   website build, so the app's portal, installer and firmware match the release exactly.
4. **Publish:** creates the GitHub release, or updates it if it exists, with the changelog section
   as notes (plus `.github/release-notes-footer.md`) and these files:

| File | What it is |
| --- | --- |
| `Reaper-Mesh-macOS.dmg` | Desktop app, macOS, Apple silicon and Intel |
| `Reaper-Mesh-Windows-x64-setup.exe` | Desktop app installer, Windows |
| `Reaper-Mesh-Linux-x86_64.AppImage`, `Reaper-Mesh-Linux-amd64.deb` | Desktop app, Linux |
| `{device}-reaper-mesh-v{version}.zip` | One firmware zip per board, the same as the installer's "Download firmware instead" |
| `SHA256SUMS` | The SHA-256 hash of every file |

The desktop files have no version in their names, so the website can link to
`releases/latest/download/<file>` and never needs changing.

To **update a release**, for example after fixing the workflow, run it again by hand from the same
tag: it rebuilds and replaces every file. To change what a release contains, make a new version
instead; a tag should always mean one exact commit.

The Pages website itself still deploys from `main`, as before. A release does not redeploy it.

## Signing (not set up yet)

Releases are not code-signed, so macOS and Windows ask people to allow the app once (see
[Desktop app](../guides/desktop-app.md)), and `SHA256SUMS` detects corruption, not a malicious
publisher.

- **macOS:** the workflow already signs and notarizes when these repository secrets exist:
  `APPLE_CERTIFICATE` (a base64 Developer ID Application certificate, `.p12`),
  `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (an
  app-specific password) and `APPLE_TEAM_ID`. The Apple Developer account that publishes the iOS
  app can issue the certificate. Without them the app is ad-hoc signed.
- **Windows:** needs a code-signing certificate or a signing service (for example Azure Trusted
  Signing), configured in `tauri.conf.json` under `bundle.windows`. Not wired up yet.
- **Firmware:** signed firmware is a separate roadmap item.
