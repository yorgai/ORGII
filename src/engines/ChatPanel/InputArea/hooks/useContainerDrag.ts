/**
 * useContainerDrag Hook
 *
 * Encapsulates container-level drag event handlers for InputArea.
 * Intercepts internal file-tree drags and WorkStation tab drags early
 * so they don't bubble to GlobalDragDrop.
 */
import React, { useCallback } from "react";

import type { ComposerInputRef as TiptapInputRef } from "@src/components/ComposerInput";
import Message from "@src/components/Message";

import { reorderActiveRef } from "../components/QueuedMessages";

interface UseContainerDragOptions {
  handleDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  handleDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  handleDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  tiptapRef: React.RefObject<TiptapInputRef>;
}

interface UseContainerDragReturn {
  handleContainerDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  handleContainerDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  handleContainerDrop: (e: React.DragEvent<HTMLDivElement>) => void;
}

export function useContainerDrag({
  handleDragOver,
  handleDragLeave,
  handleDrop,
  tiptapRef,
}: UseContainerDragOptions): UseContainerDragReturn {
  // Handle drag events at container level to catch internal file drags early
  const handleContainerDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (reorderActiveRef.current) return;

      // Use global flags - browser restricts dataTransfer.types during dragover
      const isInternalFileDrag = window.__internalFileTreeDrag === true;
      const isTabDrag = window.__internalWorkstationTabDrag === true;

      if (isInternalFileDrag || isTabDrag) {
        e.preventDefault();
        e.stopPropagation();
        handleDragOver(e);
      }
      // Otherwise let it bubble to GlobalDragDrop
    },
    [handleDragOver]
  );

  const handleContainerDragLeave = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (reorderActiveRef.current) return;

      const isInternalFileDrag = window.__internalFileTreeDrag === true;
      const isTabDrag = window.__internalWorkstationTabDrag === true;

      if (isInternalFileDrag || isTabDrag) {
        e.preventDefault();
        e.stopPropagation();
        handleDragLeave(e);
      }
    },
    [handleDragLeave]
  );

  const handleContainerDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (reorderActiveRef.current) return;

      // Handle WorkStation tab drag-drop (dnd-kit pointer drag, no DataTransfer)
      if (
        window.__internalWorkstationTabDrag &&
        window.__internalWorkstationTabDragData
      ) {
        e.preventDefault();
        e.stopPropagation();

        const rawData = window.__internalWorkstationTabDragData;
        window.__internalWorkstationTabDrag = false;
        window.__internalWorkstationTabDragData = undefined;

        let data: { path: string; name: string; type: string };
        try {
          data = JSON.parse(rawData) as {
            path: string;
            name: string;
            type: string;
          };
        } catch {
          return;
        }

        if (!data.path || !tiptapRef.current) return;

        const isFolder = data.type === "directory";
        tiptapRef.current.insertFilePill(
          data.path,
          isFolder,
          isFolder ? "folder" : "file",
          data.name
        );
        Message.success(`Added ${data.name} as context`);
        return;
      }

      // Can check dataTransfer.types during drop event
      const types = Array.from(e.dataTransfer.types);
      if (types.includes("application/x-file-reference")) {
        // Prevent default and stop propagation before handling
        e.preventDefault();
        e.stopPropagation();
        handleDrop(e);
      }
    },
    [handleDrop, tiptapRef]
  );

  return {
    handleContainerDragOver,
    handleContainerDragLeave,
    handleContainerDrop,
  };
}
