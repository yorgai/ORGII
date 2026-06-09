import { type RefObject } from "react";

import type { ComposerInputRef } from "@src/components/ComposerInput";
import { useTabDragHover } from "@src/engines/ChatPanel/InputArea/hooks/useTabDragHover";
import { useTabDragEndToPill } from "@src/shared/dnd/useTabDragEndToPill";

export function useTabDragDrop(
  containerRef: RefObject<HTMLElement | null>,
  composerInputRef: RefObject<ComposerInputRef | null>
): boolean {
  const isDragOver = useTabDragHover(containerRef);
  useTabDragEndToPill(containerRef, composerInputRef);
  return isDragOver;
}
