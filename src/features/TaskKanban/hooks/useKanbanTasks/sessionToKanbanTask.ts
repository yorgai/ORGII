import { formatAgentType } from "@src/assets/providers";
import { KANBAN_RESULT_STATUS } from "@src/features/KanbanBoard/types";
import type { Session } from "@src/store/session";
import {
  isAgentSession,
  isCliSession,
  isCursorIdeSession,
} from "@src/util/session/sessionDispatch";
import { stripPillReferences } from "@src/util/session/stripPillReferences";

import {
  type AgentKanbanColumnId,
  type KanbanAutoArchiveTtl,
  mapSessionToKanbanColumn,
} from "../../config";
import type { KanbanResultStatus, KanbanTask } from "../../types";

function getResultStatus(
  session: Session,
  columnId: AgentKanbanColumnId
): KanbanResultStatus | undefined {
  if (columnId === "finished") return KANBAN_RESULT_STATUS.Archived;

  switch (session.status) {
    case "failed":
    case "error":
    case "timeout":
    case "killed":
      return KANBAN_RESULT_STATUS.Failed;
    case "pending":
    case "queued":
    case "running":
    case "in_progress":
    case "installing":
      return undefined;
    default:
      return KANBAN_RESULT_STATUS.Completed;
  }
}

function getCategoryTag(session: Session): string {
  if (isAgentSession(session.session_id)) return "Agent";
  if (isCliSession(session.session_id)) return "CLI";
  if (isCursorIdeSession(session.session_id)) return "Cursor";
  return "Other";
}

function getAgentLabel(session: Session, categoryTag: string): string {
  if (session.cliAgentType) return formatAgentType(session.cliAgentType);
  return session.agentDisplayName || categoryTag;
}

function getWorkspaceName(session: Session): string | undefined {
  const workspacePath = session.worktreePath || session.repoPath;
  if (!workspacePath) return session.repo_name;

  return workspacePath.split(/[\\/]/).filter(Boolean).pop() || workspacePath;
}

export function sessionToKanbanTask(
  session: Session,
  visitedSessions: ReadonlySet<string>,
  manualFinishedSessionIds: ReadonlySet<string>,
  autoArchiveTtl: KanbanAutoArchiveTtl,
  nowMs: number
): KanbanTask {
  const categoryTag = getCategoryTag(session);
  const tags: string[] = [categoryTag];
  if (session.cliAgentType) tags.push(session.cliAgentType);
  if (session.repo_name) tags.push(session.repo_name);
  if (session.worktreeBranch) tags.push(session.worktreeBranch);
  if (session.mergeStatus && session.mergeStatus !== "pending") {
    tags.push(`merge: ${session.mergeStatus}`);
  }

  const columnId = mapSessionToKanbanColumn(session, {
    manualFinishedSessionIds,
    autoArchiveTtl,
    nowMs,
  });

  const isCompleted = session.status === "completed";
  const isUnread = isCompleted && !visitedSessions.has(session.session_id);
  const resultStatus = getResultStatus(session, columnId);
  const agentLabel = getAgentLabel(session, categoryTag);

  // Rust agent sessions render as single-line title-only cards to match
  // CLI/Cursor cards. Their `user_input` would otherwise duplicate the
  // auto-generated `name` (or a near-identical first prompt) below the title.
  const isRustAgent = isAgentSession(session.session_id);

  return {
    id: session.session_id,
    title: stripPillReferences(
      session.name || session.user_input?.slice(0, 120) || session.session_id
    ),
    description:
      !isRustAgent && session.user_input
        ? stripPillReferences(session.user_input)
        : undefined,
    status: columnId as KanbanTask["status"],
    assignee: agentLabel,
    tags,
    agentLabel,
    agentIconId: session.agentIconId,
    cliAgentType: session.cliAgentType,
    modelName: session.model,
    workspaceName: getWorkspaceName(session),
    created_at: session.created_at,
    updated_at: session.updated_at,
    completed_at: session.completed_at,
    session_id: session.session_id,
    isUnread,
    resultStatus,
  };
}
