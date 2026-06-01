import { atom } from "jotai";

import type { Project } from "@src/types/core/project";

export const ALL_PROJECTS_STORY_ENTRY_ID = "__all_projects__";

export interface ProjectListEntry {
  entryId: string;
  title: string;
  projects: Project[];
  loading: boolean;
  error: string | null;
}

export const allProjectsEntryAtom = atom<ProjectListEntry>({
  entryId: ALL_PROJECTS_STORY_ENTRY_ID,
  title: "Projects",
  projects: [],
  loading: false,
  error: null,
});
allProjectsEntryAtom.debugLabel = "allProjectsEntryAtom";

export const updateAllProjectsEntryAtom = atom(
  null,
  (get, set, update: Partial<ProjectListEntry>) => {
    const current = get(allProjectsEntryAtom);
    set(allProjectsEntryAtom, { ...current, ...update });
  }
);
updateAllProjectsEntryAtom.debugLabel = "updateAllProjectsEntryAtom";

export const allProjectsFlatAtom = atom(
  (get) => get(allProjectsEntryAtom).projects
);
allProjectsFlatAtom.debugLabel = "allProjectsFlatAtom";

export const anyProjectsLoadingAtom = atom(
  (get) => get(allProjectsEntryAtom).loading
);
anyProjectsLoadingAtom.debugLabel = "anyProjectsLoadingAtom";
