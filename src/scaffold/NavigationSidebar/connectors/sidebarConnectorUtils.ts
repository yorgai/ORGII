/**
 * sidebarConnectorUtils
 *
 * Constants and pure utility functions for WorkstationSidebarConnector.
 * Extracted to keep the main connector component under 600 lines.
 */
import type { SessionCreatorDraft } from "@src/store/session";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Poll interval for Cursor IDE session list refresh. */
export const CURSOR_IDE_REFRESH_INTERVAL_MS = 60_000;

export const NEW_SESSION_MENU_ITEM_ID = "new-session";
export const PROJECTS_NEW_PROJECT_MENU_ITEM_ID = "projects-new-project";
export const PROJECTS_NEW_WORK_ITEM_MENU_ITEM_ID = "projects-new-work-item";
export const QUICKSTART_KANBAN_MENU_ITEM_ID = "quickstart-kanban";
export const SESSION_CREATOR_DRAFT_MENU_PREFIX = "session-creator-draft:";

// ── Draft helpers ─────────────────────────────────────────────────────────────

export function getDraftMenuItemId(draftId: string): string {
  return `${SESSION_CREATOR_DRAFT_MENU_PREFIX}${draftId}`;
}

export function getDraftIdFromMenuItemId(menuItemId: string): string | null {
  if (!menuItemId.startsWith(SESSION_CREATOR_DRAFT_MENU_PREFIX)) return null;
  return menuItemId.slice(SESSION_CREATOR_DRAFT_MENU_PREFIX.length) || null;
}

export function getDraftPreviewText(draft: SessionCreatorDraft): string {
  if (draft.sessionName.trim()) return draft.sessionName.trim();
  const textContent = draft.editorContent
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (textContent) return textContent;
  return draft.uploadedFiles[0]?.name ?? "Draft";
}
