#!/usr/bin/env node
/**
 * Register the JSON deep-merge driver in the local git config.
 * Runs automatically via the package manager postinstall hook so every developer gets it.
 */
import { execSync } from "child_process";

try {
  execSync('git config merge.json-merge.name "JSON deep merge driver"', { stdio: "ignore" });
  execSync('git config merge.json-merge.driver "node scripts/git/json-merge-driver.mjs %A %O %B"', { stdio: "ignore" });
  console.log("JSON merge driver configured for this repository.");
} catch {
  console.log("Skipping JSON merge driver setup outside a git repository.");
}
