/**
 * Flow Awareness Hook - tracks user activities for intent inference.
 *
 * This hook provides a unified interface to record user activities
 * that will be used by agents to understand user context and intent.
 *
 * @example
 * ```tsx
 * const { recordActivity, recordFileEdit, recordTerminalCommand } = useFlowAwareness();
 *
 * // Record file edit
 * recordFileEdit('src/main.ts', 'modify', 10);
 *
 * // Record terminal command
 * recordTerminalCommand('npm test', '/project', 0);
 *
 * // Record search
 * recordSearch('handleClick', 'codebase');
 * ```
 */
import { useCallback, useEffect, useRef } from "react";

import { rpc } from "@src/api/tauri/rpc";
import { createLogger } from "@src/hooks/logger";

import { FLOW_AWARENESS_CONFIG } from "./config";
import type {
  ActivityInput,
  ClipboardOp,
  DebugAction,
  ErrorType,
  FileEditType,
  FlowSummary,
  GitOpType,
  NavigationTarget,
  SearchScope,
  UseFlowAwarenessOptions,
  UseFlowAwarenessReturn,
} from "./types";

const log = createLogger("FlowAwareness");

// Types imported from types module for consistency

// Configuration imported from config module for consistency

// ============================================
// Hook
// ============================================

// Hook interfaces imported from types module

export function useFlowAwareness(
  options: UseFlowAwarenessOptions = {}
): UseFlowAwarenessReturn {
  const { sessionId, enabled = true } = options;

  // Batch pending activities for efficient IPC
  const pendingActivitiesRef = useRef<ActivityInput[]>([]);
  const lastActivityRef = useRef<{ key: string; time: number } | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, []);

  // Generate a deduplication key for an activity
  const getActivityKey = useCallback((activity: ActivityInput): string => {
    switch (activity.type) {
      case "file_edit":
        return `file_edit:${activity.path}:${activity.editType}`;
      case "file_open":
        return `file_open:${activity.path}`;
      case "terminal_command":
        return `terminal:${activity.command}`;
      case "search":
        return `search:${activity.query}:${activity.scope}`;
      case "navigation":
        return `nav:${activity.target}:${activity.details}`;
      default:
        return `${activity.type}:${JSON.stringify(activity)}`;
    }
  }, []);

  // Flush pending activities to backend
  const flushActivities = useCallback(async () => {
    if (pendingActivitiesRef.current.length === 0) return;

    const activities = [...pendingActivitiesRef.current];
    pendingActivitiesRef.current = [];

    // Split large batches to avoid IPC limits
    const batches = [];
    for (
      let i = 0;
      i < activities.length;
      i += FLOW_AWARENESS_CONFIG.MAX_BATCH_SIZE
    ) {
      batches.push(
        activities.slice(i, i + FLOW_AWARENESS_CONFIG.MAX_BATCH_SIZE)
      );
    }

    for (const batch of batches) {
      try {
        await rpc.flow.recordActivities({ activities: batch });
      } catch (err) {
        log.warn("[FlowAwareness] Failed to record activities batch:", err);
        // Don't put activities back in queue - they're lost to avoid memory leaks
        // The system should be resilient to occasional data loss
      }
    }
  }, []);

  // Schedule a flush
  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      flushActivities();
    }, FLOW_AWARENESS_CONFIG.FLUSH_INTERVAL_MS);
  }, [flushActivities]);

  // Queue an activity for batched recording
  const queueActivity = useCallback(
    (activity: ActivityInput) => {
      if (!enabled) return;

      // Add session ID if provided
      const activityWithSession: ActivityInput = sessionId
        ? { ...activity, sessionId }
        : activity;

      // Debounce duplicate activities
      const key = getActivityKey(activity);
      const now = Date.now();
      if (
        lastActivityRef.current?.key === key &&
        now - lastActivityRef.current.time <
          FLOW_AWARENESS_CONFIG.DEBOUNCE_INTERVAL_MS
      ) {
        return;
      }
      lastActivityRef.current = { key, time: now };

      // Add to pending queue
      pendingActivitiesRef.current.push(activityWithSession);

      // Flush immediately if queue is full
      if (
        pendingActivitiesRef.current.length >=
        FLOW_AWARENESS_CONFIG.MAX_PENDING_ACTIVITIES
      ) {
        flushActivities();
      } else {
        scheduleFlush();
      }
    },
    [enabled, sessionId, getActivityKey, flushActivities, scheduleFlush]
  );

  // ===== Activity Recording Functions =====

  const recordActivity = useCallback(
    (activity: ActivityInput) => {
      queueActivity(activity);
    },
    [queueActivity]
  );

  const recordFileEdit = useCallback(
    (path: string, editType: FileEditType, linesChanged?: number) => {
      queueActivity({
        type: "file_edit",
        path,
        editType,
        linesChanged,
      });
    },
    [queueActivity]
  );

  const recordFileOpen = useCallback(
    (path: string) => {
      queueActivity({
        type: "file_open",
        path,
      });
    },
    [queueActivity]
  );

  const recordTerminalCommand = useCallback(
    (command: string, workingDir?: string, exitCode?: number) => {
      queueActivity({
        type: "terminal_command",
        command,
        workingDir,
        exitCode,
      });
    },
    [queueActivity]
  );

  const recordSearch = useCallback(
    (query: string, scope?: SearchScope, resultCount?: number) => {
      queueActivity({
        type: "search",
        query,
        scope: scope ?? "codebase",
        resultCount,
      });
    },
    [queueActivity]
  );

  const recordClipboard = useCallback(
    (operation: ClipboardOp, contentPreview?: string, sourceFile?: string) => {
      queueActivity({
        type: "clipboard",
        operation,
        contentPreview,
        sourceFile,
      });
    },
    [queueActivity]
  );

  const recordGitOperation = useCallback(
    (operation: GitOpType, details?: string) => {
      queueActivity({
        type: "git_operation",
        gitOp: operation,
        details,
      });
    },
    [queueActivity]
  );

  const recordNavigation = useCallback(
    (target: NavigationTarget, details?: string) => {
      queueActivity({
        type: "navigation",
        target,
        details,
      });
    },
    [queueActivity]
  );

  const recordError = useCallback(
    (
      errorType: ErrorType,
      message: string,
      filePath?: string,
      line?: number
    ) => {
      queueActivity({
        type: "error",
        errorType,
        message,
        path: filePath,
        line,
      });
    },
    [queueActivity]
  );

  const recordDebug = useCallback(
    (action: DebugAction, filePath?: string, line?: number) => {
      queueActivity({
        type: "debug",
        action,
        path: filePath,
        line,
      });
    },
    [queueActivity]
  );

  // ===== Query Functions =====

  const getContext = useCallback(
    async (
      maxActivities: number = FLOW_AWARENESS_CONFIG.DEFAULT_MAX_ACTIVITIES
    ): Promise<string> => {
      // Flush pending activities first to ensure latest data
      await flushActivities();

      try {
        const result = await rpc.flow.getContext({
          sessionId,
          maxActivities,
        });
        return result || ""; // Ensure we never return undefined
      } catch (err) {
        log.error("[FlowAwareness] Failed to get context:", err);
        // Return empty string instead of throwing - callers should handle gracefully
        return "";
      }
    },
    [sessionId, flushActivities]
  );

  const getSummary = useCallback(
    async (
      maxActivities: number = FLOW_AWARENESS_CONFIG.DEFAULT_MAX_ACTIVITIES
    ): Promise<FlowSummary> => {
      // Flush pending activities first to ensure latest data
      await flushActivities();

      const fallbackSummary: FlowSummary = {
        intent: null,
        recentEdits: [],
        recentOpens: [],
        recentCommands: [],
        recentSearches: [],
        currentErrors: [],
        idleSeconds: null,
      };

      try {
        const result = await rpc.flow.getSummary({
          sessionId,
          maxActivities,
        });
        // Validate the result structure
        return {
          ...fallbackSummary,
          ...result,
          // Ensure arrays are always arrays
          recentEdits: Array.isArray(result.recentEdits)
            ? result.recentEdits
            : [],
          recentOpens: Array.isArray(result.recentOpens)
            ? result.recentOpens
            : [],
          recentCommands: Array.isArray(result.recentCommands)
            ? result.recentCommands
            : [],
          recentSearches: Array.isArray(result.recentSearches)
            ? result.recentSearches
            : [],
          currentErrors: Array.isArray(result.currentErrors)
            ? result.currentErrors
            : [],
        };
      } catch (err) {
        log.error("[FlowAwareness] Failed to get summary:", err);
        return fallbackSummary;
      }
    },
    [sessionId, flushActivities]
  );

  const clearSession = useCallback(async (): Promise<void> => {
    if (!sessionId) {
      log.warn("[FlowAwareness] Cannot clear session: no sessionId provided");
      return;
    }

    try {
      await rpc.flow.clearSession({ sessionId });
      // Also clear any pending activities for this session
      pendingActivitiesRef.current = pendingActivitiesRef.current.filter(
        (activity) => activity.sessionId !== sessionId
      );
    } catch (err) {
      log.error("[FlowAwareness] Failed to clear session:", err);
      throw new Error(`Failed to clear flow session: ${err}`);
    }
  }, [sessionId]);

  return {
    recordActivity,
    recordFileEdit,
    recordFileOpen,
    recordTerminalCommand,
    recordSearch,
    recordClipboard,
    recordGitOperation,
    recordNavigation,
    recordError,
    recordDebug,
    getContext,
    getSummary,
    clearSession,
  };
}
