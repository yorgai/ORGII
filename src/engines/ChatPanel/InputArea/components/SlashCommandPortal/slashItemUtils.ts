/**
 * Shared utilities for slash-menu item construction.
 * Used by useSlashItemsCache, useSlashCommand, PinnedActionsBar, and FlyoutSubmenu.
 */
import type { InstalledSkill } from "@src/types/extensions";

/**
 * Placeholder description emitted by the Rust skill scanner when a SKILL.md
 * has no meaningful description line. Treat it as "no description".
 */
export const SKILL_PLACEHOLDER_DESCRIPTION = "---";

/**
 * Return the skill's description, or an empty string when the value is the
 * placeholder sentinel `"---"` or missing entirely.
 */
export function normalizeSkillDescription(skill: InstalledSkill): string {
  return skill.description &&
    skill.description !== SKILL_PLACEHOLDER_DESCRIPTION
    ? skill.description
    : "";
}

/**
 * Derive a human-readable group label from a skill's file path.
 *
 * Path patterns:
 *   ~/.cursor/skills/<name>/SKILL.md           → "Cursor Skills"
 *   ~/.orgii/skills/<name>/SKILL.md            → "Global Skills"
 *   /repo/path/.orgii/skills/<name>/SKILL.md   → repo folder name (last segment)
 *   /repo/path/.cursor/skills/<name>/SKILL.md  → repo folder name (last segment)
 * Falls back to the raw `source` field when the path doesn't match any pattern.
 */
export function resolveSkillGroup(skill: InstalledSkill): string {
  const normalized = skill.path.replace(/\\/g, "/");
  const home = normalized.match(
    /^([/\\]Users\/[^/]+|\/home\/[^/]+|\/root)/
  )?.[1];

  if (home) {
    if (normalized.startsWith(`${home}/.cursor/skills`)) return "Cursor Skills";
    if (normalized.startsWith(`${home}/.orgii/skills`)) return "Global Skills";
  }

  const workspaceMatch = normalized.match(
    /^(.*?)\/(?:\.orgii|\.cursor)\/skills\//
  );
  if (workspaceMatch) {
    const repoPath = workspaceMatch[1];
    const segments = repoPath.split("/").filter(Boolean);
    return segments[segments.length - 1] ?? skill.source;
  }

  return skill.source;
}

/**
 * Build the `/mcp__<server>__<tool> ` string inserted into the composer
 * when a user picks an MCP tool from the slash menu.
 */
export function buildMcpToolCommand(
  serverName: string,
  toolName: string
): string {
  const serverSlug = serverName.replace(/-/g, "_");
  return `/mcp__${serverSlug}__${toolName} `;
}
