/**
 * useInputAreaEffects
 *
 * Manages all side effects for the InputArea
 */
import { useAtomValue, useSetAtom } from "jotai";
import { type MutableRefObject, type RefObject, useEffect } from "react";

import type { ComposerInputRef as TiptapInputRef } from "@src/components/ComposerInput";
import Message from "@src/components/Message";
import { useAddToAgentInsertion } from "@src/hooks/input/useAddToAgentInsertion";
import {
  restoreToInputAtom,
  sessionRolledBackAtom,
} from "@src/store/session/cliSessionStatusAtom";
import {
  type ChatImageAttachment,
  chatImageAttachmentsAtom,
} from "@src/store/ui/chatImageAtom";
import {
  clearDroppedFilesAtom,
  droppedFilesAtom,
} from "@src/store/ui/dragDropAtom";
import { prewarmFileIndex } from "@src/util/platform/tauri/fileSearch";

import { isImageName } from "./imageExtensions";
import { useImageAttachment } from "./useImageAttachment";

interface UseInputAreaEffectsOptions {
  // Refs
  tiptapRef: RefObject<TiptapInputRef>;
  atDropdownRef: RefObject<HTMLDivElement>;
  hasContentRef: MutableRefObject<boolean>;

  // State
  showContextMenu: boolean;
  setShowContextMenu: (show: boolean) => void;

  // Cite code
  isCiteCode: boolean;
  selectedCiteText: string;
  selectedCiteRange: { start: number; end: number } | null;
  citeFileName: string;

  // Repo path for debug logging
  currentRepoPath: string | undefined;

  onRestoreInputContent?: (text: string) => void;
}

export function useInputAreaEffects(options: UseInputAreaEffectsOptions): void {
  const {
    tiptapRef,
    atDropdownRef,
    hasContentRef,
    showContextMenu,
    setShowContextMenu,
    isCiteCode,
    selectedCiteText,
    selectedCiteRange,
    citeFileName,
    currentRepoPath,
    onRestoreInputContent,
  } = options;

  // Drag & drop file handling
  const droppedFiles = useAtomValue(droppedFilesAtom);
  const clearDroppedFiles = useSetAtom(clearDroppedFilesAtom);

  // Image attachments — unified entry point for paste / upload / drag-drop
  // images. `handleImagePath` reads bytes from a filesystem path and routes
  // them through the same optimize pipeline as `handleImagePaste`.
  const { handleImagePaste, handleImagePath } = useImageAttachment();

  // Restore-to-input signal set by the cancel-restore path after a
  // user-initiated cancel. We push the message back into the editor so
  // the user can edit/resend, then clear the signal.
  //
  // When sessionRolledBack is true (Case 1: first-send cancel), the atom
  // is reserved for SessionCreatorChatPanel to consume on mount — skip here
  // so the old session's InputArea doesn't swallow it before unmounting.
  const restoreToInput = useAtomValue(restoreToInputAtom);
  const setRestoreToInput = useSetAtom(restoreToInputAtom);
  const sessionRolledBack = useAtomValue(sessionRolledBackAtom);
  const setImageAttachments = useSetAtom(chatImageAttachmentsAtom);
  useEffect(() => {
    if (!restoreToInput || sessionRolledBack) return;

    const editor = tiptapRef.current;
    if (!editor) {
      return;
    }

    const current = editor.getText();
    const next =
      current.trim().length > 0
        ? `${restoreToInput.displayContent}\n${current}`
        : restoreToInput.displayContent;

    editor.setContent(next);
    hasContentRef.current = next.trim().length > 0;
    onRestoreInputContent?.(next);

    // Restore image attachments that were captured before the cancel.
    // Data URLs are already optimized, so we reconstruct ChatImageAttachment
    // objects directly without re-running the optimize pipeline.
    if (
      restoreToInput.imageDataUrls &&
      restoreToInput.imageDataUrls.length > 0
    ) {
      const restored: ChatImageAttachment[] = restoreToInput.imageDataUrls.map(
        (dataUrl, idx) => ({
          id: `restored_${Date.now()}_${idx}`,
          dataUrl,
          fileName: `restored-image-${idx + 1}.png`,
          size: 0,
          width: 0,
          height: 0,
        })
      );
      setImageAttachments((prev) => [...prev, ...restored]);
    }

    editor.focus();

    setRestoreToInput(null);
  }, [
    restoreToInput,
    sessionRolledBack,
    setRestoreToInput,
    setImageAttachments,
    onRestoreInputContent,
    tiptapRef,
    hasContentRef,
  ]);

  // Click outside handler for @ dropdown.
  // Must check BOTH the local anchor ref AND the portal-rendered ContextMenu
  // (which lives in document.body via createPortal, outside the atDropdownRef tree).
  // We match both the inner `.context-menu` div AND the outer portal shell
  // (data-context-menu-portal) so that clicks on the paddingBottom gap between
  // the shell edge and the ContextMenu panel do not spuriously close the menu.
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (atDropdownRef.current?.contains(target)) return;

      const portalShell = document.querySelector("[data-context-menu-portal]");
      if (portalShell?.contains(target)) return;

      setShowContextMenu(false);
    };

    if (showContextMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showContextMenu, atDropdownRef, setShowContextMenu]);

  // Pre-warm file search index when workspace path changes.
  // Starting immediately avoids the common cold-search race where the user
  // types @file before a delayed prewarm has had a chance to build the cache.
  useEffect(() => {
    if (!currentRepoPath) return;

    prewarmFileIndex(currentRepoPath).catch(() => {
      // Non-fatal — logged inside prewarmFileIndex already.
    });
  }, [currentRepoPath]);

  // Insert file reference pill when code is cited (Add to Chat)
  // Line range like @index.tsx (1-483)
  useEffect(() => {
    if (
      !isCiteCode ||
      !selectedCiteText ||
      !selectedCiteRange ||
      !citeFileName
    ) {
      return;
    }

    const insertTimer = setTimeout(() => {
      if (tiptapRef.current) {
        // citeFileName contains the full file path (e.g., /path/to/file.tsx)
        // Extract just the filename for display
        const displayFileName = citeFileName.split("/").pop() || citeFileName;

        // Insert file reference with line range like @index.tsx (1-483)
        tiptapRef.current.insertFileReference({
          filePath: citeFileName,
          fileName: displayFileName,
          lineStart: selectedCiteRange.start,
          lineEnd: selectedCiteRange.end,
        });
      }
      tiptapRef.current?.focus();
    }, 100);

    return () => clearTimeout(insertTimer);
  }, [
    isCiteCode,
    selectedCiteText,
    selectedCiteRange,
    citeFileName,
    tiptapRef,
  ]);

  // Listen for internal file drop events dispatched by GlobalDragDrop
  useEffect(() => {
    // Handler for custom event (dispatched by GlobalDragDrop)
    const handleInternalFileDrop = (event: Event) => {
      const customEvent = event as CustomEvent<{ fileRefData: string }>;
      processFileRefData(customEvent.detail.fileRefData);
    };

    // Shared logic to process file reference data
    const processFileRefData = (fileRefData: string | undefined) => {
      if (!fileRefData) {
        return;
      }

      let fileRef: { path: string; name: string; type: string };
      try {
        fileRef = JSON.parse(fileRefData);
      } catch (_parseError) {
        return;
      }

      if (!fileRef.path) {
        return;
      }

      const insertPill = () => {
        if (!tiptapRef.current) {
          return;
        }

        const isFolder = fileRef.type === "directory";
        tiptapRef.current.insertFilePill(
          fileRef.path,
          isFolder,
          isFolder ? "folder" : "file"
        );
        Message.success(`Added ${fileRef.name} as context`);
      };

      insertPill();
    };

    // Listen for custom event dispatched by GlobalDragDrop
    document.addEventListener("internal-file-drop", handleInternalFileDrop);

    return () => {
      document.removeEventListener(
        "internal-file-drop",
        handleInternalFileDrop
      );
    };
  }, [tiptapRef]);

  // Consume pending "add-to-agent" requests — shared with SessionCreator.
  useAddToAgentInsertion(tiptapRef);

  // Process Dropped Files from GlobalDragDrop.
  //
  // Two branches, both leading to the same surface the user sees:
  //   - Images → `handleImagePath` → optimize → `chatImageAttachmentsAtom`
  //     → `ImageAttachmentPreview` thumbnail.  This keeps drag on parity with
  //     paste/upload (everything routes through one atom, one optimize step).
  //   - Other files (incl. folders) → `insertFilePill` into Tiptap.
  useEffect(() => {
    if (droppedFiles.length === 0) return;

    // Track retry timers for cleanup if Tiptap isn't mounted yet.
    const retryTimers: ReturnType<typeof setTimeout>[] = [];
    let cancelled = false;

    // Folders can never be images, even if they happen to match an extension.
    const imageFiles = droppedFiles.filter(
      (file) =>
        file.type !== "folder" &&
        (file.browserFile?.type.startsWith("image/") || isImageName(file.name))
    );
    const otherFiles = droppedFiles.filter(
      (file) => file.type === "folder" || !imageFiles.includes(file)
    );

    const browserImageFiles = imageFiles
      .map((file) => file.browserFile)
      .filter((file): file is File => Boolean(file));
    const pathImageFiles = imageFiles.filter((file) => !file.browserFile);

    const imagePromises: Promise<void>[] = [];

    if (browserImageFiles.length > 0) {
      imagePromises.push(handleImagePaste(browserImageFiles));
    }

    if (pathImageFiles.length > 0) {
      imagePromises.push(
        ...pathImageFiles.map((file) => handleImagePath(file.path, file.name))
      );
    }

    if (otherFiles.length > 0) {
      const insertPills = () => {
        if (cancelled) return;

        if (tiptapRef.current) {
          otherFiles.forEach((file) => {
            const isFolder = file.type === "folder";
            tiptapRef.current?.insertFilePill(
              file.path,
              isFolder,
              isFolder ? "folder" : "file"
            );
          });
          hasContentRef.current = true;
          Message.success(`Added ${otherFiles.length} file(s) as context`);
        } else {
          const timer = setTimeout(insertPills, 100);
          retryTimers.push(timer);
        }
      };

      insertPills();
    }

    // Clear the atom only after all async image reads finish so a second drop
    // batch arriving while the first is still in-flight does not race.
    void Promise.all(imagePromises).then(() => {
      if (!cancelled) clearDroppedFiles();
    });

    return () => {
      cancelled = true;
      retryTimers.forEach((timer) => clearTimeout(timer));
    };
  }, [
    droppedFiles,
    clearDroppedFiles,
    tiptapRef,
    hasContentRef,
    handleImagePath,
    handleImagePaste,
  ]);
}
