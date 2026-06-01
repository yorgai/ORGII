/**
 * useContainerDrag Hook
 *
 * Encapsulates container-level drag event handlers for InputArea.
 * Intercepts internal file-tree drags early so they don't bubble
 * to GlobalDragDrop.
 */
import React, { useCallback } from "react";

import { reorderActiveRef } from "../components/QueuedMessages";

interface UseContainerDragOptions {
  handleDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  handleDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  handleDrop: (e: React.DragEvent<HTMLDivElement>) => void;
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
}: UseContainerDragOptions): UseContainerDragReturn {
  // Handle drag events at container level to catch internal file drags early
  const handleContainerDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (reorderActiveRef.current) return;

      // Use global flag - browser restricts dataTransfer.types during dragover
      const isInternalFileDrag =
        (window as unknown as { __internalFileTreeDrag?: boolean })
          .__internalFileTreeDrag === true;

      if (isInternalFileDrag) {
        // This is our internal file drag - handle it and prevent default
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

      const isInternalFileDrag =
        (window as unknown as { __internalFileTreeDrag?: boolean })
          .__internalFileTreeDrag === true;

      if (isInternalFileDrag) {
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

      // Can check dataTransfer.types during drop event
      const types = Array.from(e.dataTransfer.types);
      if (types.includes("application/x-file-reference")) {
        // Prevent default and stop propagation before handling
        e.preventDefault();
        e.stopPropagation();
        handleDrop(e);
      }
    },
    [handleDrop]
  );

  return {
    handleContainerDragOver,
    handleContainerDragLeave,
    handleContainerDrop,
  };
}
