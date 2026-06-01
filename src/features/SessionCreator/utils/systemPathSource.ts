import type { TFunction } from "i18next";

import type { RepoItem } from "@src/scaffold/GlobalSpotlight/types";
import {
  SESSION_SOURCE_TYPE,
  SYSTEM_PATH_ID,
  type SessionSource,
  type SystemPathId,
} from "@src/store/session/creatorStateAtom";

export const SYSTEM_PATH_SOURCE_ID_PREFIX = "__orgii_system_path__";
export const SYSTEM_HOME_SOURCE_ID = `${SYSTEM_PATH_SOURCE_ID_PREFIX}:${SYSTEM_PATH_ID.HOME}`;

export function isSystemPathSource(
  source: SessionSource | null | undefined
): boolean {
  return source?.type === SESSION_SOURCE_TYPE.SYSTEM_PATH;
}

export function isSystemPathSourceId(sourceId: string | undefined): boolean {
  return sourceId?.startsWith(`${SYSTEM_PATH_SOURCE_ID_PREFIX}:`) ?? false;
}

export function isSystemPathRepoItem(repo: RepoItem): boolean {
  return isSystemPathSourceId(repo.id);
}

export function getSystemPathIdFromRepoItem(
  repo: RepoItem
): SystemPathId | undefined {
  if (!isSystemPathRepoItem(repo)) return undefined;
  const systemPathId = repo.id.slice(`${SYSTEM_PATH_SOURCE_ID_PREFIX}:`.length);
  return systemPathId === SYSTEM_PATH_ID.HOME ? SYSTEM_PATH_ID.HOME : undefined;
}

export function getSystemHomeSourceLabel(t: TFunction): string {
  return t("common:selectors.sessionInfo.systemPaths.home.label");
}

export function getSystemHomeSourceDescription(t: TFunction): string {
  return t("common:selectors.sessionInfo.systemPaths.home.description");
}

export function createSystemPathSessionSource(
  systemPathId: SystemPathId,
  t: TFunction
): SessionSource {
  return {
    type: SESSION_SOURCE_TYPE.SYSTEM_PATH,
    systemPathId,
    repoId: `${SYSTEM_PATH_SOURCE_ID_PREFIX}:${systemPathId}`,
    repoName: getSystemHomeSourceLabel(t),
  };
}

export function createSystemHomeRepoItem(t: TFunction): RepoItem {
  return {
    id: SYSTEM_HOME_SOURCE_ID,
    name: getSystemHomeSourceLabel(t),
    description: getSystemHomeSourceDescription(t),
    kind: SESSION_SOURCE_TYPE.SYSTEM_PATH,
  };
}
