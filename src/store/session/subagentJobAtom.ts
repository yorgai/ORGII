/**
 * Subagent Job Atom
 *
 * Tracks running background subagent (Delegate/Shadow worker) jobs per
 * session, the worker counterpart of `shellProcessAtom`. Drives the
 * ActiveProcesses pin bar above the chat composer.
 *
 * Updated by:
 * - agent:subagent_job_changed (status: running | completed | failed | killed)
 * - useProcessReconciliation (startup reseed via agent_list_running_subagent_jobs)
 *
 * Terminal entries are dropped immediately — unlike shell processes there is
 * no chat block holding a reference to the job, so a finished worker simply
 * leaves the pin bar (its result lives in the parent's tool_result).
 */
import { atom } from "jotai";

// ============================================
// Types
// ============================================

export type SubagentJobStatus = "running" | "completed" | "failed" | "killed";

export interface SubagentJobState {
  /** Job-registry handle (the worker's session id). */
  handle: string;
  agentName: string;
  /** "delegate" | "shadow" | agent id label from the registry. */
  subagentType: string;
  status: SubagentJobStatus;
  startedAt: number;
}

/** Map<parentSessionId, Map<handle, SubagentJobState>> */
export type SubagentJobMap = Map<string, Map<string, SubagentJobState>>;

// ============================================
// Atoms
// ============================================

export const subagentJobMapAtom = atom<SubagentJobMap>(new Map());
subagentJobMapAtom.debugLabel = "subagentJobMap";

export const updateSubagentJobAtom = atom(
  null,
  (
    get,
    set,
    action: {
      sessionId: string;
      handle: string;
      agentName: string;
      subagentType: string;
      status: SubagentJobStatus;
      /** Backdate startedAt (reconciliation knows the job's age). */
      startedAtOverride?: number;
    }
  ) => {
    const currentMap = get(subagentJobMapAtom);
    const newMap = new Map(currentMap);

    const existingJobs = newMap.get(action.sessionId);

    if (action.status === "running") {
      const jobs = existingJobs ? new Map(existingJobs) : new Map();
      const existing = existingJobs?.get(action.handle);
      jobs.set(action.handle, {
        handle: action.handle,
        agentName: action.agentName,
        subagentType: action.subagentType,
        status: "running",
        startedAt:
          existing?.startedAt ?? action.startedAtOverride ?? Date.now(),
      });
      newMap.set(action.sessionId, jobs);
    } else {
      // Terminal: drop the row.
      if (!existingJobs?.has(action.handle)) return;
      const jobs = new Map(existingJobs);
      jobs.delete(action.handle);
      if (jobs.size === 0) {
        newMap.delete(action.sessionId);
      } else {
        newMap.set(action.sessionId, jobs);
      }
    }

    set(subagentJobMapAtom, newMap);
  }
);
updateSubagentJobAtom.debugLabel = "updateSubagentJob";

/**
 * Whether a given parent session currently has at least one live
 * (status === "running") background subagent job.
 *
 * Pure read over `subagentJobMapAtom`: terminal jobs are dropped from the
 * map the instant their `agent:subagent_job_changed` arrives, and the map
 * is reseeded at startup by `useProcessReconciliation`, so a non-empty
 * per-session bucket means a worker is genuinely still running.
 *
 * This is the event-driven signal that lets the main composer stay in Stop
 * state (and the planning footer stay visible) during the gap between the
 * parent turn ending and the next `await_output` — see
 * `isSessionActiveAtom`. Returns false for a null/empty session id.
 */
export function hasLiveSubagentJobs(
  map: SubagentJobMap,
  parentSessionId: string | null
): boolean {
  if (!parentSessionId) return false;
  return (map.get(parentSessionId)?.size ?? 0) > 0;
}
