#!/usr/bin/env python3
"""Download optional native sidecar binaries for the current platform.

The repository intentionally does not commit downloaded sidecars. This script
installs the current platform's optional binaries into src-tauri/bin so local
Tauri development can use the vendored binary path when available.
"""

from __future__ import annotations

import os
import platform
import shutil
import stat
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path

AGENT_BROWSER_VERSION = "v0.27.2"
PEEKABOO_VERSION = "v3.2.3"
PROGRESS_BAR_LENGTH = 40

PROJECT_ROOT = Path(__file__).resolve().parents[2]
BIN_DIR = PROJECT_ROOT / "src-tauri" / "bin"

AGENT_BROWSER_TARGETS = {
    ("Darwin", "arm64"): {
        "asset": "agent-browser-darwin-arm64",
        "destination": "agent-browser-aarch64-apple-darwin",
    },
    ("Darwin", "aarch64"): {
        "asset": "agent-browser-darwin-arm64",
        "destination": "agent-browser-aarch64-apple-darwin",
    },
    ("Darwin", "x86_64"): {
        "asset": "agent-browser-darwin-x64",
        "destination": "agent-browser-x86_64-apple-darwin",
    },
    ("Linux", "x86_64"): {
        "asset": "agent-browser-linux-x64",
        "destination": "agent-browser-x86_64-unknown-linux-gnu",
    },
    ("Linux", "amd64"): {
        "asset": "agent-browser-linux-x64",
        "destination": "agent-browser-x86_64-unknown-linux-gnu",
    },
    ("Windows", "AMD64"): {
        "asset": "agent-browser-win32-x64.exe",
        "destination": "agent-browser-x86_64-pc-windows-msvc.exe",
    },
    ("Windows", "x86_64"): {
        "asset": "agent-browser-win32-x64.exe",
        "destination": "agent-browser-x86_64-pc-windows-msvc.exe",
    },
}

PEEKABOO_TARGETS = {
    ("Darwin", "arm64"): "peekaboo-aarch64-apple-darwin",
    ("Darwin", "aarch64"): "peekaboo-aarch64-apple-darwin",
    ("Darwin", "x86_64"): "peekaboo-x86_64-apple-darwin",
}


def progress_bar(block_num: int, block_size: int, total_size: int) -> None:
    downloaded = block_num * block_size
    percent = min(downloaded / total_size * 100, 100) if total_size > 0 else 0
    filled_length = int(PROGRESS_BAR_LENGTH * percent // 100)
    bar = "=" * filled_length + "-" * (PROGRESS_BAR_LENGTH - filled_length)
    sys.stdout.write(f"\rDownloading... [{bar}] {percent:5.1f}%")
    sys.stdout.flush()


def ensure_executable(path: Path) -> None:
    if os.name == "nt":
        return
    mode = path.stat().st_mode
    path.chmod(mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def download_file(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {url}")
    urllib.request.urlretrieve(url, destination, reporthook=progress_bar)
    print("\nDownload complete.")


def install_agent_browser(system_name: str, machine_name: str) -> None:
    target = AGENT_BROWSER_TARGETS.get((system_name, machine_name))
    if target is None:
        print(f"Skipping agent-browser: unsupported platform {system_name}/{machine_name}.")
        return

    destination = BIN_DIR / target["destination"]
    if destination.exists() and not is_placeholder(destination):
        print(f"agent-browser already installed at {destination}")
        return

    url = (
        "https://github.com/vercel-labs/agent-browser/releases/download/"
        f"{AGENT_BROWSER_VERSION}/{target['asset']}"
    )
    download_file(url, destination)
    ensure_executable(destination)
    print(f"Installed agent-browser to {destination}")


def find_peekaboo_binary(extract_dir: Path) -> Path:
    candidates = [path for path in extract_dir.rglob("peekaboo") if path.is_file()]
    if not candidates:
        raise FileNotFoundError("Could not find peekaboo binary in release archive.")
    return candidates[0]


def install_peekaboo(system_name: str, machine_name: str) -> None:
    destination_name = PEEKABOO_TARGETS.get((system_name, machine_name))
    if destination_name is None:
        print(f"Skipping peekaboo: unsupported platform {system_name}/{machine_name}.")
        return

    universal_destination = BIN_DIR / "peekaboo"
    arch_destination = BIN_DIR / destination_name
    if (
        universal_destination.exists()
        and arch_destination.exists()
        and not is_placeholder(universal_destination)
        and not is_placeholder(arch_destination)
    ):
        print(f"peekaboo already installed at {universal_destination}")
        return

    url = (
        "https://github.com/steipete/peekaboo/releases/download/"
        f"{PEEKABOO_VERSION}/peekaboo-macos-universal.tar.gz"
    )

    with tempfile.TemporaryDirectory(prefix="orgii-peekaboo-") as temp_dir_name:
        temp_dir = Path(temp_dir_name)
        archive_path = temp_dir / "peekaboo-macos-universal.tar.gz"
        extract_dir = temp_dir / "extract"
        extract_dir.mkdir(parents=True, exist_ok=True)
        download_file(url, archive_path)
        with tarfile.open(archive_path, "r:gz") as archive:
            archive.extractall(extract_dir)
        source_binary = find_peekaboo_binary(extract_dir)
        BIN_DIR.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_binary, universal_destination)
        shutil.copy2(source_binary, arch_destination)
        ensure_executable(universal_destination)
        ensure_executable(arch_destination)
        print(f"Installed peekaboo to {universal_destination}")
        print(f"Installed peekaboo platform copy to {arch_destination}")


def is_placeholder(path: Path) -> bool:
    try:
        with path.open("rb") as file:
            marker = file.read(64)
    except OSError:
        return False
    return marker.startswith(b"ORGII_GENERATED_OPTIONAL_SIDECAR_PLACEHOLDER")


def main() -> None:
    system_name = platform.system()
    machine_name = platform.machine()
    print(f"Detected platform: {system_name}/{machine_name}")
    BIN_DIR.mkdir(parents=True, exist_ok=True)
    install_agent_browser(system_name, machine_name)
    install_peekaboo(system_name, machine_name)
    print("Optional sidecar download complete.")


if __name__ == "__main__":
    main()
