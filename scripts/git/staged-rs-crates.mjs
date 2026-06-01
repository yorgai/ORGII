#!/usr/bin/env node
/**
 * Map staged `.rs` file paths (read from stdin or argv) to the workspace
 * Cargo packages that own them, then print one package name per line.
 *
 * Used by `.husky/pre-commit` so the clippy check only rebuilds the crates
 * whose source actually changed — instead of `cargo clippy --lib` (which
 * defaults to `-p app` and pulls every workspace dep transitively, taking
 * the package-cache lock on the shared `target-dir` and blocking parallel
 * cargo invocations from other agents/IDE).
 *
 * Resolution rules:
 *   - `src-tauri/crates/<dir>/...`       → package whose manifest lives at
 *                                          `src-tauri/crates/<dir>/Cargo.toml`
 *   - any other `src-tauri/...` Rust file → package `app`
 *   - non-Rust or non-`src-tauri/` files  → ignored
 *
 * Input:  paths on stdin, one per line (the husky hook pipes
 *         `git diff --cached --name-only -- '*.rs'`).
 * Output: deduped, sorted package names on stdout, one per line.
 *
 * Exit code 0 always (a missing match is silently dropped). The caller
 * decides whether an empty result means "skip clippy".
 */
import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const TAURI_DIR = join(REPO_ROOT, "src-tauri");

function loadWorkspacePackages() {
  const json = execFileSync(
    "cargo",
    ["metadata", "--no-deps", "--format-version=1"],
    { cwd: TAURI_DIR, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const meta = JSON.parse(json);
  const packages = [];
  for (const pkg of meta.packages) {
    const manifestDir = dirname(pkg.manifest_path);
    packages.push({ name: pkg.name, dir: manifestDir });
  }
  packages.sort((a, b) => b.dir.length - a.dir.length);
  return packages;
}

function readStdinLines() {
  const argv = process.argv.slice(2);
  if (argv.length > 0) return argv;
  const data = readFileSync(0, "utf8");
  return data.split(/\r?\n/).filter(Boolean);
}

function main() {
  const packages = loadWorkspacePackages();
  const owners = new Set();

  for (const raw of readStdinLines()) {
    const path = raw.trim();
    if (!path) continue;
    const abs = resolve(REPO_ROOT, path);
    if (!abs.endsWith(".rs")) continue;

    const owner = packages.find((pkg) => {
      const rel = relative(pkg.dir, abs);
      return rel && !rel.startsWith("..") && !rel.startsWith("/");
    });

    if (owner) owners.add(owner.name);
  }

  for (const name of [...owners].sort()) {
    process.stdout.write(`${name}\n`);
  }
}

main();
