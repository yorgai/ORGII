import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dirname, "..", "..");
const skippedDirs = new Set([
  ".git",
  "node_modules",
  "target",
  "build",
  "dist",
]);
const dangerous = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (skippedDirs.has(entry)) continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (!stat.isFile()) continue;
    if (!/\.(mjs|js|ts|tsx|md|json|cjs|sh|yml|yaml)$/.test(entry)) continue;
    const text = readFileSync(fullPath, "utf8");
    const relPath = fullPath.slice(repoRoot.length + 1);
    if (/(^|\s)E2E_ALLOW_OAUTH_ROTATION_SEED=1(\s|$)/.test(text)) {
      dangerous.push(
        `${relPath}: contains removed E2E_ALLOW_OAUTH_ROTATION_SEED=1`
      );
    }
    if (/E2E_ORGII_HOME_SEED_SOURCE=.*\$?HOME\/?\.orgii/.test(text)) {
      dangerous.push(
        `${relPath}: suggests seeding WDIO from the real ~/.orgii home`
      );
    }
  }
}

walk(repoRoot);

if (dangerous.length > 0) {
  console.error("Unsafe E2E OAuth guidance found:");
  for (const item of dangerous) console.error(`- ${item}`);
  process.exit(1);
}

console.log("E2E OAuth guard check passed");
