/**
 * Workspace Session Atoms
 *
 * Session-related state for workspace pages.
 * Migrated from contexts/workspace/SessionContext.tsx
 *
 * For spec state, use specsAtom from core/atoms/metadata.ts
 */
import { atom } from "jotai";

import type { WpSessionConfig } from "@src/types/session/steps";

// ============================================
// Session Basic State
// ============================================

/** Whether session panel is visible */
export const sessionShowAtom = atom<boolean>(false);
sessionShowAtom.debugLabel = "workspace/sessionShow";

/** Whether session is actively running */
export const sessionDoingAtom = atom<boolean>(false);
sessionDoingAtom.debugLabel = "workspace/sessionDoing";

/** Current repository name */
export const repositoryNameAtom = atom<string>("Repo");
repositoryNameAtom.debugLabel = "workspace/repositoryName";

/** Current task name */
export const taskNameAtom = atom<string>("");
taskNameAtom.debugLabel = "workspace/taskName";

// ============================================
// Task Status
// ============================================

/** Workspace task status */
export const taskStatusAtom = atom<string>("none");
taskStatusAtom.debugLabel = "workspace/taskStatus";

/** Current check status */
export const checkStatusAtom = atom<string>("config");
checkStatusAtom.debugLabel = "workspace/checkStatus";

/** Current check task ID */
export const checkTaskIdAtom = atom<string>("");
checkTaskIdAtom.debugLabel = "workspace/checkTaskId";

// ============================================
// Session Config
// ============================================

/** Session configuration */
export const sessionConfigAtom = atom<WpSessionConfig>({
  cur: undefined,
  origin: undefined,
});
sessionConfigAtom.debugLabel = "workspace/sessionConfig";

// Spec atoms removed — use specsAtom from core/atoms/metadata.ts instead

// ============================================
// Repository State
// ============================================

/** Current repository path */
export const repoPathAtom = atom<string>("");
repoPathAtom.debugLabel = "workspace/repoPath";

/** Current repository ID */
export const repositoryIdAtom = atom<string>("");
repositoryIdAtom.debugLabel = "workspace/repositoryId";

/** Whether repository is loading */
export const isRepositoryLoadingAtom = atom<boolean>(false);
isRepositoryLoadingAtom.debugLabel = "workspace/isRepositoryLoading";

// ============================================
// Feature Flags
// ============================================

/** Use mock data mode */
export const useMockDataAtom = atom<boolean>(false);
useMockDataAtom.debugLabel = "workspace/useMockData";

/** Planner lite mode */
export const isPlannerLiteAtom = atom<boolean>(false);
isPlannerLiteAtom.debugLabel = "workspace/isPlannerLite";
