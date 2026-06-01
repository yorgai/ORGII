/**
 * Session API - Local
 *
 * Utility functions for session status checks.
 * API stubs are no-ops — real session operations go through:
 *   - Tauri commands (OS Agent, CLI sessions)
 *   - Market API via unified.ts (market sessions)
 */
import type {
  ActivityChunk,
  ActivityListParams,
  SessionStatusData,
} from "@src/types/session/session";
import {
  isActiveStatus as isSessionActive,
  isTerminalStatus as isSessionTerminal,
} from "@src/types/session/session";

// ============================================
// Utility Functions
// ============================================

const isWaitingForQuestion = (
  sessionData: SessionStatusData | null
): boolean => {
  if (!sessionData) return false;
  return (
    sessionData.status === "waiting_for_user" &&
    (sessionData.waiting_for === "question" ||
      (sessionData.pending_questions_count ?? 0) > 0)
  );
};

// ============================================
// No-op stubs (kept for UnifiedSessionApi shape)
// ============================================

const noop = (..._args: unknown[]) => Promise.resolve(undefined);

const createSession = noop;
const getSessionStatus = (_sessionId: string) =>
  Promise.resolve(
    undefined as { status: number; data: SessionStatusData } | undefined
  );
const cancelSession = noop;
const pauseSession = (..._args: unknown[]) =>
  Promise.resolve(undefined as { data: { success?: boolean } } | undefined);
const resumeSession = (..._args: unknown[]) =>
  Promise.resolve(
    undefined as
      | { status: number; data: { success?: boolean; message?: string } }
      | undefined
  );
const interruptSession = noop;
const sendMessage = noop;
const sendMessageAndResume = (..._args: unknown[]) =>
  Promise.resolve(
    undefined as
      | { status: number; data: { success?: boolean; message?: string } }
      | undefined
  );
const answerQuestion = (..._args: unknown[]) =>
  Promise.resolve(
    undefined as { status: number; data: { success?: boolean } } | undefined
  );
const continueSession = (..._args: unknown[]) =>
  Promise.resolve(undefined as { data: unknown } | undefined);
const approveStage = (..._args: unknown[]) =>
  Promise.resolve(
    undefined as
      | {
          data: {
            success?: boolean;
            previous_stage?: string;
            next_stage?: string | null;
          };
        }
      | undefined
  );
const getActivityChunks = (_sessionId: string, _params?: ActivityListParams) =>
  Promise.resolve(
    undefined as
      | {
          status: number;
          data: { chunks: ActivityChunk[]; has_more?: boolean };
        }
      | undefined
  );
const listSessions = noop;
const listActiveSessions = noop;
const getLastSession = noop;
const cancelAllSessions = noop;

// ============================================
// Export
// ============================================

export const sessionApi = {
  createSession,
  getSessionStatus,
  cancelSession,
  pauseSession,
  resumeSession,
  interruptSession,
  sendMessage,
  sendMessageAndResume,
  answerQuestion,
  continueSession,
  approveStage,
  getActivityChunks,
  listSessions,
  listActiveSessions,
  getLastSession,
  cancelAllSessions,
  isWaitingForQuestion,
  isSessionTerminal,
  isSessionActive,
};

export {
  createSession,
  getSessionStatus,
  cancelSession,
  pauseSession,
  resumeSession,
  interruptSession,
  sendMessage,
  sendMessageAndResume,
  answerQuestion,
  continueSession,
  approveStage,
  isWaitingForQuestion,
  getActivityChunks,
  listSessions,
  listActiveSessions,
  getLastSession,
  cancelAllSessions,
  isSessionTerminal,
  isSessionActive,
};
