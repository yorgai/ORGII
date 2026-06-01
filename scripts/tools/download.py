import os
import urllib.request
import tarfile
import zipfile
import shutil
import sys
import platform as py_platform

# Constants
NODE_VERSION = "v20.19.2"
PLATFORMS = [
    {
        "name": "apple-darwin-arm64",
        "node_dist": f"node-{NODE_VERSION}-darwin-arm64",
        "dst_name": "node-aarch64-apple-darwin",
        "archive_ext": "tar.gz",
        "is_zip": False,
        "tar_mode": "r:gz",
        "src_node_path": lambda extract_dir, node_dist: os.path.join(
            extract_dir, node_dist, "bin", "node"
        ),
        "match": lambda: py_platform.system() == "Darwin"
        and py_platform.machine() in ("arm64", "aarch64"),
    },
    {
        "name": "apple-darwin-x64",
        "node_dist": f"node-{NODE_VERSION}-darwin-x64",
        "dst_name": "node-x86_64-apple-darwin",
        "archive_ext": "tar.gz",
        "is_zip": False,
        "tar_mode": "r:gz",
        "src_node_path": lambda extract_dir, node_dist: os.path.join(
            extract_dir, node_dist, "bin", "node"
        ),
        "match": lambda: py_platform.system() == "Darwin"
        and py_platform.machine() in ("x86_64", "AMD64"),
    },
    {
        "name": "win-x64",
        "node_dist": f"node-{NODE_VERSION}-win-x64",
        "dst_name": "node-x86_64-pc-windows-msvc.exe",
        "archive_ext": "zip",
        "is_zip": True,
        "tar_mode": None,
        "src_node_path": lambda extract_dir, node_dist: os.path.join(
            extract_dir, node_dist, "node.exe"
        ),
        "match": lambda: py_platform.system() == "Windows"
        and py_platform.machine() in ("AMD64", "x86_64"),
    },
    {
        "name": "linux-x64",
        "node_dist": f"node-{NODE_VERSION}-linux-x64",
        "dst_name": "node-x86_64-unknown-linux-gnu",
        "archive_ext": "tar.xz",
        "is_zip": False,
        "tar_mode": "r:xz",
        "src_node_path": lambda extract_dir, node_dist: os.path.join(
            extract_dir, node_dist, "bin", "node"
        ),
        "match": lambda: py_platform.system() == "Linux"
        and py_platform.machine() in ("x86_64", "amd64"),
    },
    # Add more platforms here as needed
]

PROGRESS_BAR_LENGTH = 40
TEMP_DIR = "temp_download_node"


def progress_bar(block_num, block_size, total_size):
    downloaded = block_num * block_size
    percent = min(downloaded / total_size * 100, 100) if total_size > 0 else 0
    filled_length = int(PROGRESS_BAR_LENGTH * percent // 100)
    bar = "=" * filled_length + "-" * (PROGRESS_BAR_LENGTH - filled_length)
    sys.stdout.write(f"\rDownloading... [{bar}] {percent:5.1f}%")
    sys.stdout.flush()


# Find the current platform
current_platform = None
for plat in PLATFORMS:
    if plat.get("match", lambda: False)():
        current_platform = plat
        break

if current_platform is None:
    print("Unsupported platform for Node.js download.")
    sys.exit(1)

DST_NODE_PATH = os.path.join(os.getcwd(), current_platform["dst_name"])

# Check if the node binary already exists in the current folder
if os.path.exists(DST_NODE_PATH):
    print(f"{DST_NODE_PATH} already exists, skipping download and extraction.")
    sys.exit(0)

# Clean up any previous temp directory
if os.path.exists(TEMP_DIR):
    shutil.rmtree(TEMP_DIR)

try:
    NODE_DIST = current_platform["node_dist"]
    ARCHIVE_EXT = current_platform["archive_ext"]
    NODE_URL = f"https://nodejs.org/dist/{NODE_VERSION}/{NODE_DIST}.{ARCHIVE_EXT}"
    EXTRACT_DIR = os.path.join(TEMP_DIR, f"extracted_{NODE_DIST}")
    ARCHIVE_FILENAME = f"{NODE_DIST}.{ARCHIVE_EXT}"
    DOWNLOAD_PATH = os.path.join(TEMP_DIR, ARCHIVE_FILENAME)
    SRC_NODE_PATH = current_platform["src_node_path"](EXTRACT_DIR, NODE_DIST)

    os.makedirs(EXTRACT_DIR, exist_ok=True)

    # Download the file if it does not exist
    if not os.path.exists(DOWNLOAD_PATH):
        print(f"Downloading {NODE_URL}...")
        urllib.request.urlretrieve(NODE_URL, DOWNLOAD_PATH, reporthook=progress_bar)
        print("\nDownload complete.")
    else:
        print(f"File {DOWNLOAD_PATH} already exists, skipping download.")

    # Extract the archive file
    if current_platform["is_zip"]:
        with zipfile.ZipFile(DOWNLOAD_PATH, "r") as zip_ref:
            zip_ref.extractall(EXTRACT_DIR)
            print("Extraction complete.")
    else:
        with tarfile.open(DOWNLOAD_PATH, current_platform["tar_mode"]) as tar:
            tar.extractall(path=EXTRACT_DIR)
            print("Extraction complete.")

    # Copy the node binary to current folder with new name
    shutil.copy2(SRC_NODE_PATH, DST_NODE_PATH)
    print(f"Copied {SRC_NODE_PATH} to {DST_NODE_PATH}")
finally:
    # Remove all temp files or folders after finishing download and extraction
    if os.path.exists(TEMP_DIR):
        shutil.rmtree(TEMP_DIR)
        print(f"Removed temporary directory {TEMP_DIR}")
