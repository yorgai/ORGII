/**
 * Session Creator Draft Atoms
 *
 * Stores pre-launch SessionCreator drafts (text input, optional session name,
 * attachments) so users can navigate away and return later. Existing launched
 * sessions use `Session.draftText` instead; these atoms are only for future
 * sessions that do not have a session row yet.
 */
import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

import type { CliAgentType } from "@src/api/tauri/rpc/schemas/validation";
import type { ComposerSnapshot } from "@src/components/ComposerInput";
import type { UploadedFile } from "@src/features/SessionCreator/types";

const SESSION_CREATOR_DRAFT_STORAGE_KEY = "orgii:sessionCreatorDrafts";

export interface SessionCreatorDraft {
  id: string;
  sessionName: string;
  editorContent: string;
  /** Full structured snapshot of the composer, including pill atoms. When
   *  present, this takes precedence over `editorContent` on restore so pills
   *  are reconstructed rather than being converted to plain text. */
  editorSnapshot?: ComposerSnapshot;
  uploadedFiles: Array<{
    id: string;
    name: string;
    type: UploadedFile["type"];
    path?: string;
  }>;
  agentIconId?: string | null;
  cliAgentType?: CliAgentType | null;
  createdAt: string;
  updatedAt: string;
  savedAt: string;
  sidebarVisible: boolean;
}

export interface SessionCreatorDraftStore {
  activeDraftId: string | null;
  drafts: Record<string, SessionCreatorDraft>;
}

export const EMPTY_SESSION_CREATOR_DRAFT_STORE: SessionCreatorDraftStore = {
  activeDraftId: null,
  drafts: {},
};

function createDraftId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const sessionCreatorDraftStoreAtom =
  atomWithStorage<SessionCreatorDraftStore>(
    SESSION_CREATOR_DRAFT_STORAGE_KEY,
    EMPTY_SESSION_CREATOR_DRAFT_STORE,
    {
      getItem: (key, initialValue) => {
        try {
          const item = localStorage.getItem(key);
          if (!item) return initialValue;
          return JSON.parse(item) as SessionCreatorDraftStore;
        } catch (error) {
          console.warn("[SessionCreatorDraft] Failed to load drafts:", error);
          return initialValue;
        }
      },
      setItem: (key, value) => {
        try {
          localStorage.setItem(key, JSON.stringify(value));
        } catch (error) {
          console.error("[SessionCreatorDraft] Failed to save drafts:", error);
        }
      },
      removeItem: (key) => {
        localStorage.removeItem(key);
      },
    }
  );

export const activeSessionCreatorDraftIdAtom = atom(
  (get) => get(sessionCreatorDraftStoreAtom).activeDraftId,
  (get, set, draftId: string | null) => {
    const store = get(sessionCreatorDraftStoreAtom);
    set(sessionCreatorDraftStoreAtom, {
      ...store,
      activeDraftId: draftId,
    });
  }
);

export const sessionCreatorDraftListAtom = atom((get) => {
  const drafts = Object.values(get(sessionCreatorDraftStoreAtom).drafts).filter(
    (draft) => draft.sidebarVisible
  );
  return drafts.sort(
    (draftA, draftB) =>
      new Date(draftB.createdAt).getTime() -
      new Date(draftA.createdAt).getTime()
  );
});

export const sessionCreatorDraftAtom = atom(
  (get): SessionCreatorDraft | null => {
    const store = get(sessionCreatorDraftStoreAtom);
    const activeDraftId = store.activeDraftId;
    if (!activeDraftId) return null;
    return store.drafts[activeDraftId] ?? null;
  },
  (get, set, draft: SessionCreatorDraft | null) => {
    const store = get(sessionCreatorDraftStoreAtom);
    const activeDraftId = store.activeDraftId;

    if (!draft) {
      if (!activeDraftId) return;
      const nextDrafts = { ...store.drafts };
      delete nextDrafts[activeDraftId];
      set(sessionCreatorDraftStoreAtom, {
        activeDraftId: null,
        drafts: nextDrafts,
      });
      return;
    }

    set(sessionCreatorDraftStoreAtom, {
      activeDraftId: draft.id,
      drafts: {
        ...store.drafts,
        [draft.id]: draft,
      },
    });
  }
);

export const startNewSessionCreatorDraftAtom = atom(null, (get, set) => {
  const store = get(sessionCreatorDraftStoreAtom);
  const draftId = createDraftId();
  set(sessionCreatorDraftStoreAtom, {
    ...store,
    activeDraftId: draftId,
  });
});

export const selectSessionCreatorDraftAtom = atom(
  null,
  (get, set, draftId: string) => {
    const store = get(sessionCreatorDraftStoreAtom);
    if (!store.drafts[draftId]) return;
    set(sessionCreatorDraftStoreAtom, {
      ...store,
      activeDraftId: draftId,
    });
  }
);

export const promoteActiveSessionCreatorDraftAtom = atom(null, (get, set) => {
  const store = get(sessionCreatorDraftStoreAtom);
  const activeDraftId = store.activeDraftId;
  if (!activeDraftId) return;
  const draft = store.drafts[activeDraftId];
  if (!draft || isDraftEmpty(draft) || draft.sidebarVisible) return;
  set(sessionCreatorDraftStoreAtom, {
    ...store,
    drafts: {
      ...store.drafts,
      [activeDraftId]: {
        ...draft,
        sidebarVisible: true,
      },
    },
  });
});

export const deleteSessionCreatorDraftAtom = atom(
  null,
  (get, set, draftId: string) => {
    const store = get(sessionCreatorDraftStoreAtom);
    if (!store.drafts[draftId]) return;
    const nextDrafts = { ...store.drafts };
    delete nextDrafts[draftId];
    set(sessionCreatorDraftStoreAtom, {
      activeDraftId:
        store.activeDraftId === draftId ? null : store.activeDraftId,
      drafts: nextDrafts,
    });
  }
);

export function saveDraft(
  draft: Omit<
    SessionCreatorDraft,
    "createdAt" | "id" | "savedAt" | "sidebarVisible" | "updatedAt"
  > &
    Partial<Pick<SessionCreatorDraft, "createdAt" | "id" | "sidebarVisible">>
): SessionCreatorDraft {
  const timestamp = new Date().toISOString();
  const id = draft.id ?? createDraftId();
  const createdAt = draft.createdAt ?? timestamp;
  return {
    ...draft,
    id,
    createdAt,
    updatedAt: timestamp,
    savedAt: timestamp,
    sidebarVisible: draft.sidebarVisible ?? false,
  };
}

export function isDraftEmpty(draft: SessionCreatorDraft): boolean {
  const hasSessionName = draft.sessionName.trim().length > 0;
  const hasEditorContent = draft.editorContent.trim().length > 0;
  const hasFiles = draft.uploadedFiles.length > 0;

  return !hasSessionName && !hasEditorContent && !hasFiles;
}
