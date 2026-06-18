/**
 * useDraftManagement Hook
 *
 * Manages pre-launch draft persistence for SessionCreator. Multiple drafts are
 * keyed by `activeDraftId`; a blank New Session gets a new active id and only
 * materializes into storage once the user types meaningful content.
 */
import { useAtom, useAtomValue } from "jotai";
import { type RefObject, useEffect, useRef } from "react";

import type { CliAgentType } from "@src/api/tauri/rpc/schemas/validation";
import type { ComposerInputRef } from "@src/components/ComposerInput";
import type { UploadedFile } from "@src/features/SessionCreator/types";
import { createLogger } from "@src/hooks/logger";
import {
  type SessionCreatorDraft,
  activeSessionCreatorDraftIdAtom,
  isDraftEmpty,
  saveDraft,
  sessionCreatorDraftAtom,
} from "@src/store/session";

const logger = createLogger("DraftManagement");

export interface UseDraftManagementOptions {
  sessionName: string;
  editorContent: string;
  uploadedFiles: UploadedFile[];
  agentIconId: string | null;
  cliAgentType: CliAgentType | null;
  setSessionName: (name: string) => void;
  setEditorContent: (content: string) => void;
  setUploadedFiles: (files: UploadedFile[]) => void;
  composerInputRef: RefObject<ComposerInputRef | null>;
  /** Skip draft loading if market listing is being loaded from URL */
  skipDraftLoading?: boolean;
  /** Persist editor content into the shared pre-launch draft store. */
  persistDraft?: boolean;
}

export function useDraftManagement(options: UseDraftManagementOptions) {
  const {
    sessionName,
    editorContent,
    uploadedFiles,
    agentIconId,
    cliAgentType,
    setSessionName,
    setEditorContent,
    setUploadedFiles,
    composerInputRef,
    skipDraftLoading = false,
    persistDraft = true,
  } = options;

  const [draft, setDraft] = useAtom(sessionCreatorDraftAtom);
  const activeDraftId = useAtomValue(activeSessionCreatorDraftIdAtom);

  const draftLoadedRef = useRef(false);
  const loadedDraftIdRef = useRef<string | null>(null);
  // Keep a ref to the latest draft so the load effect can read it without
  // depending on the draft object itself (which changes on every save tick
  // and would re-trigger the load, calling setContent while the user types).
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  // Mirror uploadedFiles into a ref so the save effect does not need it in
  // its dependency array — uploadedFiles is a new array reference on every
  // render, which would keep resetting the 500 ms debounce timer and delay
  // (or prevent) the draft from ever being persisted while the user types.
  const uploadedFilesRef = useRef(uploadedFiles);
  useEffect(() => {
    uploadedFilesRef.current = uploadedFiles;
  }, [uploadedFiles]);

  useEffect(() => {
    // Reset both flags so the load effect re-runs for the new draft slot, and
    // the save effect waits until after load has seeded the editor before it
    // starts persisting (prevents the 500 ms save tick from writing stale
    // editorContent from the previous slot into the newly switched slot).
    draftLoadedRef.current = false;
    loadedDraftIdRef.current = null;
  }, [activeDraftId]);

  useEffect(() => {
    if (skipDraftLoading) {
      draftLoadedRef.current = true;
      loadedDraftIdRef.current = activeDraftId;
      return;
    }

    if (draftLoadedRef.current && loadedDraftIdRef.current === activeDraftId) {
      return;
    }

    draftLoadedRef.current = true;
    loadedDraftIdRef.current = activeDraftId;

    // Read latest draft from ref so this effect does not re-run every time
    // the draft object is updated by the save tick (which runs while the user
    // is typing and would call setContent and destroy the @ mention menu).
    const currentDraft = draftRef.current;

    if (!currentDraft) {
      setSessionName("");
      setEditorContent("");
      setUploadedFiles([]);
      // Do NOT call setContent("") here. This branch means "no saved draft for
      // this slot", but the editor may already have user-typed content (e.g.
      // a file pill just inserted via @ menu). Calling setContent("") would:
      //   1. Destroy in-progress user input.
      //   2. Fire onAtMentionClose, dismissing an active @ menu.
      // The ComposerInput initialContent prop handles the empty-editor initial
      // state; we do not need to enforce it here.
      return;
    }

    let retryTimeoutId: ReturnType<typeof setTimeout> | undefined;

    // Restores the editor from a saved draft. Prefers the structured snapshot
    // (which preserves pills) over the plain text fallback. Skips the call when
    // the editor already shows the same text — setContent unconditionally fires
    // onAtMentionClose, so a no-op call would dismiss an active @ menu.
    const restoreEditorContent = () => {
      const snapshot = currentDraft.editorSnapshot;
      const plainText = currentDraft.editorContent;

      const applyRestore = (ref: ComposerInputRef) => {
        if (ref.isInlineMenuActive()) {
          return;
        }

        if (snapshot) {
          ref.setContent(snapshot);
          logger.debug("restored editor from snapshot with pills");
        } else if (ref.getText() !== plainText) {
          ref.setContent(plainText);
        }
      };

      if (!composerInputRef.current) {
        retryTimeoutId = setTimeout(() => {
          if (composerInputRef.current) {
            applyRestore(composerInputRef.current);
          }
        }, 100);
        return;
      }
      applyRestore(composerInputRef.current);
    };

    const mainTimeoutId = setTimeout(() => {
      setSessionName(currentDraft.sessionName);
      setEditorContent(currentDraft.editorContent);
      restoreEditorContent();
      setUploadedFiles(
        currentDraft.uploadedFiles.map((file) => ({
          ...file,
          file: undefined,
        }))
      );
    }, 50);

    return () => {
      clearTimeout(mainTimeoutId);
      if (retryTimeoutId) clearTimeout(retryTimeoutId);
    };
  }, [
    activeDraftId,
    setEditorContent,
    setSessionName,
    setUploadedFiles,
    skipDraftLoading,
    composerInputRef,
  ]);

  useEffect(() => {
    if (!draftLoadedRef.current || !persistDraft) return;

    const timer = setTimeout(() => {
      const editorSnapshot = composerInputRef.current?.getSnapshot();

      const currentDraft: SessionCreatorDraft = saveDraft({
        id: activeDraftId ?? draftRef.current?.id,
        createdAt: draftRef.current?.createdAt,
        sidebarVisible: draftRef.current?.sidebarVisible,
        sessionName,
        editorContent,
        editorSnapshot,
        uploadedFiles: uploadedFilesRef.current.map((file) => ({
          id: file.id,
          name: file.name,
          type: file.type,
          path: file.path,
        })),
        agentIconId,
        cliAgentType,
      });

      if (!isDraftEmpty(currentDraft)) {
        setDraft(currentDraft);
      } else {
        setDraft(null);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [
    activeDraftId,
    agentIconId,
    cliAgentType,
    composerInputRef,
    editorContent,
    persistDraft,
    sessionName,
    setDraft,
  ]);

  return {
    draft,
    setDraft,
    draftLoadedRef,
  };
}
