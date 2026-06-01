#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..", "..");
const nodeCachePath = path.join(repoRoot, "node_modules", ".cache");
const cargoConfigPath = path.join(os.homedir(), ".cargo", "config.toml");
const defaultCargoTargetPath = path.join(
  os.homedir(),
  ".cargo",
  "shared-target"
);

const maxNodeCacheBytes = Number.parseInt(
  process.env.ORGII_MAX_NODE_CACHE_BYTES ?? `${500 * 1024 * 1024}`,
  10
);
const maxCargoTargetBytes = Number.parseInt(
  process.env.ORGII_MAX_CARGO_TARGET_BYTES ?? `${5 * 1024 * 1024 * 1024}`,
  10
);

function getDirectorySizeBytes(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    return 0;
  }

  const output = execFileSync("du", ["-sk", directoryPath], {
    encoding: "utf8",
  });
  const sizeKilobytes = Number.parseInt(
    output.trim().split(/\s+/)[0] ?? "0",
    10
  );
  return sizeKilobytes * 1024;
}

function formatMegabytes(bytes) {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}

function cleanDirectoryIfLarge(directoryPath, label, maxBytes) {
  const directoryBytes = getDirectorySizeBytes(directoryPath);

  if (directoryBytes <= maxBytes) {
    return false;
  }

  fs.rmSync(directoryPath, { recursive: true, force: true });
  console.log(
    `Cleaned ${label} (${formatMegabytes(directoryBytes)} > ${formatMegabytes(maxBytes)})`
  );
  return true;
}

function readCargoTargetPath() {
  if (!fs.existsSync(cargoConfigPath)) {
    return defaultCargoTargetPath;
  }

  const config = fs.readFileSync(cargoConfigPath, "utf8");
  const targetDirMatch = config.match(/^\s*target-dir\s*=\s*"([^"]+)"/m);

  if (!targetDirMatch?.[1]) {
    return defaultCargoTargetPath;
  }

  return targetDirMatch[1].replace(/^~/, os.homedir());
}

function hasActiveCargoBuild() {
  const cargoResult = spawnSync("pgrep", ["-x", "cargo"], { encoding: "utf8" });
  const rustcResult = spawnSync("pgrep", ["-x", "rustc"], { encoding: "utf8" });

  return cargoResult.status === 0 || rustcResult.status === 0;
}

cleanDirectoryIfLarge(nodeCachePath, "node_modules/.cache", maxNodeCacheBytes);

const cargoTargetPath = readCargoTargetPath();
const cargoTargetBytes = getDirectorySizeBytes(cargoTargetPath);

if (cargoTargetBytes > maxCargoTargetBytes) {
  if (hasActiveCargoBuild()) {
    console.log(
      `Skipped Cargo target cleanup because cargo/rustc is running (${formatMegabytes(cargoTargetBytes)} > ${formatMegabytes(maxCargoTargetBytes)})`
    );
    process.exit(0);
  }

  fs.rmSync(cargoTargetPath, { recursive: true, force: true });
  console.log(
    `Cleaned Cargo target ${cargoTargetPath} (${formatMegabytes(cargoTargetBytes)} > ${formatMegabytes(maxCargoTargetBytes)})`
  );
}
