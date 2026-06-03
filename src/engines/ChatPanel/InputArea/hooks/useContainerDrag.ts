/**
 * useContainerDrag Hook
 *
 * Encapsulates container-level drag event handlers for InputArea.
 * Intercepts internal file-tree drags and WorkStation tab drags early
 * so they don't bubble to GlobalDragDrop.
 */
import React, { useCallback, useEffect } from "react";

import type { ComposerInputRef as TiptapInputRef } from "@src/components/ComposerInput";
import Message from "@src/components/Message";

import { reorderActiveRef } from "../components/QueuedMessages";
import { useTabDragHover } from "./useTabDragHover";

interface UseContainerDragOptions {
  handleDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  handleDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  handleDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  tiptapRef: React.RefObject<TiptapInputRef>;
  containerRef: React.RefObject<HTMLDivElement>;
}

interface UseContainerDragReturn {
  handleContainerDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  handleContainerDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  handleContainerDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  isDragOver: boolean;
}

export function useContainerDrag({
  handleDragOver,
  handleDragLeave,
  handleDrop,
  tiptapRef,
  containerRef,
}: UseContainerDragOptions): UseContainerDragReturn {
  const isDragOver = useTabDragHover(containerRef);
  // tab-drag-end listener — dnd-kit fires onDragEnd before the browser drop
  // event, so globals are already cleared by the time onDrop runs. Instead,
  // we listen for the custom event dispatched by useTabDrag and check whether
  // the pointer release landed inside our drop target using the pointer
  // coordinates forwarded in the event detail.
  useEffect(() => {
    const handleTabDragEnd = (e: Event) => {
      const event = e as CustomEvent<{
        tabId: string;
        filePath?: string;
        name?: string;
        type?: string;
        pointerX?: number;
        pointerY?: number;
      }>;

      const { filePath, name, type, pointerX, pointerY } = event.detail;
      if (!filePath || pointerX == null || pointerY == null) return;

      const dropTarget = containerRef.current?.matches(
        "[data-chat-drop-target]"
      )
        ? containerRef.current
        : containerRef.current?.querySelector<HTMLElement>(
            "[data-chat-drop-target]"
          );
      if (!dropTarget) return;

      const rect = dropTarget.getBoundingClientRect();
      const isOverTarget =
        pointerX >= rect.left &&
        pointerX <= rect.right &&
        pointerY >= rect.top &&
        pointerY <= rect.bottom;

      if (!isOverTarget || !tiptapRef.current) return;

      const isFolder = type === "directory";
      tiptapRef.current.insertFilePill(
        filePath,
        isFolder,
        isFolder ? "folder" : "file",
        name ?? filePath.split("/").pop() ?? filePath
      );
      Message.success(`Added ${name ?? filePath} as context`);
    };

    document.addEventListener("tab-drag-end", handleTabDragEnd);
    return () => {
      document.removeEventListener("tab-drag-end", handleTabDragEnd);
    };
  }, [containerRef, tiptapRef]);

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
    isDragOver,
  };
}
