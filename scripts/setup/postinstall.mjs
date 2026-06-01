#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const steps = [
  {
    title: "Configure Tauri sidecar symlinks",
    command: process.execPath,
    args: ["scripts/setup/sidecar-symlinks.js"],
  },
  {
    title: "Register JSON merge driver",
    command: process.execPath,
    args: ["scripts/setup/json-merge-driver.mjs"],
  },
];

function formatDuration(startedAt) {
  const elapsedMs = performance.now() - startedAt;
  if (elapsedMs < 1000) return `${Math.round(elapsedMs)}ms`;
  return `${(elapsedMs / 1000).toFixed(1)}s`;
}

function runStep(step, index) {
  const label = `[${index + 1}/${steps.length}] ${step.title}`;
  const startedAt = performance.now();

  console.log(`\n▶ ${label}`);

  const result = spawnSync(step.command, step.args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`✖ ${label} failed to start after ${formatDuration(startedAt)}`);
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`✖ ${label} failed after ${formatDuration(startedAt)}`);
    process.exit(result.status ?? 1);
  }

  console.log(`✓ ${label} completed in ${formatDuration(startedAt)}`);
}

const installStartedAt = performance.now();

console.log("\nORGII postinstall setup");
console.log("Preparing local development helpers...");

steps.forEach(runStep);

console.log(`\nDone in ${formatDuration(installStartedAt)}.`);
