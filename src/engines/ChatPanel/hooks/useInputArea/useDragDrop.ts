/**
 * useDragDrop
 *
 * Handles drag and drop for the InputArea
 */
import { type DragEvent, type RefObject, useCallback } from "react";

import type { ComposerInputRef } from "@src/components/ComposerInput";
import Message from "@src/components/Message";

import type { DragDropHandlers } from "./types";

// Drag-over visual feedback — applied/removed via inline style
// so no SCSS file is needed. Inline styles beat class-based rules,
// making !important unnecessary.
function applyDragOverStyle(element: HTMLElement): void {
  element.style.border = "2px dashed var(--color-primary-6)";
  element.style.marginTop = "10px";
  element.style.borderRadius = "12px";
  element.style.backgroundColor =
    "color-mix(in srgb, var(--color-primary-6) 5%, transparent)";
}

function removeDragOverStyle(element: HTMLElement): void {
  element.style.border = "";
  element.style.marginTop = "";
  element.style.borderRadius = "";
  element.style.backgroundColor = "";
}

interface UseDragDropOptions {
  composerInputRef: RefObject<ComposerInputRef | null>;
}

export function useDragDrop(options: UseDragDropOptions): DragDropHandlers {
  const { composerInputRef } = options;

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    // Check if this is an internal file drag using global flag
    // (browser restricts access to custom dataTransfer types during dragover)
    const isInternalFileDrag =
      (window as unknown as { __internalFileTreeDrag?: boolean })
        .__internalFileTreeDrag === true;

    // Only handle internal file drags - let others bubble to GlobalDragDrop
    if (!isInternalFileDrag) {
      return;
    }

    // Stop propagation to prevent GlobalDragDrop from handling it
    e.preventDefault();
    e.stopPropagation();
    if (
      e.nativeEvent &&
      typeof (e.nativeEvent as Event).stopImmediatePropagation === "function"
    ) {
      (e.nativeEvent as Event).stopImmediatePropagation();
    }

    // Add visual feedback
    applyDragOverStyle(e.currentTarget);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    // Only handle if it's an internal file drag using global flag
    const isInternalFileDrag =
      (window as unknown as { __internalFileTreeDrag?: boolean })
        .__internalFileTreeDrag === true;

    if (!isInternalFileDrag) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    removeDragOverStyle(e.currentTarget);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      // Check if this is an internal file drag
      const types = Array.from(e.dataTransfer.types);
      const isInternalFileDrag = types.includes("application/x-file-reference");

      // Only handle internal file drags - let others bubble to GlobalDragDrop
      if (!isInternalFileDrag) {
        return;
      }

      // Stop propagation to prevent GlobalDragDrop from handling it
      e.preventDefault();
      e.stopPropagation();
      if (
        e.nativeEvent &&
        typeof (e.nativeEvent as Event).stopImmediatePropagation === "function"
      ) {
        (e.nativeEvent as Event).stopImmediatePropagation();
      }
      removeDragOverStyle(e.currentTarget);

      // Get file reference data
      const fileReferenceData = e.dataTransfer.getData(
        "application/x-file-reference"
      );

      if (!fileReferenceData) {
        return;
      }

      let fileRef: { path: string; name: string; type: string };
      try {
        fileRef = JSON.parse(fileReferenceData);
      } catch (_parseError) {
        return;
      }

      if (!fileRef.path) {
        return;
      }

      // Insert file pill
      if (!composerInputRef.current) {
        return;
      }

      const isFolder = fileRef.type === "directory";
      composerInputRef.current.insertFilePill(
        fileRef.path,
        isFolder,
        isFolder ? "folder" : "file"
      );
      Message.success(`Added ${fileRef.name} as context`);
    },
    [composerInputRef]
  );

  return {
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}
