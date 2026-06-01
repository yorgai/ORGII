#!/bin/bash

###############################################################################
# Cleanup Rust / Cargo Build Artifacts
#
# Cleans Cargo target dir(s) and optionally prunes global Cargo caches.
# Safe to run at any time — will not delete source code or config.
#
# Modes:
#   ./scripts/maintenance/cargo-cleanup.sh           # full: target + RA target (safe default)
#   ./scripts/maintenance/cargo-cleanup.sh --stale   # SURGICAL: only remove stale `-working`
#                                        # incremental dirs that cause the
#                                        # "failed to create dependency graph at
#                                        # …/incremental/…/s-…-working/dep-graph
#                                        # .part.bin: No such file" error. Fast,
#                                        # ~seconds. Does NOT recompile anything.
#                                        # Run this any time you see that error.
#   ./scripts/maintenance/cargo-cleanup.sh --full    # everything + global cache prune
#
# Recommended cadence:
#   --stale  : weekly, or whenever you see the "dep-graph.part.bin" error
#   default  : monthly, or when disk is tight
#   --full   : every 2-4 weeks, or when disk is REALLY tight
#
# This script understands BOTH layouts:
#   1. Per-project target (legacy):  src-tauri/target/
#   2. Shared target dir (current):  ~/.cargo/shared-target/
#      (set via ~/.cargo/config.toml `[build] target-dir = ...`)
###############################################################################

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LEGACY_TARGET_DIR="$PROJECT_ROOT/src-tauri/target"
CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}"

# Read the shared-target path from ~/.cargo/config.toml if set, else
# fall back to the conventional path. This keeps us in sync if the
# user moves it later.
SHARED_TARGET_DIR="$(
  awk -F'"' '/^[[:space:]]*target-dir[[:space:]]*=/ {print $2; exit}' \
    "$CARGO_HOME/config.toml" 2>/dev/null \
    || true
)"
SHARED_TARGET_DIR="${SHARED_TARGET_DIR:-$CARGO_HOME/shared-target}"

# rust-analyzer's separate target (set in .vscode/settings.json,
# `rust-analyzer.cargo.targetDir`). Keep in sync if you move it there.
RA_SHARED_TARGET_DIR="$CARGO_HOME/shared-target-ra"

MODE="default"
case "${1:-}" in
  --stale) MODE="stale" ;;
  --full)  MODE="full" ;;
  "")      MODE="default" ;;
  *)
    echo "Unknown flag: $1" >&2
    echo "Usage: $0 [--stale | --full]" >&2
    exit 2
    ;;
esac

bytes_to_human() {
  local bytes=$1
  if (( bytes >= 1073741824 )); then
    echo "$(echo "scale=1; $bytes / 1073741824" | bc)G"
  elif (( bytes >= 1048576 )); then
    echo "$(echo "scale=1; $bytes / 1048576" | bc)M"
  elif (( bytes >= 1024 )); then
    echo "$(echo "scale=0; $bytes / 1024" | bc)K"
  else
    echo "${bytes}B"
  fi
}

dir_size_bytes() {
  if [[ -d "$1" ]]; then
    du -sk "$1" 2>/dev/null | awk '{print $1 * 1024}'
  else
    echo 0
  fi
}

echo "=== Cargo Cleanup (mode: $MODE) ==="
echo ""

# --- 0. Refuse to run while a cargo/rustc process is active -------------
# Touching incremental/ or deps/ while another cargo is writing is exactly
# the race we're trying to prevent. A live `npm run tauri:dev` keeps a
# rustc handle open even when not actively compiling.
#
# We deliberately match by EXECUTABLE basename, not full command line —
# matching `cargo` against the full cmdline would also match
#   - the editor process if its env contains a `…/cargo/…` path
#   - the running Tauri app binary if it lives under `…/shared-target/…`
# both of which are completely unrelated to compilation.
# Note on sccache: we deliberately do NOT match `sccache` here. It is a
# long-lived daemon that does not touch `incremental/` or fingerprint
# files; only its child `rustc` invocations do, and those are caught
# by the `rustc` match below.
ACTIVE_BUILDERS="$(pgrep -x cargo 2>/dev/null; pgrep -x rustc 2>/dev/null)"
if [[ -n "${ACTIVE_BUILDERS//[[:space:]]/}" ]]; then
  echo "ERROR: cargo or rustc is currently running. Stop them first:"
  echo "$ACTIVE_BUILDERS" | while read -r pid; do
    [[ -n "$pid" ]] && ps -p "$pid" -o pid=,comm= 2>/dev/null | sed 's/^/  /'
  done
  echo ""
  echo "Common sources: npm run tauri:dev, rust-analyzer (in your IDE),"
  echo "  cargo test, cargo check on save."
  exit 3
fi

# --- 1. Stale `-working` incremental dirs --------------------------------
#
# `s-…-working` is the directory rustc creates at the START of a build
# session. On success, it gets atomically renamed to `s-…-finalized`. If
# rustc crashes or is killed (Ctrl+C, OOM, SIGTERM from `npm run
# tauri:dev` shutting down), the `-working` dir is orphaned. The next
# cargo invocation that GCs the parent crate-hash dir while another
# process happens to be writing into a different `-working` next door
# is what produces:
#
#     error: failed to create dependency graph at
#     `…/incremental/…/s-…-working/dep-graph.part.bin`:
#     No such file or directory (os error 2)
#
# Removing all `-working` dirs is always safe: rustc will recreate them
# on the next build. They are NEVER read across builds (only the
# `-finalized` siblings are).
#
# We do this for ALL three target dirs we know about, since any of them
# may have been a victim of an interrupted build.
prune_stale_working() {
  local dir="$1"
  local label="$2"
  if [[ ! -d "$dir/debug/incremental" && ! -d "$dir/release/incremental" ]]; then
    return 0
  fi
  local count
  count=$(find "$dir" -path '*/incremental/*-working' -type d 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$count" == "0" ]]; then
    echo "$label: no stale -working dirs"
    return 0
  fi
  echo "$label: $count stale -working dirs"
  find "$dir" -path '*/incremental/*-working' -type d -exec rm -rf {} + 2>/dev/null || true
  # The `.lock` files paired with each -working dir are also orphaned;
  # cargo holds them only for the lifetime of the working session.
  find "$dir" -path '*/incremental/*-working.lock' -type f -delete 2>/dev/null || true
}

prune_stale_working "$SHARED_TARGET_DIR"    "shared-target"
prune_stale_working "$RA_SHARED_TARGET_DIR" "shared-target-ra"
prune_stale_working "$LEGACY_TARGET_DIR"    "legacy src-tauri/target"

if [[ "$MODE" == "stale" ]]; then
  echo ""
  echo "Done. Stale -working dirs pruned. No recompile needed."
  exit 0
fi

echo ""

# --- 2. Full target wipe (default + --full) ------------------------------
PROJECT_FREED=0

wipe_dir() {
  local dir="$1"
  local label="$2"
  if [[ -d "$dir" ]]; then
    local before
    before=$(dir_size_bytes "$dir")
    echo "$label: $(bytes_to_human "$before")"
    echo "  Removing $dir ..."
    rm -rf "$dir"
    PROJECT_FREED=$((PROJECT_FREED + before))
  else
    echo "$label: not present (already clean)"
  fi
}

wipe_dir "$SHARED_TARGET_DIR"    "shared-target       "
wipe_dir "$RA_SHARED_TARGET_DIR" "shared-target-ra    "
wipe_dir "$LEGACY_TARGET_DIR"    "legacy src-tauri/target"

if (( PROJECT_FREED > 0 )); then
  echo "  Total freed: $(bytes_to_human "$PROJECT_FREED")"
fi

echo ""

# --- 3. Global Cargo caches (only with --full) ---------------------------
if [[ "$MODE" == "full" ]]; then
  echo "--- Global Cargo cache prune (--full) ---"
  echo ""

  REGISTRY_DIR="$CARGO_HOME/registry"
  GIT_DIR="$CARGO_HOME/git"

  BEFORE_REG=$(dir_size_bytes "$REGISTRY_DIR")
  BEFORE_GIT=$(dir_size_bytes "$GIT_DIR")
  BEFORE_TOTAL=$((BEFORE_REG + BEFORE_GIT))

  echo "Before:"
  echo "  registry : $(bytes_to_human "$BEFORE_REG")"
  echo "  git      : $(bytes_to_human "$BEFORE_GIT")"
  echo "  total    : $(bytes_to_human "$BEFORE_TOTAL")"
  echo ""

  # Remove extracted source caches (re-downloaded on next build)
  if [[ -d "$REGISTRY_DIR/src" ]]; then
    echo "  Removing registry/src (extracted sources) ..."
    rm -rf "$REGISTRY_DIR/src"
  fi

  # Remove old .crate tarballs (keep the index for faster resolution)
  if [[ -d "$REGISTRY_DIR/cache" ]]; then
    echo "  Removing registry/cache (crate tarballs) ..."
    rm -rf "$REGISTRY_DIR/cache"
  fi

  # Remove checked-out git dependency sources
  if [[ -d "$GIT_DIR/checkouts" ]]; then
    echo "  Removing git/checkouts ..."
    rm -rf "$GIT_DIR/checkouts"
  fi

  echo ""

  AFTER_REG=$(dir_size_bytes "$REGISTRY_DIR")
  AFTER_GIT=$(dir_size_bytes "$GIT_DIR")
  AFTER_TOTAL=$((AFTER_REG + AFTER_GIT))
  FREED=$((BEFORE_TOTAL - AFTER_TOTAL))

  echo "After:"
  echo "  registry : $(bytes_to_human "$AFTER_REG")"
  echo "  git      : $(bytes_to_human "$AFTER_GIT")"
  echo "  total    : $(bytes_to_human "$AFTER_TOTAL")"
  echo ""
  echo "Freed $(bytes_to_human "$FREED") from global cache."
else
  REGISTRY_SIZE=$(dir_size_bytes "$CARGO_HOME/registry")
  GIT_SIZE=$(dir_size_bytes "$CARGO_HOME/git")
  GLOBAL_TOTAL=$((REGISTRY_SIZE + GIT_SIZE))
  echo "Global Cargo cache: $(bytes_to_human "$GLOBAL_TOTAL") (use --full to prune)"
fi

echo ""
echo "Done. Next cargo build will re-download/recompile as needed."
