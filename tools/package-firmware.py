"""Create a local prototype bundle from validated images; does not publish anything."""

import argparse
import hashlib
import importlib.util
import json
import subprocess
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("reaper_updater", root / "tools/update-firmware.py")
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)


def package(manifest_path, output):
    manifest, artifacts = updater.validate(manifest_path)
    sdk = root / ".tools/esp-idf"
    revision = subprocess.check_output(
        ["git", "-C", str(sdk), "rev-parse", "HEAD"], text=True
    ).strip()
    updater.require(revision == updater.SDK, "package notices require the pinned SDK checkout")
    source = subprocess.check_output(
        ["git", "archive", "--format=tar", manifest["source_commit"]], cwd=root
    )
    files = {entry["file"]: artifacts[int(entry["offset"], 16)] for entry in manifest["artifacts"]}
    files["reaper-manifest.json"] = (json.dumps(manifest, indent=2) + "\n").encode()
    files["update-firmware.py"] = (root / "tools/update-firmware.py").read_bytes()
    files["source.tar"] = source
    files["LICENSE"] = (root / "LICENSE").read_bytes()
    files["NOTICE"] = (root / "NOTICE").read_bytes()
    files["notices/Semtech-Clear-BSD.txt"] = (
        root / "firmware/components/reaper_radio/vendor/LICENSE.txt"
    ).read_bytes()
    # Preserve SDK legal notices conservatively, including bundled dependencies.
    for path in sorted(sdk.rglob("*")):
        if (
            path.is_file()
            and not path.is_symlink()
            and path.name.upper().startswith(("LICENSE", "COPYING", "NOTICE", "COPYRIGHT"))
            and ".git" not in path.relative_to(sdk).parts
        ):
            files["notices/esp-idf/" + path.relative_to(sdk).as_posix()] = path.read_bytes()
    updater.require(
        "notices/esp-idf/LICENSE" in files
        and "notices/esp-idf/components/newlib/COPYING.NEWLIB" in files,
        "required SDK notices missing",
    )
    files["README.txt"] = (
        "Reaper Mesh local development prototype\n\n"
        f"Firmware: {manifest['firmware']}\nSource: {manifest['source_commit']}\n"
        f"Hardware: {manifest['board']} / {manifest['target']} / {manifest['flash_settings']['flash_size']}\n\n"
        "Disconnect the console. Validate: python3 update-firmware.py --manifest reaper-manifest.json\n"
        "Install with an interpreter containing esptool 4.12.0:\n"
        "python3 update-firmware.py --manifest reaper-manifest.json --python /absolute/path/to/python --flash --port PORT\n\n"
        "ROM reinstall preserves NVS. If interrupted, hold BOOT, tap RESET, release BOOT and reinstall.\n"
        "Reconnect and verify firmware/settings. No automatic rollback or authenticated release signature.\n"
        "SHA256 detects corruption, not publisher authenticity. Use reviewed local builds.\n"
        "Reaper Mesh is licensed under Apache-2.0 (LICENSE, NOTICE).\n"
        "This archive is not a public release or an RF certification.\n"
        "Source is included in source.tar. SDK provenance and driver notices are retained.\n"
        "Two-/three-device RF delivery, power-cut and field qualification remain separate gates.\n"
    ).encode()
    files["SHA256SUMS"] = "".join(
        f"{hashlib.sha256(data).hexdigest()}  {name}\n" for name, data in sorted(files.items())
    ).encode()
    output = Path(output)
    updater.require(not output.exists(), "output already exists; choose a new package filename")
    with zipfile.ZipFile(output, "x", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(files.items()):
            record = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            record.compress_type = zipfile.ZIP_DEFLATED
            record.external_attr = 0o100644 << 16
            archive.writestr(record, data)
    print(
        f"Created {output}: {len(files)} files, SHA256 {hashlib.sha256(output.read_bytes()).hexdigest()}"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manifest", type=Path, default=Path("build/heltec-v3/reaper-manifest.json")
    )
    parser.add_argument("--output", type=Path, required=True)
    options = parser.parse_args()
    package(options.manifest, options.output)
