/**
 * Renderer wrapper for `search` tabs.
 *
 * `SearchEditorContent` requires host-only callbacks (`onResultClick`,
 * `onQueryChangeForTitle`, `openFiles`) supplied today by
 * `TabContentRenderer`. Phase 1b leaves those wires alone: AppShell
 * collapse in Phase 2 will lift the search action dispatcher to a
 * level the unified registry can reach.
 *
 * TODO(phase-2): consume `EditorActionContext`-style callbacks so the
 * search editor can mount through the registry without a host shell.
 */
import React, { memo } from "react";

import type { UnifiedTabContentProps } from "../types";
import { HostCoupledPlaceholder } from "./HostCoupledPlaceholder";

const SearchTabRenderer: React.FC<UnifiedTabContentProps> = memo(({ tab }) => (
  <HostCoupledPlaceholder
    tabType={tab.type}
    title={String(tab.title ?? "Search")}
    hostNote="Search editor still rendered by the Code Editor host. Phase 2 will lift its result-click and title-change callbacks into the unified dispatcher."
  />
));

SearchTabRenderer.displayName = "SearchTabRenderer";

export default SearchTabRenderer;
