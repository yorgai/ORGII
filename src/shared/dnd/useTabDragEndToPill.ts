import { type RefObject, useEffect } from "react";

import type { ComposerInputRef } from "@src/components/ComposerInput";
import type { TabDragEventDetail } from "@src/modules/WorkStation/shared/TabBar/tabDragTypes";

import {
  insertPillFromTabPayload,
  insertTabAsPill,
  isPointerOverDropTarget,
} from "./dropTargetUtils";

export function useTabDragEndToPill(
  containerRef: RefObject<HTMLElement | null>,
  tiptapRef: RefObject<ComposerInputRef | null>
): void {
  useEffect(() => {
    const handleTabDragEnd = (e: Event) => {
      const event = e as CustomEvent<TabDragEventDetail>;
      const { filePath, name, type, pill, pointerX, pointerY } = event.detail;
      if (pointerX == null || pointerY == null) return;
      if (!isPointerOverDropTarget(containerRef, pointerX, pointerY)) return;
      if (pill) {
        insertPillFromTabPayload(tiptapRef, {
          ...pill,
          pointerX,
          pointerY,
        });
        return;
      }
      if (!filePath) return;
      insertTabAsPill(tiptapRef, filePath, name, type);
    };

    document.addEventListener("tab-drag-end", handleTabDragEnd);
    return () => {
      document.removeEventListener("tab-drag-end", handleTabDragEnd);
    };
  }, [containerRef, tiptapRef]);
}
