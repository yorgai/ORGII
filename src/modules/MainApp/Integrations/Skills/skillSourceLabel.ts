import type { TFunction } from "i18next";

import type { CursorRepo } from "@src/hooks/policies";
import { SKILL_SOURCE } from "@src/types/extensions";

interface SkillSourceInfo {
  path: string;
  source: string;
}

function normalizeSkillPath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function resolveSkillWorkspace(
  skill: SkillSourceInfo,
  cursorRepos?: CursorRepo[]
): CursorRepo | null {
  const skillPath = normalizeSkillPath(skill.path);
  return (
    cursorRepos?.find((repo) => {
      const repoRoot = normalizeSkillPath(repo.path);
      return skillPath.startsWith(`${repoRoot}/.orgii/`);
    }) ?? null
  );
}

export function getSkillResolvedSourceLabel(
  t: TFunction,
  skill: SkillSourceInfo,
  cursorRepos?: CursorRepo[]
): string {
  if (skill.source === SKILL_SOURCE.EMBEDDED_BUILTIN) {
    return t("scopeLabels.builtIn");
  }
  const workspace = resolveSkillWorkspace(skill, cursorRepos);
  if (workspace) return workspace.name;
  if (skill.source === SKILL_SOURCE.WORKSPACE)
    return t("scopeLabels.repoSpecific");
  return t("scopeLabels.user");
}
