#!/usr/bin/env node
/**
 * Register the JSON deep-merge driver in the local git config.
 * Runs automatically via `npm postinstall` so every developer gets it.
 */
import { execSync } from "child_process";

try {
  execSync('git config merge.json-merge.name "JSON deep merge driver"', { stdio: "ignore" });
  execSync('git config merge.json-merge.driver "node scripts/git/json-merge-driver.mjs %A %O %B"', { stdio: "ignore" });
} catch {
  // Not in a git repo (e.g. CI tarball install) — silently skip
}
