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
export const SYSTEM_DOCUMENTS_SOURCE_ID = `${SYSTEM_PATH_SOURCE_ID_PREFIX}:${SYSTEM_PATH_ID.DOCUMENTS}`;

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

export function isSystemHomeRepoItem(repo: RepoItem): boolean {
  return repo.id === SYSTEM_HOME_SOURCE_ID;
}

export function getSystemPathIdFromRepoItem(
  repo: RepoItem
): SystemPathId | undefined {
  if (!isSystemPathRepoItem(repo)) return undefined;
  const systemPathId = repo.id.slice(`${SYSTEM_PATH_SOURCE_ID_PREFIX}:`.length);
  return isKnownSystemPathId(systemPathId) ? systemPathId : undefined;
}

export function getSystemPathSourcePath(repo: RepoItem): string | undefined {
  return isSystemPathRepoItem(repo) ? repo.fs_uri : undefined;
}

export function getSystemHomeSourceLabel(t: TFunction): string {
  return t("common:selectors.sessionInfo.systemPaths.home.label");
}

export function getSystemHomeSourceDescription(t: TFunction): string {
  return t("common:selectors.sessionInfo.systemPaths.home.description");
}

export function getSystemDocumentsSourceLabel(t: TFunction): string {
  return t("common:selectors.sessionInfo.systemPaths.documents.label");
}

export function getSystemDocumentsSourceDescription(t: TFunction): string {
  return t("common:selectors.sessionInfo.systemPaths.documents.description");
}

function isKnownSystemPathId(
  systemPathId: string
): systemPathId is SystemPathId {
  return (Object.values(SYSTEM_PATH_ID) as string[]).includes(systemPathId);
}

function getSystemPathSourceLabel(
  systemPathId: SystemPathId,
  t: TFunction
): string {
  switch (systemPathId) {
    case SYSTEM_PATH_ID.HOME:
      return getSystemHomeSourceLabel(t);
    case SYSTEM_PATH_ID.DOCUMENTS:
      return getSystemDocumentsSourceLabel(t);
  }
}

export function createSystemPathSessionSource(options: {
  systemPathId?: SystemPathId;
  t: TFunction;
  repoId?: string;
  repoName?: string;
  repoPath?: string;
}): SessionSource {
  const { systemPathId, t, repoId, repoName, repoPath } = options;
  return {
    type: SESSION_SOURCE_TYPE.SYSTEM_PATH,
    systemPathId,
    repoId:
      repoId ?? `${SYSTEM_PATH_SOURCE_ID_PREFIX}:${systemPathId ?? "custom"}`,
    repoName:
      repoName ??
      (systemPathId ? getSystemPathSourceLabel(systemPathId, t) : undefined),
    repoPath,
  };
}

export function createSystemPathRepoItem(options: {
  idSuffix: string;
  name: string;
  description?: string;
  path?: string;
}): RepoItem {
  const { idSuffix, name, description, path } = options;
  return {
    id: `${SYSTEM_PATH_SOURCE_ID_PREFIX}:${idSuffix}`,
    name,
    description,
    fs_uri: path,
    kind: SESSION_SOURCE_TYPE.SYSTEM_PATH,
  };
}

export function createSystemHomeRepoItem(
  t: TFunction,
  path?: string
): RepoItem {
  return createSystemPathRepoItem({
    idSuffix: SYSTEM_PATH_ID.HOME,
    name: getSystemHomeSourceLabel(t),
    description: path ?? getSystemHomeSourceDescription(t),
    path,
  });
}

export function createSystemDocumentsRepoItem(
  t: TFunction,
  path?: string
): RepoItem {
  return createSystemPathRepoItem({
    idSuffix: SYSTEM_PATH_ID.DOCUMENTS,
    name: getSystemDocumentsSourceLabel(t),
    description: path ?? getSystemDocumentsSourceDescription(t),
    path,
  });
}
