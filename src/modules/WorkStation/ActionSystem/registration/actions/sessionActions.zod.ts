/**
 * Session management Zod actions.
 *
 * These are the "session" category actions dispatched by the Rust
 * `manage_session` tool via the ActionBridge (agent:ide_action events).
 *
 * session.propose is special: instead of immediately creating a session,
 * it pre-seeds the chat panel's session creator (agent, repo, task) and
 * navigates the chat panel to creator view so the user can review and
 * launch with full control. The ADE palette shows a slim countdown card.
 * This enforces the pattern:
 *   ADE Manager → proposes → user approves in chat panel → session created.
 */
import { getDefaultStore } from "jotai";
import { z } from "zod";

import { defineZodAction } from "@src/ActionSystem/schema/defineZodAction";
import { clearSessionAtom } from "@src/engines/SessionCore/core/atoms/actions";
import { SessionService } from "@src/engines/SessionCore/services/SessionService";
import { reposAtom } from "@src/store/repo/atoms";
import { restoreToInputAtom } from "@src/store/session/cliSessionStatusAtom";
import {
  SESSION_TARGET_KIND,
  sessionCreatorStateAtom,
} from "@src/store/session/creatorStateAtom";
import {
  activeSessionIdAtom,
  workstationActiveSessionIdAtom,
} from "@src/store/session/viewAtom";
import {
  CHAT_PANEL_SURFACE_KIND,
  chatPanelNavigateAtom,
  restoreChatWidthAtom,
} from "@src/store/ui/chatPanelAtom";

export const ADE_SESSION_PROPOSAL_EVENT = "ade-session-proposal";
export const ADE_SESSION_PROPOSAL_RESPONSE_EVENT =
  "ade-session-proposal-response";

export interface AdeSessionProposalDetail {
  correlationId: string;
  task: string;
  agentDefinitionId?: string;
  repoPath?: string;
  name?: string;
  model?: string;
  /** Unix ms timestamp when the proposal expires (5 min from creation). */
  expiresAt: number;
}

export interface AdeSessionProposalResponseDetail {
  correlationId: string;
  approved: boolean;
  task?: string;
  agentDefinitionId?: string;
  repoPath?: string;
  name?: string;
  model?: string;
}

const SessionCreateSchema = z.object({
  task: z.string().describe("Task description for the new session"),
  repoPath: z.string().optional().describe("Repository path"),
  name: z.string().optional().describe("Session display name"),
  model: z.string().optional().describe("Override LLM model"),
  accountId: z.string().optional().describe("Override account ID"),
  agentDefinitionId: z.string().optional().describe("Agent definition ID"),
});

const SessionProposeSchema = z.object({
  task: z.string().describe("Proposed task description"),
  repoPath: z.string().optional().describe("Suggested repository path"),
  name: z.string().optional().describe("Suggested session name"),
  model: z.string().optional().describe("Suggested LLM model"),
  agentDefinitionId: z
    .string()
    .optional()
    .describe("Suggested agent definition ID"),
});

const SessionIdSchema = z.object({
  sessionId: z.string().describe("Target session ID"),
});

const SessionListSchema = z.object({
  status: z.string().optional().describe("Filter by status"),
  limit: z.number().optional().describe("Max results"),
});

const SessionSendMessageSchema = z.object({
  sessionId: z.string().describe("Target session ID"),
  content: z.string().describe("Message content"),
});

const SessionAnswerQuestionSchema = z.object({
  sessionId: z.string().describe("Target session ID"),
  questionId: z.string().describe("Question ID from getStatus"),
  answer: z.string().describe("Answer text"),
});

const SessionOpenSchema = z.object({
  sessionId: z.string().describe("Session ID to navigate to"),
});

const SessionCancelSchema = z.object({
  sessionId: z.string().describe("Session ID to cancel"),
});

/**
 * session.create — immediately launch a new session.
 * Used by manage_session when ADE Manager has already confirmed intent
 * (e.g. via session.propose). Also available for direct orchestration.
 */
export const sessionCreateAction = defineZodAction(
  {
    id: "session.create",
    category: "session",
    description: "Create and launch a new agent session immediately",
    params: SessionCreateSchema,
    layer: "gui",
    tags: ["session", "create", "launch", "agent"],
    examples: ["start a new SDE session", "create a session for this task"],
  },
  async ({ task, repoPath, name, model, accountId, agentDefinitionId }) => {
    try {
      const result = await SessionService.create({
        task,
        repoPath,
        name,
        model,
        accountId,
        agentDefinitionId,
      });
      return {
        success: true,
        message: `Session created: ${result.sessionId}`,
        data: { sessionId: result.sessionId },
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
);

/**
 * session.propose — surface a user-confirmation card in the ADE Manager
 * palette before creating a session.
 *
 * Emits `ade-session-proposal` and waits (up to 5 min) for the user to
 * approve or reject via `ade-session-proposal-response`. If approved, the
 * session is created and the session ID is returned. If rejected or timed
 * out, returns success:false so the agent knows to stop.
 */
export const sessionProposeAction = defineZodAction(
  {
    id: "session.propose",
    category: "session",
    description:
      "Propose a new session to the user. Shows a confirmation card in the ADE Manager palette with pre-filled parameters. Waits for user approval before creating the session.",
    params: SessionProposeSchema,
    layer: "gui",
    tags: ["session", "propose", "confirm", "approval", "user"],
    examples: [
      "ask user to confirm a new SDE session",
      "propose launching a coding session",
    ],
  },
  async ({ task, repoPath, name, model, agentDefinitionId }) => {
    const correlationId = `proposal-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const TIMEOUT_MS = 5 * 60 * 1000;
    const expiresAt = Date.now() + TIMEOUT_MS;

    // ── Pre-seed the chat panel's session creator ──────────────────────────
    const store = getDefaultStore();

    store.set(sessionCreatorStateAtom, (prev) => {
      const next = { ...prev };
      if (agentDefinitionId) {
        next.dispatchCategory = "rust_agent";
        next.targetKind = SESSION_TARGET_KIND.AGENT;
        next.selectedAgentDefinitionId = agentDefinitionId;
        next.selectedAgentOrgId = null;
        next.cliAgentType = null;
        next.agentName = null;
        next.agentIconId = null;
      }
      if (repoPath) {
        const normalizedPath = repoPath.replace(/\/+$/, "");
        const repos = store.get(reposAtom);
        const matched = repos.find((repo) => {
          const rp = (repo.path ?? repo.fs_uri ?? "").replace(/\/+$/, "");
          return rp === normalizedPath;
        });
        if (matched) {
          next.source = {
            type: "local",
            repoId: matched.id,
            repoName: matched.name,
            repoPath: normalizedPath,
          };
        }
      }
      return next;
    });

    // Seed the task text into the creator composer.
    store.set(restoreToInputAtom, { displayContent: task });

    // Mirror exactly what ChatPanel's "New session" button does so the
    // creator view appears even when the user is already inside a session.
    store.set(chatPanelNavigateAtom, { kind: CHAT_PANEL_SURFACE_KIND.SESSION });
    store.set(clearSessionAtom);
    store.set(workstationActiveSessionIdAtom, null);
    store.set(activeSessionIdAtom, null);

    // Ensure chat panel is visible / expanded.
    store.set(restoreChatWidthAtom);

    // ── Wait for user to confirm or decline ───────────────────────────────
    return new Promise<{ success: boolean; message: string; data?: unknown }>(
      (resolve) => {
        const timeoutId = setTimeout(() => {
          window.removeEventListener(
            ADE_SESSION_PROPOSAL_RESPONSE_EVENT,
            handleResponse
          );
          resolve({
            success: false,
            message: "Session proposal timed out — user did not respond.",
          });
        }, TIMEOUT_MS);

        function handleResponse(evt: Event) {
          const detail = (evt as CustomEvent<AdeSessionProposalResponseDetail>)
            .detail;
          if (detail.correlationId !== correlationId) return;

          clearTimeout(timeoutId);
          window.removeEventListener(
            ADE_SESSION_PROPOSAL_RESPONSE_EVENT,
            handleResponse
          );

          if (!detail.approved) {
            resolve({ success: false, message: "User declined the proposal." });
            return;
          }

          // Session was already created by the chat panel creator — the
          // response detail carries the sessionId in `name`.
          resolve({
            success: true,
            message: `Session created: ${detail.name ?? "unknown"}`,
            data: { sessionId: detail.name },
          });
        }

        window.addEventListener(
          ADE_SESSION_PROPOSAL_RESPONSE_EVENT,
          handleResponse
        );

        // Notify the ADE palette to show the countdown card.
        window.dispatchEvent(
          new CustomEvent<AdeSessionProposalDetail>(
            ADE_SESSION_PROPOSAL_EVENT,
            {
              detail: {
                correlationId,
                task,
                agentDefinitionId,
                repoPath,
                name,
                model,
                expiresAt,
              },
            }
          )
        );
      }
    );
  }
);

export const sessionListAction = defineZodAction(
  {
    id: "session.list",
    category: "session",
    description: "List sessions with optional status filter",
    params: SessionListSchema,
    layer: "gui",
    tags: ["session", "list"],
    examples: ["list active sessions", "show running sessions"],
  },
  async ({ status, limit }) => {
    try {
      const sessions = await SessionService.list({ status, limit });
      return {
        success: true,
        message: `Found ${sessions.length} sessions`,
        data: { sessions },
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
);

export const sessionGetStatusAction = defineZodAction(
  {
    id: "session.getStatus",
    category: "session",
    description: "Get detailed status of a session including pending questions",
    params: SessionIdSchema,
    layer: "gui",
    tags: ["session", "status"],
    examples: ["get session status", "check session progress"],
  },
  async ({ sessionId }) => {
    try {
      const status = await SessionService.getStatus({ sessionId });
      return {
        success: true,
        message: `Session status: ${status.status}`,
        data: status,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
);

export const sessionOpenAction = defineZodAction(
  {
    id: "session.open",
    category: "session",
    description: "Navigate to a session's workspace view in the IDE",
    params: SessionOpenSchema,
    layer: "gui",
    tags: ["session", "open", "navigate"],
    examples: ["open session workspace", "go to session"],
  },
  async ({ sessionId }) => {
    try {
      await SessionService.open({ sessionId });
      return { success: true, message: `Opened session: ${sessionId}` };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
);

export const sessionSendMessageAction = defineZodAction(
  {
    id: "session.sendMessage",
    category: "session",
    description: "Send a message to a running session",
    params: SessionSendMessageSchema,
    layer: "gui",
    tags: ["session", "message", "send"],
    examples: ["send follow-up to session", "reply to session"],
  },
  async ({ sessionId, content }) => {
    try {
      await SessionService.sendMessage({ sessionId, content });
      return { success: true, message: "Message sent" };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
);

export const sessionAnswerQuestionAction = defineZodAction(
  {
    id: "session.answerQuestion",
    category: "session",
    description: "Answer a pending question from a session",
    params: SessionAnswerQuestionSchema,
    layer: "gui",
    tags: ["session", "question", "answer"],
    examples: ["answer session question", "respond to agent question"],
  },
  async ({ sessionId, questionId, answer }) => {
    try {
      await SessionService.answerQuestion({ sessionId, questionId, answer });
      return { success: true, message: "Question answered" };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
);

export const sessionCancelAction = defineZodAction(
  {
    id: "session.cancel",
    category: "session",
    description: "Cancel a running session",
    params: SessionCancelSchema,
    layer: "gui",
    tags: ["session", "cancel", "stop"],
    examples: ["stop session", "cancel running session"],
  },
  async ({ sessionId }) => {
    try {
      await SessionService.cancel({ sessionId });
      return { success: true, message: `Cancelled session: ${sessionId}` };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
);

export const sessionZodActions = [
  sessionCreateAction,
  sessionProposeAction,
  sessionListAction,
  sessionGetStatusAction,
  sessionOpenAction,
  sessionSendMessageAction,
  sessionAnswerQuestionAction,
  sessionCancelAction,
];
