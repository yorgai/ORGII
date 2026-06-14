#!/usr/bin/env node

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { tauriFeatureString } = require("./features.cjs");
const {
  applyDefaultDiagnosticsEndpoint,
} = require("./diagnostics-endpoint.cjs");

const rootDir = path.join(__dirname, "..", "..");
const includeSemantic = process.argv.includes("--semantic");
const featureString = tauriFeatureString({ semantic: includeSemantic });
function resolveCargoTargetDir() {
  const metadataResult = spawnSync("cargo", ["metadata", "--format-version", "1", "--no-deps"], {
    cwd: path.join(rootDir, "src-tauri"),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });

  if (metadataResult.status !== 0) {
    console.error("Failed to resolve Cargo target directory via cargo metadata");
    process.exit(metadataResult.status ?? 1);
  }

  const metadata = JSON.parse(metadataResult.stdout);
  return metadata.target_directory;
}

const targetDir = resolveCargoTargetDir();
const appPath = path.join(targetDir, "dev-build/bundle/macos/ORGII.app");
const binaryPath = path.join(targetDir, "dev-build/orgii");

const configOverride = JSON.stringify({
  bundle: {
    createUpdaterArtifacts: false,
  },
});

spawnSync("pkill", ["-f", `${appPath}/Contents/MacOS/orgii`], {
  stdio: "ignore",
});
fs.rmSync(appPath, { recursive: true, force: true });
fs.rmSync(binaryPath, { force: true });

const cleanResult = spawnSync(
  "cargo",
  ["clean", "-p", "orgii", "--profile", "dev-build"],
  {
    stdio: "inherit",
    cwd: path.join(rootDir, "src-tauri"),
  }
);
if (cleanResult.status !== 0) {
  process.exit(cleanResult.status ?? 1);
}

const args = ["build"];
if (featureString.length > 0) {
  args.push("--features", featureString);
}
args.push("--bundles", "app", "--no-sign", "--config", configOverride, "--", "--profile", "dev-build");

const env = applyDefaultDiagnosticsEndpoint({ ...process.env });
const tauriBin = path.join(rootDir, "node_modules/.bin/tauri");
const result = spawnSync(tauriBin, args, {
  stdio: "inherit",
  cwd: rootDir,
  env,
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

if (!fs.existsSync(appPath)) {
  console.error(`Built app not found at ${appPath}`);
  process.exit(1);
}

spawnSync("open", [appPath], {
  stdio: "inherit",
});
