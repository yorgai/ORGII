/**
 * useWorkspaceSession Hook
 *
 * Drop-in replacement for useSessionContext from contexts/workspace/SessionContext.
 * Uses Jotai atoms instead of React Context.
 *
 * Usage:
 * ```tsx
 * import { useWorkspaceSession } from "@src/engines/SessionCore";
 * const { sessionShow, setSessionShow, repositoryName } = useWorkspaceSession();
 * ```
 */
import { useAtom, useAtomValue, useSetAtom } from "jotai";

import {
  checkStatusAtom,
  checkTaskIdAtom,
  isPlannerLiteAtom,
  isRepositoryLoadingAtom,
  repoPathAtom,
  repositoryIdAtom,
  repositoryNameAtom,
  sessionConfigAtom,
  sessionDoingAtom,
  sessionShowAtom,
  taskNameAtom,
  taskStatusAtom,
  useMockDataAtom,
} from "../atoms/sessionAtoms";

/**
 * Full workspace session state hook
 * Replaces useSessionContext
 */
export function useWorkspaceSession() {
  const [sessionShow, setSessionShow] = useAtom(sessionShowAtom);
  const [sessionDoing, setSessionDoing] = useAtom(sessionDoingAtom);
  const [repositoryName, setRepositoryName] = useAtom(repositoryNameAtom);
  const [taskName, setTaskName] = useAtom(taskNameAtom);
  const [taskStatus, setTaskStatus] = useAtom(taskStatusAtom);
  const [checkStatus, setCheckStatus] = useAtom(checkStatusAtom);
  const [checkTaskId, setCheckTaskId] = useAtom(checkTaskIdAtom);
  const [sessionConfig, setSessionConfig] = useAtom(sessionConfigAtom);
  const [repoPath, setRepoPath] = useAtom(repoPathAtom);
  const [repositoryId, setRepositoryId] = useAtom(repositoryIdAtom);
  const [isRepositoryLoading, setIsRepositoryLoading] = useAtom(
    isRepositoryLoadingAtom
  );
  const [useMockData, setUseMockData] = useAtom(useMockDataAtom);
  const [isPlannerLite, setIsPlannerLite] = useAtom(isPlannerLiteAtom);

  return {
    // Session state
    sessionShow,
    setSessionShow,
    sessionDoing,
    setSessionDoing,

    // Repository info
    repositoryName,
    setRepositoryName,

    // Task info
    taskName,
    setTaskName,
    curTaskName: taskName,
    setCurTaskName: setTaskName,

    // Task status
    taskStatus,
    setTaskStatus,
    wpTaskStatus: taskStatus,
    setWpTaskStatus: setTaskStatus,

    // Check status
    checkStatus,
    setCheckStatus,
    curCheckStatus: checkStatus,
    setCurCheckStatus: setCheckStatus,
    checkTaskId,
    setCheckTaskId,
    curCheckTaskId: checkTaskId,
    setCurCheckTaskId: setCheckTaskId,

    // Session config
    sessionConfig,
    setSessionConfig,

    // Repository state
    repoPath,
    setRepoPath,
    currentRepoPath: repoPath,
    repositoryId,
    setRepositoryId,
    isRepositoryLoading,
    setIsRepositoryLoading,

    // Feature flags
    useMockData,
    setUseMockData,
    isPlannerLite,
    setIsPlannerLite,
  };
}

// ============================================
// Selector Hooks (for fine-grained subscriptions)
// ============================================

/** Session visibility state only */
export function useSessionShow() {
  const [sessionShow, setSessionShow] = useAtom(sessionShowAtom);
  return { sessionShow, setSessionShow };
}

/** Task status only */
export function useTaskStatus() {
  const [taskStatus, setTaskStatus] = useAtom(taskStatusAtom);
  const [checkStatus, setCheckStatus] = useAtom(checkStatusAtom);
  return {
    taskStatus,
    setTaskStatus,
    wpTaskStatus: taskStatus,
    setWpTaskStatus: setTaskStatus,
    checkStatus,
    setCheckStatus,
    curCheckStatus: checkStatus,
    setCurCheckStatus: setCheckStatus,
  };
}

/** Repository info only */
export function useRepositoryInfo() {
  const repositoryName = useAtomValue(repositoryNameAtom);
  const repositoryId = useAtomValue(repositoryIdAtom);
  const repoPath = useAtomValue(repoPathAtom);
  const isLoading = useAtomValue(isRepositoryLoadingAtom);
  const setRepositoryName = useSetAtom(repositoryNameAtom);
  const setRepositoryId = useSetAtom(repositoryIdAtom);
  const setRepoPath = useSetAtom(repoPathAtom);
  const setIsLoading = useSetAtom(isRepositoryLoadingAtom);

  return {
    repositoryName,
    setRepositoryName,
    repositoryId,
    setRepositoryId,
    repoPath,
    setRepoPath,
    isLoading,
    setIsLoading,
  };
}
