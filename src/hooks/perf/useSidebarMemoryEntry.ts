import { useEffect, useMemo } from "react";

import {
  type SidebarMemoryKind,
  estimateRuntimeValueBytes,
  removeSidebarMemoryEntry,
  updateSidebarMemoryEntry,
} from "./runtimeMemoryStats";

const SIDEBAR_BASE_RENDER_BYTES = 18 * 1024;
const SIDEBAR_ITEM_RENDER_BYTES = 720;
const SIDEBAR_SECTION_RENDER_BYTES = 512;
const SIDEBAR_TAB_RENDER_BYTES = 640;
const SIDEBAR_ESTIMATION_NODE_LIMIT = 800;

interface SidebarMemoryInput {
  kind: SidebarMemoryKind;
  label: string;
  items: number;
  sections?: number;
  tabs?: number;
  source?: unknown;
  extraBytes?: number;
  enabled?: boolean;
}

export function useSidebarMemoryEntry(input: SidebarMemoryInput): void {
  const key = useMemo(() => Symbol(input.label), [input.label]);

  useEffect(() => {
    if (input.enabled === false) {
      removeSidebarMemoryEntry(key);
      return undefined;
    }

    const sections = input.sections ?? 0;
    const tabs = input.tabs ?? 0;
    const sourceBytes = input.source
      ? estimateRuntimeValueBytes(input.source, SIDEBAR_ESTIMATION_NODE_LIMIT)
      : 0;
    const renderBytes =
      SIDEBAR_BASE_RENDER_BYTES +
      input.items * SIDEBAR_ITEM_RENDER_BYTES +
      sections * SIDEBAR_SECTION_RENDER_BYTES +
      tabs * SIDEBAR_TAB_RENDER_BYTES;

    updateSidebarMemoryEntry(key, input.kind, {
      bytes: sourceBytes + renderBytes + (input.extraBytes ?? 0),
      items: input.items,
      label: input.label,
    });

    return () => removeSidebarMemoryEntry(key);
  }, [
    input.enabled,
    input.extraBytes,
    input.items,
    input.kind,
    input.label,
    input.sections,
    input.source,
    input.tabs,
    key,
  ]);
}
