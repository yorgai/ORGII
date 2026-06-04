import type { RefObject } from "react";

import type { ComposerInputRef } from "@src/components/ComposerInput";
import Message from "@src/components/Message";

export const CHAT_DROP_TARGET_SELECTOR = "[data-chat-drop-target]";

export function resolveDropTarget(
  containerRef: RefObject<HTMLElement | null>
): HTMLElement | null {
  if (!containerRef.current) return null;
  return containerRef.current.matches(CHAT_DROP_TARGET_SELECTOR)
    ? containerRef.current
    : containerRef.current.querySelector<HTMLElement>(
        CHAT_DROP_TARGET_SELECTOR
      );
}

export function isPointerOverDropTarget(
  containerRef: RefObject<HTMLElement | null>,
  x: number,
  y: number
): boolean {
  const dropTarget = resolveDropTarget(containerRef);
  if (!dropTarget) return false;
  const rect = dropTarget.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

export function insertTabAsPill(
  tiptapRef: RefObject<ComposerInputRef | null>,
  filePath: string,
  name: string | undefined,
  type: string | undefined
): void {
  if (!tiptapRef.current) return;
  const isFolder = type === "directory";
  tiptapRef.current.insertFilePill(
    filePath,
    isFolder,
    isFolder ? "folder" : "file",
    name ?? filePath.split("/").pop() ?? filePath
  );
  Message.success(`Added ${name ?? filePath} as context`);
}
