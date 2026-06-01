#!/usr/bin/env node
/**
 * Collects ESLint and circular dependency counts for commit messages.
 *
 * FAST MODE (default): Only check staged files - blocks commit on errors.
 * Stats collection (eslint full src/, madge) runs async and doesn't block.
 *
 * Ratchet is scoped to STAGED files only — unstaged WIP in the tree
 * won't block your commit as long as the files you're committing are clean.
 */
import { execSync, spawn } from "child_process";
import { existsSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const STATS_FILE = join(ROOT, ".git", "COMMIT_STATS.json");

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
      ...opts,
    });
    let stdout = "";
    proc.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    proc.stderr?.on("data", () => {});
    proc.on("close", () => {
      resolve(stdout);
    });
    proc.on("error", reject);
  });
}

function countEslint(jsonStr) {
  try {
    const results = JSON.parse(jsonStr);
    if (!Array.isArray(results)) return 0;
    return results.reduce((sum, file) => {
      const messages = file.messages ?? [];
      const isIgnoredFileOnly =
        messages.length > 0 &&
        messages.every((message) =>
          Boolean(
            message.message?.includes(
              "ignored because of a matching ignore pattern",
            ),
          ),
        );
      if (isIgnoredFileOnly) {
        return sum;
      }
      return sum + (file.errorCount ?? 0) + (file.warningCount ?? 0);
    }, 0);
  } catch {
    return 0;
  }
}

function countCircular(jsonStr) {
  try {
    const cycles = JSON.parse(jsonStr);
    if (!Array.isArray(cycles)) return 0;
    return cycles.length;
  } catch {
    return 0;
  }
}

function getStagedSourceFiles() {
  try {
    const raw = execSync(
      "git diff --cached --name-only --diff-filter=ACMR -- '*.ts' '*.tsx' '*.js' '*.jsx'",
      { cwd: ROOT, encoding: "utf8" },
    );
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function main() {
  const stagedFiles = getStagedSourceFiles();

  // ─────────────────────────────────────────────────────────────────────────
  // CRITICAL PATH: Only check staged files (fast, gates commit)
  // ─────────────────────────────────────────────────────────────────────────
  let stagedEslintCount = 0;

  if (stagedFiles.length > 0) {
    const stagedEslintOut = await run("npx", [
      "eslint",
      ...stagedFiles,
      "--format",
      "json",
    ]);
    stagedEslintCount = countEslint(stagedEslintOut);

    if (stagedEslintCount > 0) {
      console.error(
        `\n❌ ESLint errors in staged files: ${stagedEslintCount}`,
      );
      console.error("   Fix them before committing.");
      console.error(`   Run:  npx eslint --fix ${stagedFiles.join(" ")}`);
      console.error("   Skip: git commit --no-verify\n");
      process.exit(2);
    }
  }

  console.log(`📊 Staged files clean (${stagedFiles.length} checked)`);

  // ─────────────────────────────────────────────────────────────────────────
  // NON-BLOCKING: Spawn detached process for project-wide stats
  // These don't gate the commit, just write stats for prepare-commit-msg
  // ─────────────────────────────────────────────────────────────────────────
  
  // Spawn a completely detached background process for stats collection
  // This allows the commit to proceed immediately
  const bgScript = join(__dirname, "commit-stats-background.mjs");
  if (existsSync(bgScript)) {
    const child = spawn("node", [bgScript], {
      cwd: ROOT,
      detached: true,
      stdio: "ignore",
    });
    child.unref(); // Don't wait for this process
  }
  
  console.log("📊 Project stats: collecting in background...");
}

main().catch((err) => {
  console.error("commit-stats:", err.message);
  process.exit(1);
});
