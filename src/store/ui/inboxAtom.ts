/**
 * Inbox Persistence Atom
 *
 * Manages inbox messages persisted in SQLite via Tauri commands.
 * Provides atoms for the message list and actions (upsert, update status, delete).
 *
 * Flow:
 * - On app startup: useInbox calls loadInboxAtom to hydrate from DB
 * - On user action (read, archive, delete): writes through to DB immediately
 * - Git live-status messages are NOT persisted (derived fresh from gitStatusAtom)
 */
import { invoke } from "@tauri-apps/api/core";
import { atom } from "jotai";

import type { InboxMessage } from "@src/api/types/inbox";
import { createLogger } from "@src/hooks/logger";

const log = createLogger("inbox");

// ============================================
// DB row shape (matches Rust InboxMessage)
// ============================================

interface InboxDbRow {
  id: string;
  title: string;
  preview: string;
  content: string;
  category: string;
  priority: string;
  status: string;
  senderName: string | null;
  /** JSON string */
  metadata: string;
  /** JSON string */
  labels: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================
// Converters
// ============================================

function dbRowToInboxMessage(row: InboxDbRow): InboxMessage {
  return {
    id: row.id,
    title: row.title,
    preview: row.preview,
    content: row.content,
    category: row.category as InboxMessage["category"],
    priority: row.priority as InboxMessage["priority"],
    status: row.status as InboxMessage["status"],
    sender: row.senderName ? { name: row.senderName } : undefined,
    metadata: JSON.parse(row.metadata || "{}"),
    labels: JSON.parse(row.labels || "[]"),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function inboxMessageToDbRow(msg: InboxMessage): InboxDbRow {
  return {
    id: msg.id,
    title: msg.title,
    preview: msg.preview,
    content: msg.content,
    category: msg.category,
    priority: msg.priority,
    status: msg.status,
    senderName: msg.sender?.name ?? null,
    metadata: JSON.stringify(msg.metadata ?? {}),
    labels: JSON.stringify(msg.labels ?? []),
    createdAt: msg.createdAt,
    updatedAt: msg.updatedAt,
  };
}

// ============================================
// Core Atoms
// ============================================

/** Persisted inbox messages loaded from DB */
export const inboxDbMessagesAtom = atom<InboxMessage[]>([]);
inboxDbMessagesAtom.debugLabel = "inboxDbMessagesAtom";

/** Whether the initial DB load has completed */
export const inboxDbLoadedAtom = atom(false);
inboxDbLoadedAtom.debugLabel = "inboxDbLoadedAtom";

// ============================================
// Action Atoms
// ============================================

/** Load all messages from DB into the atom */
export const loadInboxAtom = atom(null, async (_get, set) => {
  try {
    const rows = (await invoke("inbox_list")) as InboxDbRow[];
    set(inboxDbMessagesAtom, rows.map(dbRowToInboxMessage));
  } catch (err) {
    log.error("[inbox] Failed to load from DB:", err);
  } finally {
    set(inboxDbLoadedAtom, true);
  }
});
loadInboxAtom.debugLabel = "loadInboxAtom";

/** Upsert a message to DB and update local atom (preserves existing status) */
export const upsertInboxMessageAtom = atom(
  null,
  async (get, set, msg: InboxMessage) => {
    const row = inboxMessageToDbRow(msg);
    try {
      await invoke("inbox_upsert", { message: row });
    } catch (err) {
      log.error("[inbox] Failed to upsert:", err);
      return;
    }
    const current = get(inboxDbMessagesAtom);
    const idx = current.findIndex((existing) => existing.id === msg.id);
    if (idx >= 0) {
      const updated = [...current];
      updated[idx] = { ...msg, status: current[idx].status };
      set(inboxDbMessagesAtom, updated);
    } else {
      set(inboxDbMessagesAtom, [msg, ...current]);
    }
  }
);
upsertInboxMessageAtom.debugLabel = "upsertInboxMessageAtom";

/** Update message status in DB and local atom */
export const updateInboxStatusAtom = atom(
  null,
  async (get, set, params: { id: string; status: InboxMessage["status"] }) => {
    try {
      await invoke("inbox_update_status", {
        id: params.id,
        status: params.status,
      });
    } catch (err) {
      log.error("[inbox] Failed to update status:", err);
      return;
    }
    const current = get(inboxDbMessagesAtom);
    set(
      inboxDbMessagesAtom,
      current.map((msg) =>
        msg.id === params.id ? { ...msg, status: params.status } : msg
      )
    );
  }
);
updateInboxStatusAtom.debugLabel = "updateInboxStatusAtom";

/** Delete a message from DB and local atom */
export const deleteInboxMessageAtom = atom(
  null,
  async (get, set, id: string) => {
    try {
      await invoke("inbox_delete", { id });
    } catch (err) {
      log.error("[inbox] Failed to delete:", err);
      return;
    }
    const current = get(inboxDbMessagesAtom);
    set(
      inboxDbMessagesAtom,
      current.filter((msg) => msg.id !== id)
    );
  }
);
deleteInboxMessageAtom.debugLabel = "deleteInboxMessageAtom";
