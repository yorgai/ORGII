#!/usr/bin/env node

const { spawnSync } = require("child_process");
const path = require("path");
const { tauriFeatureString } = require("./features.cjs");
const {
  applyDefaultDiagnosticsEndpoint,
} = require("./diagnostics-endpoint.cjs");

const rootDir = path.join(__dirname, "..", "..");
const includeSemantic = process.argv.includes("--semantic");
const featureString = tauriFeatureString({ semantic: includeSemantic });

const configOverride = JSON.stringify({
  build: {
    beforeBuildCommand: "webpack --mode production",
  },
  bundle: {
    createUpdaterArtifacts: false,
    macOS: {
      signingIdentity: null,
    },
  },
});

const env = applyDefaultDiagnosticsEndpoint({ ...process.env });
for (const key of [
  "APPLE_ID",
  "APPLE_PASSWORD",
  "APPLE_TEAM_ID",
  "APPLE_API_KEY",
  "APPLE_API_KEY_PATH",
  "APPLE_API_ISSUER",
]) {
  delete env[key];
}

const args = ["build"];
if (featureString.length > 0) {
  args.push("--features", featureString);
}
args.push("--bundles", "app", "--config", configOverride, "--", "--profile", "dev-build");

const tauriBin = path.join(rootDir, "node_modules/.bin/tauri");
const result = spawnSync(tauriBin, args, {
  stdio: "inherit",
  cwd: rootDir,
  env,
});

process.exit(result.status ?? 1);
