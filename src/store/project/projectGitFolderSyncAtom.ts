import { atom } from "jotai";

import type { SyncProjectOrgGitFolderResult } from "@src/api/http/project";

export type ProjectGitFolderSyncResultByOrg = Record<
  string,
  SyncProjectOrgGitFolderResult
>;

export const projectGitFolderSyncResultByOrgAtom =
  atom<ProjectGitFolderSyncResultByOrg>({});
projectGitFolderSyncResultByOrgAtom.debugLabel =
  "projectGitFolderSyncResultByOrgAtom";

export const setProjectGitFolderSyncResultAtom = atom(
  null,
  (get, set, result: SyncProjectOrgGitFolderResult) => {
    set(projectGitFolderSyncResultByOrgAtom, {
      ...get(projectGitFolderSyncResultByOrgAtom),
      [result.org_id]: result,
    });
  }
);
setProjectGitFolderSyncResultAtom.debugLabel =
  "setProjectGitFolderSyncResultAtom";
