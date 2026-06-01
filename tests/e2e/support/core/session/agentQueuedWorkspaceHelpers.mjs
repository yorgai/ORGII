import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  REPLY_TIMEOUT_MS,
  clickByTestId,
  execJS,
  invokeE2E,
  js,
  summarizeChatState,
  summarizePageDump,
} from "./agentQueuedFollowupDriver.mjs";

// Track every scenario tmpdir we create so the test suite can wipe them all
// on exit. macOS `/var/folders/.../T/` does not auto-clean, and we previously
// left thousands of `orgii-e2e-rewind-*` repos around between runs, which
// also caused background tasks (git watcher, worktree prune) to spam errors
// when the dirs were eventually GC'd while sessions still referenced them.
const SCENARIO_TMP_DIRS = new Set();
let scenarioCleanupRegistered = false;

function registerScenarioCleanup() {
  if (scenarioCleanupRegistered) return;
  scenarioCleanupRegistered = true;
  const cleanup = () => {
    for (const dir of SCENARIO_TMP_DIRS) {
      try {
        fs.rmSync(dir, { force: true, recursive: true });
      } catch {
        // best-effort; the tmpdir may already be gone
      }
    }
    SCENARIO_TMP_DIRS.clear();
  };
  process.once("exit", cleanup);
  process.once("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });
}

function createTempRepo(label) {
  registerScenarioCleanup();
  const root = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      `orgii-e2e-rewind-${label.replace(/[^a-zA-Z0-9]/g, "-")}-`
    )
  );
  SCENARIO_TMP_DIRS.add(root);
  fs.writeFileSync(
    path.join(root, "README.md"),
    `# ORGII Rewind E2E\n\n${label}\n`,
    "utf8"
  );
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["add", "README.md"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "initial"], {
    cwd: root,
    stdio: "ignore",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "ORGII E2E",
      GIT_AUTHOR_EMAIL: "e2e@orgii.local",
      GIT_COMMITTER_NAME: "ORGII E2E",
      GIT_COMMITTER_EMAIL: "e2e@orgii.local",
    },
  });
  return root;
}

function listWorkspaceFiles(root) {
  const results = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolutePath = path.join(dir, entry.name);
      const relativePath = path.relative(root, absolutePath);
      if (
        relativePath === ".git" ||
        relativePath.startsWith(`${path.sep}.git${path.sep}`)
      ) {
        continue;
      }
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      results.push(relativePath.split(path.sep).join("/"));
    }
  }
  walk(root);
  results.sort();
  return results;
}

function isPlanArtifactFile(file) {
  if (!file.endsWith(".md")) return false;
  if (file === "plan.md") return true;
  if (file === ".claude/plan.md") return true;
  if (file.startsWith(".orgii/plans/")) return true;
  if (file.startsWith(".orgii/cli-plans/")) return true;
  return false;
}

function assertNoImplementationFilesCreated(label, beforeFiles, repoPath) {
  const before = new Set(beforeFiles);
  const after = listWorkspaceFiles(repoPath);
  const unexpectedFiles = after.filter((file) => {
    if (before.has(file)) return false;
    return !isPlanArtifactFile(file);
  });
  if (unexpectedFiles.length > 0) {
    throw new Error(
      `${label} Plan mode created implementation files before Build approval: ${JSON.stringify(unexpectedFiles)}`
    );
  }
}

async function waitForFileChangesPanel(label) {
  await browser.waitUntil(
    async () => {
      const state = await execJS(js.fileChanges);
      return (
        state.filesPill || (state.undoAll && state.keepAll && state.review)
      );
    },
    {
      timeout: REPLY_TIMEOUT_MS,
      interval: 2_000,
      timeoutMsg: `${label} file changes pill never appeared; state=${JSON.stringify(await execJS(js.fileChanges))} chatState=${JSON.stringify(summarizeChatState(await invokeE2E("inspectChatState")))} dump=${JSON.stringify(summarizePageDump(await execJS(js.pageDump)))}`,
    }
  );

  const visibleState = await execJS(js.fileChanges);
  if (!visibleState.undoAll) {
    await clickByTestId("composer-section-files", `${label} file changes pill`);
  }

  await browser.waitUntil(
    async () => {
      const state = await execJS(js.fileChanges);
      return state.undoAll && state.keepAll && state.review;
    },
    {
      timeout: REPLY_TIMEOUT_MS,
      interval: 2_000,
      timeoutMsg: `${label} file changes panel did not expand; state=${JSON.stringify(await execJS(js.fileChanges))} chatState=${JSON.stringify(summarizeChatState(await invokeE2E("inspectChatState")))}`,
    }
  );
}

async function waitForUndoAllEnabled(label) {
  await browser.waitUntil(
    async () => {
      const state = await execJS(js.fileChanges);
      return state.undoAll && !state.undoAllDisabled;
    },
    {
      timeout: 30_000,
      interval: 500,
      timeoutMsg: `${label} Undo All did not become enabled; state=${JSON.stringify(await execJS(js.fileChanges))} chatState=${JSON.stringify(summarizeChatState(await invokeE2E("inspectChatState")))}`,
    }
  );
}

async function clickUndoAllAndConfirm(label) {
  await waitForUndoAllEnabled(label);
  await execJS(`window.__orgiiE2EAutoConfirmDestructive = true; return true;`);
  await clickByTestId("file-changes-undo-all", `${label} Undo All`);
}

async function waitForRedoAllEnabled(label) {
  await browser.waitUntil(
    async () => {
      const state = await execJS(js.fileChanges);
      return state.redoAll && !state.redoAllDisabled;
    },
    {
      timeout: 30_000,
      interval: 500,
      timeoutMsg: `${label} Redo All did not become enabled; state=${JSON.stringify(await execJS(js.fileChanges))} chatState=${JSON.stringify(summarizeChatState(await invokeE2E("inspectChatState")))}`,
    }
  );
}

async function clickRedoAllAndConfirm(label) {
  await waitForRedoAllEnabled(label);
  await execJS(`window.__orgiiE2EAutoConfirmDestructive = true; return true;`);
  await clickByTestId("file-changes-redo-all", `${label} Redo All`);
}

function rewindPromptForConfig(_config, markerFile, markerText) {
  return [
    `Create a new markdown note named ${markerFile} in the current workspace.`,
    `The note must contain exactly this single line: ${markerText}`,
    "Please make the workspace change directly instead of only describing it.",
    "Do not use Shell or terminal commands.",
    "After the file is written, reply with exactly REWIND_FILE_CREATED and no other words.",
  ].join(" ");
}

async function waitForMarkerFile(
  config,
  filePath,
  markerText,
  timeoutMs = REPLY_TIMEOUT_MS
) {
  await browser.waitUntil(
    async () =>
      fs.existsSync(filePath) &&
      fs.readFileSync(filePath, "utf8").includes(markerText),
    {
      timeout: timeoutMs,
      interval: 2_000,
      timeoutMsg: `${config.label} marker file was not created at ${filePath}; assistantTexts=${JSON.stringify(await execJS(js.assistantTexts))} fileChanges=${JSON.stringify(await execJS(js.fileChanges))} chatState=${JSON.stringify(summarizeChatState(await invokeE2E("inspectChatState")))}`,
    }
  );
}

function cleanupTempRepo(root) {
  if (!root) return;
  try {
    fs.rmSync(root, { force: true, recursive: true });
  } catch {
    // best-effort
  }
  SCENARIO_TMP_DIRS.delete(root);
}

export {
  assertNoImplementationFilesCreated,
  cleanupTempRepo,
  clickRedoAllAndConfirm,
  clickUndoAllAndConfirm,
  createTempRepo,
  listWorkspaceFiles,
  rewindPromptForConfig,
  waitForFileChangesPanel,
  waitForMarkerFile,
};
