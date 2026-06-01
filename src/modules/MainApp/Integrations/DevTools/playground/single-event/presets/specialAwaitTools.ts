import type { StatusPreset } from "../../types";

// `await_output` event-type variants are split into 4 separate entries
// that each show up as their own row in the Playground's Event Type picker.
// Each variant only exposes presets whose base mock matches its own jobKind
// shape, so toggling presets inside a variant never invalidates the base JSON.
export const specialAwaitToolPresets: Record<string, StatusPreset[]> = {
  await_output: [
    {
      key: "wait-running",
      label: "Wait for (running, counting down)",
      status: "running",
      resultPatch: {
        output:
          '[48291: running]\nawaitMeta::{"count":1,"items":[{"handle":"48291","jobKind":"shell","status":"running","waitedMs":0,"patternMatched":false}]}\n--- [48291] last 50 lines ---\nCompiling agent_core v0.1.0 (38/52 crates)\n    Checking tools v0.1.0',
      },
      argsPatch: {
        command: "wait_for",
        handles: ["48291"],
        pattern: "Build succeeded",
        block_until_ms: 90000,
      },
    },
    {
      key: "wait-matched",
      label: "Wait for (pattern matched)",
      status: "completed",
      resultPatch: {
        output:
          '[48291: succeeded]\nawaitMeta::{"count":1,"items":[{"handle":"48291","jobKind":"shell","status":"succeeded","waitedMs":500,"patternMatched":true,"matchLine":"Build succeeded","exitCode":0}]}\n--- [48291] last 50 lines ---\nCompiling orgii-app v0.1.0\n    Checking agent_core v0.1.0\n    Finished dev [unoptimized + debuginfo] target(s) in 42.8s\nBuild succeeded',
      },
      argsPatch: {
        command: "wait_for",
        handles: ["48291"],
        pattern: "Build succeeded|error\\[",
        block_until_ms: 90000,
      },
    },
    {
      key: "monitor-succeeded",
      label: "Monitor (succeeded)",
      status: "completed",
      resultPatch: {
        output:
          '[48291: succeeded]\nawaitMeta::{"count":1,"items":[{"handle":"48291","jobKind":"shell","status":"succeeded","exitCode":0}]}\n--- [48291] last 50 lines ---\nAll 47 tests passed.\n\ntest result: ok. 47 passed; 0 failed; 0 ignored',
      },
      argsPatch: {
        command: "monitor",
        handles: ["48291"],
        pattern: undefined,
        block_until_ms: undefined,
      },
    },
    {
      key: "monitor-failed",
      label: "Monitor (failed)",
      status: "failed",
      resultPatch: {
        output:
          '[48291: failed]\nawaitMeta::{"count":1,"items":[{"handle":"48291","jobKind":"shell","status":"failed","exitCode":1}]}\n--- [48291] last 50 lines ---\nerror[E0308]: mismatched types\n  --> src/main.rs:42:5\n\nerror: aborting due to 1 previous error',
      },
      argsPatch: {
        command: "monitor",
        handles: ["48291"],
        pattern: undefined,
        block_until_ms: undefined,
      },
    },
    {
      key: "monitor-killed",
      label: "Monitor (killed)",
      status: "failed",
      resultPatch: {
        output:
          '[48291: failed]\nawaitMeta::{"count":1,"items":[{"handle":"48291","jobKind":"shell","status":"failed","killed":true}]}\n--- [48291] last 50 lines ---\n[killed by run_shell(kill_handle)]',
      },
      argsPatch: {
        command: "monitor",
        handles: ["48291"],
      },
    },
    {
      key: "monitor-not-found",
      label: "Monitor (not found)",
      status: "failed",
      resultPatch: {
        output:
          'No background job with handle "99999". It may have already completed and been cleaned up.',
      },
      argsPatch: {
        command: "monitor",
        handles: ["99999"],
        pattern: undefined,
        block_until_ms: undefined,
      },
    },
  ],
  await_output_subagent: [
    {
      key: "wait-running",
      label: "Wait for (running, counting down)",
      status: "running",
      resultPatch: {
        output:
          '[agent-builtin:explore-abc123: running]\nawaitMeta::{"count":1,"items":[{"handle":"agent-builtin:explore-abc123","jobKind":"subagent","status":"running","waitedMs":0}]}\n--- [agent-builtin:explore-abc123] last 50 lines ---\n[explore] Scanning src/ for component imports...',
      },
      argsPatch: {
        command: "wait_for",
        handles: ["agent-builtin:explore-abc123"],
        pattern: undefined,
        block_until_ms: 90000,
      },
    },
    {
      key: "monitor-succeeded",
      label: "Monitor (succeeded)",
      status: "completed",
      resultPatch: {
        output:
          '[agent-builtin:explore-abc123: succeeded]\nawaitMeta::{"count":1,"items":[{"handle":"agent-builtin:explore-abc123","jobKind":"subagent","status":"succeeded","exitCode":0}]}\n--- [agent-builtin:explore-abc123] last 50 lines ---\nSubagent finished. Found 7 matching files across 3 feature areas.\n\nsrc/modules/MainApp/Integrations/index.tsx\nsrc/features/auth/KeyVaultWizard.tsx\nsrc/features/session/SessionCreator.tsx',
      },
      argsPatch: {
        command: "monitor",
        handles: ["agent-builtin:explore-abc123"],
        pattern: undefined,
        block_until_ms: undefined,
      },
    },
    {
      key: "monitor-failed",
      label: "Monitor (failed)",
      status: "failed",
      resultPatch: {
        output:
          '[agent-builtin:general-ghi789: failed]\nawaitMeta::{{"count":1,"items":[{"handle":"agent-builtin:general-ghi789","jobKind":"subagent","status":"failed"}]}}\n--- [agent-builtin:general-ghi789] last 50 lines ---\nAgent \'General Agent\' failed: Context window exceeded (128k tokens). The task was too broad for a single pass.\n\nPartial result: scanned 42/120 files before limit.',
      },
      argsPatch: {
        command: "monitor",
        handles: ["agent-builtin:general-ghi789"],
        pattern: undefined,
        block_until_ms: undefined,
      },
    },
    {
      key: "monitor-not-found",
      label: "Monitor (not found)",
      status: "failed",
      resultPatch: {
        output:
          'No background job with handle "shadow-xyz". It may have already completed and been cleaned up.',
      },
      argsPatch: {
        command: "monitor",
        handles: ["shadow-xyz"],
        pattern: undefined,
        block_until_ms: undefined,
      },
    },
  ],
  await_output_multi: [
    {
      key: "wait-running",
      label: "Wait for (any) · shell + subagent",
      status: "running",
      resultPatch: {
        output:
          '[48291: running] [agent-builtin:explore-abc123: running]\nawaitMeta::{"count":2,"items":[{"handle":"48291","jobKind":"shell","status":"running","waitedMs":0},{"handle":"agent-builtin:explore-abc123","jobKind":"subagent","status":"running","waitedMs":0}]}\n--- [48291] last 20 lines ---\n[webpack] compiling...\n--- [agent-builtin:explore-abc123] last 20 lines ---\n[explore] scanning src/...',
      },
      argsPatch: {
        command: "wait_for",
        handles: ["48291", "agent-builtin:explore-abc123"],
        wait_mode: "any",
        block_until_ms: 90000,
      },
    },
    {
      key: "wait-all-subagents",
      label: "Wait for (all) · 3 subagents",
      status: "running",
      resultPatch: {
        output:
          '[agent-builtin:explore-abc123: running] [agent-builtin:debug-def456: running] [agent-builtin:plan-jkl012: running]\nawaitMeta::{"count":3,"items":[{"handle":"agent-builtin:explore-abc123","jobKind":"subagent","status":"running","waitedMs":0},{"handle":"agent-builtin:debug-def456","jobKind":"subagent","status":"running","waitedMs":0},{"handle":"agent-builtin:plan-jkl012","jobKind":"subagent","status":"running","waitedMs":0}]}\n--- [agent-builtin:explore-abc123] last 20 lines ---\n[explore] scanning src/...\n--- [agent-builtin:debug-def456] last 20 lines ---\n[debug] reproducing issue...\n--- [agent-builtin:plan-jkl012] last 20 lines ---\n[plan] drafting steps...',
      },
      argsPatch: {
        command: "wait_for",
        handles: [
          "agent-builtin:explore-abc123",
          "agent-builtin:debug-def456",
          "agent-builtin:plan-jkl012",
        ],
        wait_mode: "all",
        block_until_ms: 90000,
      },
    },
    {
      key: "monitor-mixed",
      label: "Monitor (mixed) · shell + subagent",
      status: "completed",
      resultPatch: {
        output:
          '[48291: running] [agent-builtin:explore-abc123: succeeded] [52107: failed]\nawaitMeta::{"count":3,"items":[{"handle":"48291","jobKind":"shell","status":"running","waitedMs":0},{"handle":"agent-builtin:explore-abc123","jobKind":"subagent","status":"succeeded","exitCode":0},{"handle":"52107","jobKind":"shell","status":"failed","exitCode":1}]}\n--- [48291] last 20 lines ---\nstill running...\n--- [agent-builtin:explore-abc123] last 20 lines ---\nFound 7 matches.\n--- [52107] last 20 lines ---\nerror[E0308]: mismatched types',
      },
      argsPatch: {
        command: "monitor",
        handles: ["48291", "agent-builtin:explore-abc123", "52107"],
      },
    },
  ],
  await_output_list: [
    {
      key: "list-with-items",
      label: "Jobs found",
      status: "completed",
      resultPatch: {
        output:
          '[background jobs]\nawaitMeta::{"command":"list","status":"succeeded","count":3,"items":[{"handle":"48291","kind":"shell","status":"running","ageMs":42800,"label":"npm run dev"},{"handle":"agent-builtin:explore-abc123","kind":"subagent","status":"succeeded","ageMs":15200,"label":"Explorer"},{"handle":"52107","kind":"shell","status":"failed","ageMs":8100,"label":"cargo test"}]}\nHANDLE          KIND              STATUS      AGE       LABEL\n48291           shell             running     42s       npm run dev\nagent-builtin:explore-abc123 subagent          succeeded  15s       Explorer\n52107           shell             failed      8s        cargo test',
      },
      argsPatch: {
        command: "list",
        handles: undefined,
        pattern: undefined,
        block_until_ms: undefined,
      },
    },
    {
      key: "list-empty",
      label: "No jobs",
      status: "completed",
      resultPatch: {
        output:
          '[background jobs]\nawaitMeta::{"command":"list","status":"succeeded","count":0,"items":[]}\nHANDLE          KIND              STATUS      AGE       LABEL\n(no background jobs)',
      },
      argsPatch: {
        command: "list",
        handles: undefined,
        pattern: undefined,
        block_until_ms: undefined,
      },
    },
  ],
};
