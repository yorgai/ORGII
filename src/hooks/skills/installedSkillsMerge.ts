/**
 * Merge multiple `skills_list` result sets into one de-duplicated list.
 *
 * `skills_list` is queried once per scope (global `workspacePath: null`, plus
 * each workspace/repo path). A skill living in a repo's `.orgii/skills/` is
 * only returned when that repo path is queried, so to show workspace-imported
 * skills alongside global ones we union the per-scope results.
 *
 * De-duplication is by `path` (the skill's on-disk location, unique per skill
 * instance). The first occurrence wins, so callers should pass the
 * highest-priority list (typically global) first.
 */
import type { InstalledSkill } from "@src/types/extensions";

export function mergeInstalledSkills(
  lists: ReadonlyArray<ReadonlyArray<InstalledSkill>>
): InstalledSkill[] {
  const byPath = new Map<string, InstalledSkill>();
  for (const list of lists) {
    for (const skill of list) {
      if (!byPath.has(skill.path)) {
        byPath.set(skill.path, skill);
      }
    }
  }
  return Array.from(byPath.values());
}
