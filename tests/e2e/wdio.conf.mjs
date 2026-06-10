import dotenv from "dotenv";
import { execFileSync, spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const appBinary = resolve(repoRoot, "src-tauri/target/debug/orgii");

// Load tests/e2e/.env so specs can read OPENAI_API_KEY etc. via process.env.
// Quiet failure is fine — the .env is optional; without it, tests fall back to
// the weak "agent started processing" assertion.
dotenv.config({ path: resolve(__dirname, ".env"), quiet: true });

const specFileRetries = Number.parseInt(
  process.env.WDIO_SPEC_FILE_RETRIES ?? "0",
  10
);
const mochaTimeoutMs = Number.parseInt(
  process.env.WDIO_MOCHA_TIMEOUT_MS ?? "420000",
  10
);
const connectionRetryTimeoutMs = Number.parseInt(
  process.env.WDIO_CONNECTION_RETRY_TIMEOUT_MS ?? "30000",
  10
);
const connectionRetryCount = Number.parseInt(
  process.env.WDIO_CONNECTION_RETRY_COUNT ?? "10",
  10
);
const reuseServices = process.env.E2E_REUSE_SERVICES === "1";
const allowParallel = process.env.E2E_ALLOW_PARALLEL === "1";
const isolatedRun = process.env.E2E_ISOLATED_RUN === "1";
const allowPortCleanup = process.env.E2E_ALLOW_PORT_CLEANUP === "1";
const webDriverPort = Number.parseInt(
  process.env.E2E_WEBDRIVER_PORT ?? "4444",
  10
);
const ideServerPort = Number.parseInt(
  process.env.E2E_IDE_SERVER_PORT ?? "13847",
  10
);
const TAURI_DEV_URL_PORT = 1998;
const frontendPort = Number.parseInt(
  process.env.E2E_FRONTEND_PORT ?? String(TAURI_DEV_URL_PORT),
  10
);
const tauriConfigPath = resolve(repoRoot, "src-tauri/tauri.conf.json");

if (allowParallel && !reuseServices) {
  throw new Error(
    "E2E_ALLOW_PARALLEL=1 is only supported with E2E_REUSE_SERVICES=1. Start one shared frontend/app stack explicitly, then run isolated WDIO workers against it."
  );
}

if (allowParallel || isolatedRun) {
  const missingPortVars = ["E2E_WEBDRIVER_PORT", "E2E_IDE_SERVER_PORT"].filter(
    (name) => !process.env[name]
  );
  if (missingPortVars.length > 0) {
    throw new Error(
      `isolated WDIO runs require explicit ports: ${missingPortVars.join(", ")}`
    );
  }
}

if (isolatedRun && !process.env.E2E_ORGII_HOME) {
  throw new Error("E2E_ISOLATED_RUN=1 requires E2E_ORGII_HOME");
}
const sourceOrgiiHome =
  process.env.E2E_ORGII_HOME_SEED_SOURCE ??
  (isolatedRun
    ? join(homedir(), ".orgii")
    : (process.env.ORGII_HOME ?? join(homedir(), ".orgii")));
// Isolation is the DEFAULT: non-isolated runs previously used the real
// ~/.orgii, which is how "E2E Custom Member Agent" fixtures leaked into
// the user's actual agent-definitions.json whenever a spec crashed
// before its finally-cleanup. Touching the real home now requires the
// explicit opt-in E2E_USE_REAL_HOME=1.
const useRealHome = process.env.E2E_USE_REAL_HOME === "1";
const orgiiHome =
  process.env.E2E_ORGII_HOME ??
  (useRealHome ? undefined : mkdtempSync(join(tmpdir(), "orgii-e2e-shard-")));

const ORGII_HOME_SEED_ENTRIES = [
  "agent-definitions.json",
  "agent-orgs.json",
  "auth_tokens.json",
  "builtin-overrides.json",
  "claude-code-cli-profiles",
  "codex-cli-profiles",
  "credentials.json",
  "cursor-cli-profiles",
  "data",
  "gemini-cli-profiles",
  "integrations.json",
  "mcp-servers.json",
  "personal",
  "projects",
  "rules",
  "rules-config.json",
  "settings.jsonc",
  "skills",
  "workspace-memory",
];

// OAuth providers (Anthropic, Google, OpenAI Codex) use rotating refresh
// tokens. Every successful refresh invalidates the previous token. If an
// isolated E2E home and the user's source home diverge, the older copy will
// replay a revoked refresh token and permanently disable the account.
//
// Most OAuth-adjacent files can be preserved when a named isolated home already
// owns a valid chain. `credentials.json` is reconciled below instead of blindly
// preserved so a stale isolated home cannot beat a fresher source home.
const ORGII_HOME_SEED_PRESERVE_IF_EXISTS = new Set([
  "auth_tokens.json",
  "claude-code-cli-profiles",
  "codex-cli-profiles",
  "credentials.json",
  "cursor-cli-profiles",
  "gemini-cli-profiles",
]);
const ORGII_HOME_SEED_EXCLUDED_NAMES = new Set([
  ".cargo",
  ".rustup",
  ".tmp",
  "node_modules",
  "target",
  "tmp",
]);
const e2eMultiRepoWorkspace = process.env.E2E_MULTI_REPO_WORKSPACE === "1";
const fixtureRepoPath = resolve(
  process.env.E2E_FIXTURE_REPO_PATH ??
    (process.platform === "win32"
      ? join(tmpdir(), "orgii-e2e-workspace-repo")
      : "/tmp/orgii-e2e-workspace-repo")
);

function shouldSeedOrgiiHomePath(sourcePath) {
  return !sourcePath
    .split("/")
    .some((segment) => ORGII_HOME_SEED_EXCLUDED_NAMES.has(segment));
}

function seedOrgiiHomeForParallel(sourceHome, targetHome) {
  if (!(allowParallel || isolatedRun)) return;
  if (process.env.E2E_ORGII_HOME && !isolatedRun) return;
  if (resolve(sourceHome) === resolve(targetHome)) return;
  mkdirSync(targetHome, { recursive: true });
  for (const entry of ORGII_HOME_SEED_ENTRIES) {
    const sourcePath = join(sourceHome, entry);
    if (!existsSync(sourcePath)) continue;
    const targetPath = join(targetHome, entry);
    // Preserve OAuth rotation chains: do NOT clobber the iso home's own
    // copies of credentials.json / *-cli-profiles / auth_tokens.json once
    // they exist. See ORGII_HOME_SEED_PRESERVE_IF_EXISTS for the rationale.
    if (
      ORGII_HOME_SEED_PRESERVE_IF_EXISTS.has(entry) &&
      existsSync(targetPath)
    ) {
      continue;
    }
    cpSync(sourcePath, targetPath, {
      dereference: false,
      errorOnExist: false,
      filter: shouldSeedOrgiiHomePath,
      force: true,
      recursive: true,
    });
  }
}

function resetDerivedProjectDatabaseForIsolatedRun(targetHome) {
  if (!isolatedRun || !targetHome) return;
  rmSync(join(targetHome, "projects", "projects.db"), {
    force: true,
    recursive: true,
  });
}

// Rotation-only fields we mirror from the iso credentials.json back to the
// user's source ~/.orgii/credentials.json. When those fields change, the OAuth
// chain has recovered, so mirror-back also clears derived refresh-failure state.
// Everything unrelated to OAuth rotation (quota_info, model_aliases, base_url,
// ...) is owned by the user and must not be clobbered by E2E.
const ROTATING_OAUTH_MODEL_TYPES = new Set([
  "claude_code",
  "codex",
  "gemini_cli",
]);
const OAUTH_ROTATION_FIELDS = ["session_token"];
const OAUTH_ROTATION_ENV_VAR_PATTERNS = [
  /_REFRESH_TOKEN$/i,
  /_EXPIRES_AT$/i,
  /_EXPIRES_IN$/i,
  /_TOKEN_TYPE$/i,
  /_SCOPE$/i,
];

function isRotationEnvVar(name) {
  return OAUTH_ROTATION_ENV_VAR_PATTERNS.some((pattern) => pattern.test(name));
}

function safeReadJson(path) {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf8");
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch (error) {
    console.warn(
      `[wdio] mirror-back: failed to parse ${path}: ${error?.message ?? error}`
    );
    return null;
  }
}

function atomicWriteJson(path, value) {
  const tmpPath = `${path}.wdio-mirror.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmpPath, path);
}

const SOURCE_OWNED_OAUTH_STATUS_FIELDS = [
  "enabled",
  "health_status",
  "last_validation_error",
  "last_validated_at",
  "oauth_refresh_failure_count",
  "last_oauth_refresh_failed_at",
];

function oauthExpiryMs(key) {
  const envVars = key?.env_vars ?? {};
  const raw = Object.entries(envVars).find(([name]) =>
    /_EXPIRES_AT$/i.test(name)
  )?.[1];
  if (raw === undefined || raw === null || raw === "") return 0;
  const value = Number.parseInt(String(raw), 10);
  return Number.isFinite(value) ? value : 0;
}

function copyOAuthRotationFields(targetKey, sourceKey) {
  let didChange = false;
  for (const field of OAUTH_ROTATION_FIELDS) {
    if (
      sourceKey[field] !== undefined &&
      targetKey[field] !== sourceKey[field]
    ) {
      targetKey[field] = sourceKey[field];
      didChange = true;
    }
  }

  const sourceEnv = sourceKey.env_vars ?? {};
  const targetEnv = targetKey.env_vars ?? {};
  for (const [name, value] of Object.entries(sourceEnv)) {
    if (!isRotationEnvVar(name)) continue;
    if (targetEnv[name] !== value) {
      targetEnv[name] = value;
      didChange = true;
    }
  }
  if (didChange) targetKey.env_vars = targetEnv;
  return didChange;
}

function markOAuthRotationKnownGood(key) {
  key.enabled = true;
  key.health_status = "unknown";
  key.oauth_refresh_failure_count = 0;
  key.last_oauth_refresh_failed_at = null;
  key.last_validation_error = null;
  key.updated_at = new Date().toISOString();
}

function reconcileOAuthRotationFields(sourceHome, isoHome) {
  if (!sourceHome || !isoHome) return;
  if (resolve(sourceHome) === resolve(isoHome)) return;

  const sourcePath = join(sourceHome, "credentials.json");
  const isoPath = join(isoHome, "credentials.json");
  const sourceDoc = safeReadJson(sourcePath);
  const isoDoc = safeReadJson(isoPath);
  if (!sourceDoc?.credentials || !isoDoc?.credentials) return;

  let sourceChanged = false;
  let isoChanged = false;
  const changedNames = [];

  for (const [keyId, sourceKey] of Object.entries(sourceDoc.credentials)) {
    if (!sourceKey || sourceKey.auth_method !== "oauth") continue;
    if (!ROTATING_OAUTH_MODEL_TYPES.has(sourceKey.agent_type)) continue;

    const isoKey = isoDoc.credentials[keyId];
    if (!isoKey || isoKey.auth_method !== "oauth") continue;
    if (isoKey.agent_type !== sourceKey.agent_type) continue;

    const sourceExpiry = oauthExpiryMs(sourceKey);
    const isoExpiry = oauthExpiryMs(isoKey);
    if (sourceExpiry === isoExpiry) continue;

    if (sourceExpiry > isoExpiry) {
      if (copyOAuthRotationFields(isoKey, sourceKey)) {
        markOAuthRotationKnownGood(isoKey);
        isoChanged = true;
        changedNames.push(`${sourceKey.name ?? keyId}:source-to-iso`);
      }
    } else if (copyOAuthRotationFields(sourceKey, isoKey)) {
      markOAuthRotationKnownGood(sourceKey);
      sourceChanged = true;
      changedNames.push(`${sourceKey.name ?? keyId}:iso-to-source`);
    }
  }

  if (sourceChanged) {
    sourceDoc.updated_at = new Date().toISOString();
    atomicWriteJson(sourcePath, sourceDoc);
  }
  if (isoChanged) {
    isoDoc.updated_at = new Date().toISOString();
    atomicWriteJson(isoPath, isoDoc);
  }
  if (changedNames.length > 0) {
    console.log(
      `[wdio] seed: reconciled fresher OAuth rotation field(s): ${changedNames.join(", ")}`
    );
  }
}

function reconcilePreservedOAuthCredentialStatus(sourceHome, isoHome) {
  if (!sourceHome || !isoHome) return;
  if (resolve(sourceHome) === resolve(isoHome)) return;

  const sourcePath = join(sourceHome, "credentials.json");
  const isoPath = join(isoHome, "credentials.json");
  const sourceDoc = safeReadJson(sourcePath);
  const isoDoc = safeReadJson(isoPath);
  if (!sourceDoc?.credentials || !isoDoc?.credentials) return;

  let reconciled = 0;
  const changedNames = [];
  for (const [keyId, isoKey] of Object.entries(isoDoc.credentials)) {
    if (!isoKey || isoKey.auth_method !== "oauth") continue;
    const sourceKey = sourceDoc.credentials[keyId];
    if (!sourceKey || sourceKey.auth_method !== "oauth") continue;

    let didChange = false;
    for (const field of SOURCE_OWNED_OAUTH_STATUS_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(sourceKey, field)) {
        if (isoKey[field] !== sourceKey[field]) {
          isoKey[field] = sourceKey[field];
          didChange = true;
        }
      } else if (Object.prototype.hasOwnProperty.call(isoKey, field)) {
        delete isoKey[field];
        didChange = true;
      }
    }

    if (didChange) {
      isoKey.updated_at = new Date().toISOString();
      reconciled += 1;
      changedNames.push(isoKey.name ?? keyId);
    }
  }

  if (reconciled === 0) return;
  isoDoc.updated_at = new Date().toISOString();
  try {
    atomicWriteJson(isoPath, isoDoc);
    console.log(
      `[wdio] seed: reconciled ${reconciled} preserved OAuth account status field(s) in ${isoPath}: ${changedNames.join(", ")}`
    );
  } catch (error) {
    console.warn(
      `[wdio] seed: failed to reconcile ${isoPath}: ${error?.message ?? error}`
    );
  }
}

// Mirror rotated OAuth tokens from the iso home's credentials.json back to
// the user's source ~/.orgii/credentials.json. OAuth providers (Anthropic,
// Google, OpenAI Codex) issue a fresh refresh_token on every successful
// refresh and invalidate the previous one server-side. If E2E ran inside
// an iso home, that home now holds the only valid token in the chain — the
// user's source home still has the old (now-revoked) token and will be
// permanently disabled the next time the dev app tries to refresh.
//
// To avoid burning the user's source account every time E2E runs, we copy
// only the rotation-sensitive fields back. If a token was refreshed, we also
// clear derived OAuth failure state because the chain is known-good again.
// Everything else (quotas, aliases, custom base_url, ...) stays owned by the
// user's source home.
//
// Opt out by setting ORGII_E2E_MIRROR_OAUTH_BACK=0. Always skipped when iso
// === source (no isolation) or when only one of the two files exists.
function mirrorRotatedOAuthTokensBack(sourceHome, isoHome) {
  if (process.env.ORGII_E2E_MIRROR_OAUTH_BACK === "0") return;
  if (!sourceHome || !isoHome) return;
  if (resolve(sourceHome) === resolve(isoHome)) return;

  const sourcePath = join(sourceHome, "credentials.json");
  const isoPath = join(isoHome, "credentials.json");
  const sourceDoc = safeReadJson(sourcePath);
  const isoDoc = safeReadJson(isoPath);
  if (!sourceDoc?.credentials || !isoDoc?.credentials) return;

  let mirrored = 0;
  const changedNames = [];
  for (const [keyId, isoKey] of Object.entries(isoDoc.credentials)) {
    if (!isoKey || isoKey.auth_method !== "oauth") continue;
    if (!ROTATING_OAUTH_MODEL_TYPES.has(isoKey.agent_type)) continue;
    const sourceKey = sourceDoc.credentials[keyId];
    if (!sourceKey) continue;
    if (sourceKey.agent_type !== isoKey.agent_type) continue;

    if (copyOAuthRotationFields(sourceKey, isoKey)) {
      markOAuthRotationKnownGood(sourceKey);
      mirrored += 1;
      changedNames.push(sourceKey.name ?? keyId);
    }
  }

  if (mirrored === 0) return;

  sourceDoc.updated_at = new Date().toISOString();
  try {
    atomicWriteJson(sourcePath, sourceDoc);
    console.log(
      `[wdio] mirror-back: refreshed ${mirrored} OAuth account(s) in ${sourcePath}: ${changedNames.join(", ")}`
    );
  } catch (error) {
    console.warn(
      `[wdio] mirror-back: failed to write ${sourcePath}: ${error?.message ?? error}`
    );
  }
}

if (orgiiHome) {
  seedOrgiiHomeForParallel(sourceOrgiiHome, orgiiHome);
  reconcileOAuthRotationFields(sourceOrgiiHome, orgiiHome);
  reconcilePreservedOAuthCredentialStatus(sourceOrgiiHome, orgiiHome);
  resetDerivedProjectDatabaseForIsolatedRun(orgiiHome);
  process.env.ORGII_HOME = orgiiHome;
}
function ensureBenchmarkDockerFixtureRepo() {
  if (process.env.ORGII_SWE_BENCH_PRO_REPO_PATH) return;
  const fixtureRoot = join(tmpdir(), "orgii-e2e-swe-bench-pro-fixture");
  const runScriptsDir = join(fixtureRoot, "run_scripts", "e2e_docker_task");
  mkdirSync(runScriptsDir, { recursive: true });
  writeFileSync(
    join(fixtureRoot, "swe_bench_pro_eval.py"),
    `#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import sys

parser = argparse.ArgumentParser()
parser.add_argument("--raw_sample_path", required=True)
parser.add_argument("--patch_path", required=True)
parser.add_argument("--output_dir", required=True)
parser.add_argument("--scripts_dir", required=True)
parser.add_argument("--dockerhub_username")
parser.add_argument("--use_local_docker", action="store_true")
parser.add_argument("--num_workers", default="1")
args = parser.parse_args()

with open(args.patch_path, "r", encoding="utf-8") as handle:
    patch_rows = json.load(handle)
task_id = patch_rows[0]["instance_id"]
command = ["docker", "run", "--rm", "alpine:3.20", "sh", "-lc", "echo orgii-docker-benchmark-e2e"]
print("running docker command:", " ".join(command), flush=True)
completed = subprocess.run(command, text=True, capture_output=True)
print(completed.stdout, end="", flush=True)
if completed.stderr:
    print(completed.stderr, end="", file=sys.stderr, flush=True)
os.makedirs(args.output_dir, exist_ok=True)
with open(os.path.join(args.output_dir, "eval_results.json"), "w", encoding="utf-8") as handle:
    json.dump({task_id: completed.returncode == 0 and "orgii-docker-benchmark-e2e" in completed.stdout}, handle)
sys.exit(completed.returncode)
`,
    "utf8"
  );
  writeFileSync(join(runScriptsDir, "run_script.sh"), "#!/usr/bin/env bash\necho e2e run script\n", "utf8");
  writeFileSync(join(runScriptsDir, "parser.py"), "print('e2e parser')\n", "utf8");
  process.env.ORGII_SWE_BENCH_PRO_REPO_PATH = fixtureRoot;
}

process.env.ORGII_IDE_SERVER_PORT = String(ideServerPort);
process.env.E2E_BASE_URL =
  process.env.E2E_BASE_URL ?? `http://127.0.0.1:${ideServerPort}`;
ensureE2EWorkspaceRepo();
ensureBenchmarkDockerFixtureRepo();

const WDIO_PRE_FLIGHT_PORTS = [webDriverPort, frontendPort, ideServerPort];
const WDIO_PRE_FLIGHT_PROCESS_PATTERNS = [
  "tauri-wd",
  "src-tauri/target/debug/orgii",
];
let frontendServerProcess = null;
let tauriWebDriverProcess = null;

function runBestEffort(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: "pipe",
      ...options,
    });
  } catch {
    return "";
  }
}

function isGitRepository(repoPath) {
  return runBestEffort("git", [
    "-C",
    repoPath,
    "rev-parse",
    "--is-inside-work-tree",
  ])
    .trim()
    .includes("true");
}

function verifyE2EWorkspaceRepo(repoPath) {
  if (!existsSync(repoPath)) {
    throw new Error(`E2E_REPO_PATH does not exist: ${repoPath}`);
  }
  if (!isGitRepository(repoPath)) {
    throw new Error(`E2E_REPO_PATH must be a git repository: ${repoPath}`);
  }
  const packagePath = join(repoPath, "package.json");
  const readmePath = join(repoPath, "README.md");
  if (!existsSync(packagePath) || !existsSync(readmePath)) {
    throw new Error(
      `E2E_REPO_PATH must contain package.json and README.md so workspace selection and CLI prompts are deterministic: ${repoPath}`
    );
  }
}

function createFixtureRepo(repoPath) {
  rmSync(repoPath, { force: true, recursive: true });
  mkdirSync(join(repoPath, "src"), { recursive: true });
  writeFileSync(
    join(repoPath, "README.md"),
    [
      "# ORGII E2E Workspace Repo",
      "",
      "This repository is generated by the ORGII WDIO runner.",
      "It is intentionally small, non-empty, and safe for agent mutation tests.",
      "",
    ].join("\n")
  );
  writeFileSync(
    join(repoPath, "package.json"),
    `${JSON.stringify(
      {
        name: "orgii-e2e-workspace-repo",
        private: true,
        type: "module",
      },
      null,
      2
    )}\n`
  );
  writeFileSync(
    join(repoPath, "src", "math.ts"),
    [
      "export function addNumbers(first: number, second: number): number {",
      "  return first + second;",
      "}",
      "",
    ].join("\n")
  );
  execFileSync("git", ["init", "--initial-branch=main", repoPath], {
    stdio: "ignore",
  });
  execFileSync(
    "git",
    ["-C", repoPath, "add", "README.md", "package.json", "src/math.ts"],
    {
      stdio: "ignore",
    }
  );
  execFileSync(
    "git",
    [
      "-C",
      repoPath,
      "-c",
      "user.name=ORGII E2E",
      "-c",
      "user.email=e2e@orgii.local",
      "commit",
      "-m",
      "Initial E2E workspace",
    ],
    {
      stdio: "ignore",
    }
  );
  verifyE2EWorkspaceRepo(repoPath);
}

function createMultiRepoFixtureWorkspace(rootPath) {
  rmSync(rootPath, { force: true, recursive: true });
  const primaryRepoPath = join(rootPath, "primary-repo");
  const siblingRepoPath = join(rootPath, "sibling-repo");
  createFixtureRepo(primaryRepoPath);
  createFixtureRepo(siblingRepoPath);
  writeFileSync(
    join(siblingRepoPath, "src", "math.ts"),
    [
      "export function addNumbers(first: number, second: number): number {",
      "  return first - second;",
      "}",
      "",
      "export const SIBLING_ONLY_SENTINEL = 'ORGII_E2E_SIBLING_REPO';",
      "",
    ].join("\n")
  );
  execFileSync("git", ["-C", siblingRepoPath, "add", "src/math.ts"], {
    stdio: "ignore",
  });
  execFileSync(
    "git",
    [
      "-C",
      siblingRepoPath,
      "-c",
      "user.name=ORGII E2E",
      "-c",
      "user.email=e2e@orgii.local",
      "commit",
      "-m",
      "Add sibling sentinel",
    ],
    { stdio: "ignore" }
  );
  return primaryRepoPath;
}

function ensureE2EWorkspaceRepo() {
  const explicitRepoPath = process.env.E2E_REPO_PATH;
  if (explicitRepoPath) {
    const repoPath = resolve(explicitRepoPath);
    verifyE2EWorkspaceRepo(repoPath);
    process.env.E2E_REPO_PATH = repoPath;
    return repoPath;
  }
  const repoPath = e2eMultiRepoWorkspace
    ? createMultiRepoFixtureWorkspace(fixtureRepoPath)
    : fixtureRepoPath;
  if (!e2eMultiRepoWorkspace) {
    createFixtureRepo(repoPath);
  }
  process.env.E2E_REPO_PATH = repoPath;
  return repoPath;
}

function killProcessIds(processIds) {
  const uniqueProcessIds = Array.from(new Set(processIds.filter(Boolean)));
  if (uniqueProcessIds.length === 0) return;
  runBestEffort("kill", ["-TERM", ...uniqueProcessIds]);
}

function processIdsForPort(port) {
  return runBestEffort("lsof", ["-ti", `tcp:${port}`])
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function processIdsForPattern(pattern) {
  return runBestEffort("pgrep", ["-f", pattern])
    .split(/\s+/)
    .map((value) => value.trim())
    .filter((processId) => processId && processId !== String(process.pid));
}

function cleanWebDriverEnvironment() {
  if (!allowPortCleanup) return;
  const portsToClean =
    allowParallel || isolatedRun
      ? [webDriverPort, frontendPort, ideServerPort]
      : WDIO_PRE_FLIGHT_PORTS;
  const portProcessIds = portsToClean.flatMap(processIdsForPort);
  const staleProcessIds =
    allowParallel || isolatedRun
      ? []
      : WDIO_PRE_FLIGHT_PROCESS_PATTERNS.flatMap(processIdsForPattern);
  killProcessIds([...portProcessIds, ...staleProcessIds]);
}

function assertManagedPortsAvailable() {
  if (allowPortCleanup || reuseServices) return;
  const occupiedPorts = WDIO_PRE_FLIGHT_PORTS.filter(
    (port) => processIdsForPort(port).length > 0
  );
  if (occupiedPorts.length === 0) return;
  throw new Error(
    `Refusing to start managed WDIO while port(s) ${occupiedPorts.join(", ")} are in use. Close the running ORGII app first, or set E2E_ALLOW_PORT_CLEANUP=1 to let WDIO terminate stale processes.`
  );
}

function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (processIdsForPort(port).length > 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  }
  throw new Error(`Port ${port} did not open within ${timeoutMs}ms`);
}

function startFrontendServer() {
  if (processIdsForPort(frontendPort).length > 0) return;
  frontendServerProcess = spawn("pnpm", ["run", "start:fast"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ORGII_E2E: "1",
      PORT: String(frontendPort),
      WEBPACK_DEV_SERVER_PORT: String(frontendPort),
    },
    stdio: "inherit",
  });
  waitForPort(frontendPort, 60_000);
}

function withTauriDevUrlForFrontendPort(callback) {
  if (frontendPort === TAURI_DEV_URL_PORT) return callback();
  const originalConfig = readFileSync(tauriConfigPath, "utf8");
  const config = JSON.parse(originalConfig);
  const patchedConfig = JSON.stringify(
    {
      ...config,
      build: {
        ...config.build,
        devUrl: `http://localhost:${frontendPort}`,
      },
    },
    null,
    2
  );
  writeFileSync(tauriConfigPath, `${patchedConfig}\n`);
  try {
    return callback();
  } finally {
    writeFileSync(tauriConfigPath, originalConfig);
  }
}

function buildWebDriverApp() {
  withTauriDevUrlForFrontendPort(() => {
    execFileSync(
      "cargo",
      [
        "build",
        "--manifest-path",
        resolve(repoRoot, "src-tauri/Cargo.toml"),
        "-p",
        "orgii",
        "--features",
        "webdriver",
      ],
      { cwd: repoRoot, stdio: "inherit" }
    );
  });
}

function startTauriWebDriver() {
  tauriWebDriverProcess = spawn("tauri-wd", ["--port", String(webDriverPort)], {
    stdio: "inherit",
  });
  waitForPort(webDriverPort, 10_000);
}

function stopChildProcess(childProcess) {
  if (!childProcess) return;
  childProcess.kill("SIGTERM");
}

function stopTauriWebDriver() {
  stopChildProcess(tauriWebDriverProcess);
  tauriWebDriverProcess = null;
}

function stopFrontendServer() {
  stopChildProcess(frontendServerProcess);
  frontendServerProcess = null;
}

export const config = {
  runner: "local",
  specs: ["./specs/core/**/*.spec.mjs"],
  maxInstances: 1,
  hostname: "127.0.0.1",
  port: webDriverPort,
  path: "/",
  capabilities: [
    {
      timeouts: {
        script: mochaTimeoutMs,
      },
      "tauri:options": {
        binary: appBinary,
      },
    },
  ],
  logLevel: process.env.WDIO_LOG_LEVEL ?? "warn",
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    timeout: mochaTimeoutMs,
  },
  waitforTimeout: 30_000,
  connectionRetryTimeout: connectionRetryTimeoutMs,
  connectionRetryCount,
  // Keep webdriver-level retries bounded so no-window handshakes and hung
  // commands fail quickly instead of stalling the whole E2E run for minutes.
  automationProtocol: "webdriver",
  injectGlobals: true,
  onPrepare() {
    if (reuseServices) return;
    assertManagedPortsAvailable();
    cleanWebDriverEnvironment();
    startFrontendServer();
    buildWebDriverApp();
    startTauriWebDriver();
  },
  before: async function () {
    await browser.setTimeout({ script: mochaTimeoutMs });
    await browser.waitUntil(
      async () => {
        try {
          await browser.executeScript(
            "window.localStorage.setItem(arguments[0], arguments[1]);",
            ["orgii:e2eBaseUrl", process.env.E2E_BASE_URL]
          );
          return true;
        } catch {
          return false;
        }
      },
      {
        timeout: 30_000,
        timeoutMsg: "E2E base URL could not be written to browser localStorage",
      }
    );
  },
  onComplete() {
    // Always attempt to mirror rotated OAuth tokens back to the user's source
    // ~/.orgii so the dev app keeps working after E2E runs. Safe no-op when
    // iso === source or nothing rotated.
    try {
      mirrorRotatedOAuthTokensBack(sourceOrgiiHome, orgiiHome);
    } catch (error) {
      console.warn(`[wdio] mirror-back failed: ${error?.message ?? error}`);
    }
    if (reuseServices) return;
    stopTauriWebDriver();
    stopFrontendServer();
  },
  // tauri-wd's getWindowHandle() occasionally races the WKWebView's first
  // paint on cold boot ("no window" WebDriverError within the first ~500ms).
  // Two retries swallow that handshake flake without hiding real failures.
  specFileRetries,
  specFileRetriesDelay: 3,
};
