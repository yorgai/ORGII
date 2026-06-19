/**
 * Merge multiple `skills_list` result sets into one de-duplicated list.
 *
 * `skills_list` is queried once per scope (global `workspacePath: null`, plus
 * each workspace/repo path). Repo-local skills (`.orgii`, `.cursor`, `.claude`,
 * `.codex`) are only returned when that repo path is queried, so we union the
 * per-scope results with global ones.
 *
 * De-duplication is by normalized source location. Different scanner paths can
 * describe the same skill as either the skill directory or its `SKILL.md`, so
 * both forms collapse to the directory identity. The first occurrence wins, so
 * callers should pass the highest-priority list (typically global) first.
 */
import type { InstalledSkill } from "@src/types/extensions";

export function getInstalledSkillIdentity(skill: Pick<InstalledSkill, "path">) {
  const normalizedPath = skill.path.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalizedPath.endsWith("/SKILL.md")
    ? normalizedPath.slice(0, -"/SKILL.md".length)
    : normalizedPath;
}

export function mergeInstalledSkills(
  lists: ReadonlyArray<ReadonlyArray<InstalledSkill>>
): InstalledSkill[] {
  const byPath = new Map<string, InstalledSkill>();
  for (const list of lists) {
    for (const skill of list) {
      const identity = getInstalledSkillIdentity(skill);
      if (!byPath.has(identity)) {
        byPath.set(identity, skill);
      }
    }
  }
  return Array.from(byPath.values());
}
