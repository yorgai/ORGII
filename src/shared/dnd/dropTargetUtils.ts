import type { RefObject } from "react";

import type {
  ComposerInputRef,
  PillIconType,
} from "@src/components/ComposerInput";
import Message from "@src/components/Message";
import { loadWorkItemPillContent } from "@src/util/contextPillContent";

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

interface InsertPillOptions {
  path: string;
  name?: string;
  iconType?: PillIconType;
  isFolder?: boolean;
  pointerX?: number;
  pointerY?: number;
}

function getDisplayName(path: string, name: string | undefined): string {
  return name ?? path.split("/").pop() ?? path;
}

export function insertPillFromTabPayload(
  tiptapRef: RefObject<ComposerInputRef | null>,
  payload: InsertPillOptions
): void {
  if (!tiptapRef.current) return;
  if (!payload.path) return;

  const iconType = payload.iconType ?? (payload.isFolder ? "folder" : "file");
  const isFolder = payload.isFolder ?? iconType === "folder";
  const displayName = getDisplayName(payload.path, payload.name);

  if (payload.pointerX != null && payload.pointerY != null) {
    tiptapRef.current.placeCaretAtPoint(payload.pointerX, payload.pointerY);
  }

  if (iconType === "workitem") {
    const pillPath = `workitem://${payload.path}/${Date.now()}`;
    tiptapRef.current.insertFilePill(pillPath, false, "workitem", displayName);
    loadWorkItemPillContent(payload.path, pillPath);
    Message.success(`Added ${displayName} as context`);
    return;
  }

  tiptapRef.current.insertFilePill(
    payload.path,
    isFolder,
    iconType,
    displayName
  );
  Message.success(`Added ${displayName} as context`);
}

export function insertTabAsPill(
  tiptapRef: RefObject<ComposerInputRef | null>,
  filePath: string,
  name: string | undefined,
  type: string | undefined
): void {
  insertPillFromTabPayload(tiptapRef, {
    path: filePath,
    name,
    iconType: type === "directory" ? "folder" : "file",
    isFolder: type === "directory",
  });
}
