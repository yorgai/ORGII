import { type RefObject, useEffect } from "react";

import type { ComposerInputRef } from "@src/components/ComposerInput";
import Message from "@src/components/Message";
import { useTabDragHover } from "@src/engines/ChatPanel/InputArea/hooks/useTabDragHover";

export function useTabDragDrop(
  containerRef: RefObject<HTMLElement>,
  tiptapRef: RefObject<ComposerInputRef>
): boolean {
  const isDragOver = useTabDragHover(containerRef);

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

  return isDragOver;
}
