/**
 * Agent Prompt Dump API
 *
 * Structured introspection of the live system prompt for an active
 * session. Backed by the `prompt_dump` Tauri command (see
 * `src-tauri/src/agent_core/state/commands/session/prompt_dump.rs`).
 *
 * The wire shape mirrors the registry traces produced by
 * `prompt::registry::assemble`. Frontend consumers are E2E specs (via
 * `window.__e2e.promptDump`) and any future devtools panel that wants
 * to render the per-section breakdown.
 *
 * Wire contract:
 * - `sections` is ordered by `orderHint` already (the backend sorts
 *   before serializing), so consumers don't need to re-sort.
 * - `applies = false` rows are still present so debugging "why
 *   didn't my section render" reads as a single map lookup, not a
 *   negative-grep.
 * - `content` is `null` when `applies` is false; when `applies` is
 *   true and `content` is `null` it means the section opted out at
 *   render time (e.g. empty rule list, no learnings yet).
 */
import { invokeTauri } from "@src/util/platform/tauri/init";

export type PromptSourceKind = "builtin" | "override_file" | "computed";

export interface PromptSourceWire {
  kind: PromptSourceKind;
  upstream: string | null;
  path: string | null;
}

export interface PromptDumpSection {
  sectionId: string;
  orderHint: number;
  applies: boolean;
  reason: string;
  source: PromptSourceWire;
  sovereignSafe: boolean;
  content: string | null;
}

export interface PromptDumpResult {
  sessionId: string;
  agentId: string;
  agentDefinitionId: string | null;
  model: string;
  sovereign: boolean;
  isChannelSession: boolean;
  isWorkspaceSession: boolean;
  loadWorkspaceResources: boolean;
  loadWorkspaceRules: boolean;
  prompt: string;
  promptLen: number;
  sections: PromptDumpSection[];
}

export async function promptDump(sessionId: string): Promise<PromptDumpResult> {
  return invokeTauri<PromptDumpResult>("prompt_dump", { sessionId });
}
