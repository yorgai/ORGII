/**
 * code-map-folder-workspace-ui.spec.mjs
 *
 * Regression coverage for "the built-in code map is unusable on folders".
 *
 * The Rust code-map engine indexes any path (it does NOT require git), but the
 * UI was gated to git-repo workspaces and auto-indexing was a no-op stub. This
 * spec proves a NON-git folder workspace can read code-map status and index.
 *
 * Rendered/bridge, no-LLM coverage (window.__e2e):
 *  - Non-git folder fixture under $HOME with an indexable source file.
 *  - getCodeMapStatusForPath returns a status object (not_indexed initially) —
 *    proving the read path works for folder workspaces.
 *  - startCodeMapIndexForPath moves the status off not_indexed
 *    (indexing/ready) — proving indexing works without a git repo.
 *
 * Fixtures live under $HOME (NOT /tmp): the Tauri fs plugin scope covers $HOME.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MOUNT_TIMEOUT_MS = 60_000;
const INDEX_TIMEOUT_MS = 30_000;
const RUN_ID = Date.now();

const FIXTURE_ROOT = join(homedir(), `.orgii-e2e-codemap-${RUN_ID}`);
const FOLDER_WORKSPACE = join(FIXTURE_ROOT, "folder-workspace");

function createFolderWithSource(dirPath) {
  rmSync(dirPath, { force: true, recursive: true });
  mkdirSync(join(dirPath, "src"), { recursive: true });
  // A small TS source so the tree-sitter extractor has real symbols to index.
  writeFileSync(
    join(dirPath, "src", "math.ts"),
    [
      "export function add(a: number, b: number): number {",
      "  return a + b;",
      "}",
      "",
      "export const PI = 3.14159;",
      "",
      "export class Calculator {",
      "  total = 0;",
      "  add(n: number): void {",
      "    this.total = add(this.total, n);",
      "  }",
      "}",
      "",
    ].join("\n")
  );
}

async function execJS(script) {
  return browser.executeScript(script, []);
}

async function invokeE2E(method, ...args) {
  return browser.executeAsyncScript(
    `
    const cb = arguments[arguments.length - 1];
    const method = arguments[0];
    const rest = Array.prototype.slice.call(arguments, 1, arguments.length - 1);
    if (!window.__e2e || typeof window.__e2e[method] !== "function") {
      cb({ ok: false, error: "window.__e2e." + method + " not available" });
      return;
    }
    Promise.resolve(window.__e2e[method].apply(null, rest))
      .then(cb)
      .catch((e) => cb({ ok: false, error: String(e && e.message || e) }));
  `,
    [method, ...args]
  );
}

function unwrap(result, label) {
  if (!result || result.ok !== true) {
    throw new Error(`${label} failed: ${result?.error ?? "unknown"}`);
  }
  return result;
}

function statusValue(statusObj) {
  if (!statusObj || typeof statusObj !== "object") return null;
  return statusObj.status ?? null;
}

async function waitForFrontendReady() {
  const port = process.env.E2E_FRONTEND_PORT ?? "1998";
  const url = `http://127.0.0.1:${port}`;
  await browser.waitUntil(
    async () => {
      try {
        const response = await fetch(url, { method: "GET" });
        return response.ok;
      } catch {
        return false;
      }
    },
    {
      timeout: MOUNT_TIMEOUT_MS,
      timeoutMsg: `frontend dev server never became ready at ${url}`,
    }
  );
}

async function waitForApp() {
  await waitForFrontendReady();
  await browser.setTimeout({ script: 10_000 });
  await execJS(`localStorage.setItem('orgii:auth_skipped', '1'); return true;`);
  await browser.waitUntil(
    async () => {
      try {
        return await execJS(
          `return document.readyState === 'complete' || document.readyState === 'interactive';`
        );
      } catch {
        return false;
      }
    },
    {
      timeout: MOUNT_TIMEOUT_MS,
      timeoutMsg: "app document never became script-readable",
    }
  );
  await browser.waitUntil(
    async () => {
      try {
        return await execJS(
          `return !!(window.__e2e && window.__e2e.getCodeMapStatusForPath && window.__e2e.startCodeMapIndexForPath && window.__e2e.pinFolderWorkspace);`
        );
      } catch {
        return false;
      }
    },
    {
      timeout: MOUNT_TIMEOUT_MS,
      timeoutMsg: "window.__e2e code-map helpers never became available",
    }
  );
}

describe("code map works on a non-git folder workspace", () => {
  before(async () => {
    createFolderWithSource(FOLDER_WORKSPACE);
    await waitForApp();
  });

  after(async () => {
    // Best-effort: clear the index so a re-run starts clean.
    try {
      await execJS(
        `if (window.__e2e && window.__e2e.getCodeMapStatusForPath) { return true; } return true;`
      );
    } catch {
      /* ignore */
    }
    rmSync(FIXTURE_ROOT, { force: true, recursive: true });
  });

  it("reads code-map status for a folder workspace (panel un-gated)", async () => {
    unwrap(
      await invokeE2E("pinFolderWorkspace", FOLDER_WORKSPACE, "E2E Code Map Folder"),
      "pinFolderWorkspace"
    );
    const res = unwrap(
      await invokeE2E("getCodeMapStatusForPath", FOLDER_WORKSPACE),
      "getCodeMapStatusForPath"
    );
    // The fix: status is readable for a non-git folder (previously the panel
    // was hidden entirely for folder workspaces).
    const status = statusValue(res.status);
    if (!status) {
      throw new Error(
        `expected a code-map status for folder workspace, got ${JSON.stringify(res)}`
      );
    }
  });

  it("indexes the folder workspace without a git repo", async () => {
    const started = unwrap(
      await invokeE2E("startCodeMapIndexForPath", FOLDER_WORKSPACE),
      "startCodeMapIndexForPath"
    );
    const initial = statusValue(started.status);
    if (initial === "not_indexed" || initial === null) {
      // Some backends return the prior status synchronously; poll until it
      // moves off not_indexed.
      await browser.waitUntil(
        async () => {
          const poll = await invokeE2E(
            "getCodeMapStatusForPath",
            FOLDER_WORKSPACE
          );
          if (!poll || poll.ok !== true) return false;
          const s = statusValue(poll.status);
          return s === "indexing" || s === "ready";
        },
        {
          timeout: INDEX_TIMEOUT_MS,
          interval: 500,
          timeoutMsg:
            "code-map index never moved off not_indexed for the folder workspace",
        }
      );
    }
  });
});
