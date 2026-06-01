/**
 * External-agent artifact auto-import — Tauri API wrappers.
 *
 * Mirrors `src-tauri/src/agent_core/intelligence/external_import/commands.rs`.
 * Surfaces rule-flavored artifacts (Cursor IDE, Claude Code, GitHub
 * Copilot, Kiro), Claude Code skills (`~/.claude/skills/<name>/SKILL.md`
 * and `~/.claude/commands/*.md`), and Claude Code subagents
 * (`~/.claude/agents/*.md`). The apply path imports all three kinds —
 * `AgentDefinition` imports route through the live store so the new
 * agent appears in AgentOrgs without an app restart.
 */
import { invoke } from "@tauri-apps/api/core";

import type {
  DetectedItem,
  ImportReport,
  ImportSelection,
} from "@src/api/types/externalImport";

/**
 * Scan the user's machine for importable artifacts authored for other
 * coding agents. When `repoPath` is omitted, only user-global sources
 * are scanned for the Global section. When it is supplied, only that
 * repo's local sources are scanned for that repo's section.
 */
export async function externalImportDetect(
  repoPath?: string
): Promise<DetectedItem[]> {
  return invoke<DetectedItem[]>("external_import_detect", {
    repoPath: repoPath ?? null,
  });
}

/**
 * Apply a batch of selections, copying each source artifact into the
 * per-selection destination. Returns a per-item report so partial failures
 * stay visible.
 */
export async function externalImportApply(
  selections: ImportSelection[]
): Promise<ImportReport> {
  return invoke<ImportReport>("external_import_apply", { selections });
}
