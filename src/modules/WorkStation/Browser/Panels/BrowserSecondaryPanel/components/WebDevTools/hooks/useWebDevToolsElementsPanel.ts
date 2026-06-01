/**
 * useWebDevToolsElementsPanel
 *
 * Manages all state and effects for the Elements panel inside WebDevTools:
 * - DOM tree (webview DOM hook, expand/collapse, reveal on selection)
 * - Style editor (computed styles, live edits, pending count)
 * - Source navigation (enrich source location, definition + usages lookup)
 * - Component index (build / clear / status)
 * - Selection sync from inspector → tree
 *
 * Extracted from WebDevTools/index.tsx to keep that component under the
 * UI component line limit.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { useRefreshSpin } from "@src/hooks/ui";
import { useSourceNavigation } from "@src/modules/WorkStation/Browser/hooks/useSourceNavigation";
import { useWebviewDOMTree } from "@src/modules/WorkStation/Browser/hooks/useWebviewDOMTree";
import type { SourceLocation } from "@src/modules/WorkStation/Browser/hooks/useWebviewInspector";
import { useWebviewStyleEditor } from "@src/modules/WorkStation/Browser/hooks/useWebviewStyleEditor";

import type { WebDevToolsProps } from "../types";

const DOM_TREE_DIRTY_POLL_MS = 1500;

interface UseWebDevToolsElementsPanelOptions {
  isOpen: boolean;
  activeTab: string;
  repoPath: string;
  webviewLabel: string;
  currentUrl: string;
  selectedElement: WebDevToolsProps["selectedElement"];
}

export interface UseWebDevToolsElementsPanelReturn {
  // DOM tree
  domTree: ReturnType<typeof useWebviewDOMTree>["tree"];
  treeLoading: boolean;
  treeError: string | null;
  expandedNodes: Set<string>;
  highlightedXpath: string | null;
  refreshTreeSpinClass: string | undefined;
  handleRefreshTreeClick: () => void;
  collapseAll: () => void;
  toggleExpanded: (xpath: string) => void;
  revealState: { xpath: string | null; key: number };
  highlightNode: (xpath: string | null) => void;

  // Selection
  effectiveSelectedXPath: string | null;
  handleTreeSelect: (xpath: string) => Promise<void>;

  // Style editor
  computedStyles: ReturnType<typeof useWebviewStyleEditor>["styles"];
  stylesLoading: boolean;
  stylesPending: boolean;
  styleEditCount: number;
  handleStyleChange: (property: string, value: string) => Promise<void>;
  handleStyleEditsUndo: () => void;
  handleStyleEditsSend: () => void;

  // Source / component index
  enrichedSourceLocation: SourceLocation | null;
  componentDefinition: { path: string; line?: number } | null;
  componentUsages: Array<{ path: string; line?: number }>;
  isLookingUp: boolean;
  isIndexBuilt: boolean;
  openFileAtLine: ReturnType<typeof useSourceNavigation>["openFileAtLine"];
  searchForComponent: ReturnType<
    typeof useSourceNavigation
  >["searchForComponent"];
  canSearchForComponent: ReturnType<
    typeof useSourceNavigation
  >["canSearchForComponent"];
  handleBuildIndex: () => Promise<void>;
  handleClearIndex: () => Promise<void>;
  indexRefreshKey: number;
}

export function useWebDevToolsElementsPanel({
  isOpen,
  activeTab,
  repoPath,
  webviewLabel,
  currentUrl,
  selectedElement,
}: UseWebDevToolsElementsPanelOptions): UseWebDevToolsElementsPanelReturn {
  // ---- Source Navigation ----
  const {
    openFileAtLine,
    canSearchForComponent,
    searchForComponent,
    enrichSourceLocation,
    getDefinitionAndUsages,
  } = useSourceNavigation({ repoPath });

  const [enrichedSourceLocation, setEnrichedSourceLocation] =
    useState<SourceLocation | null>(null);
  const [componentDefinition, setComponentDefinition] = useState<{
    path: string;
    line?: number;
  } | null>(null);
  const [componentUsages, setComponentUsages] = useState<
    Array<{ path: string; line?: number }>
  >([]);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [indexRefreshKey, setIndexRefreshKey] = useState(0);
  const [isIndexBuilt, setIsIndexBuilt] = useState(false);

  // Check index status when repoPath changes or after refresh
  useEffect(() => {
    if (!repoPath) {
      setIsIndexBuilt(false);
      return;
    }
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke<boolean>("ui_index_is_repo_indexed", { repoPath })
        .then((indexed) => setIsIndexBuilt(indexed))
        .catch(() => setIsIndexBuilt(false));
    });
  }, [repoPath, indexRefreshKey]);

  // Build component index
  const handleBuildIndex = useCallback(async () => {
    if (isIndexBuilt || !repoPath) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("ui_index_build_repo", { repoPath });
      setIsIndexBuilt(true);
      setIndexRefreshKey((k) => k + 1);
    } catch (error) {
      console.error("[WebDevTools] Failed to build index:", error);
    }
  }, [isIndexBuilt, repoPath]);

  // Clear component index
  const handleClearIndex = useCallback(async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("ui_index_clear", { repoPath });
      setComponentDefinition(null);
      setComponentUsages([]);
      setIsIndexBuilt(false);
      setIndexRefreshKey((k) => k + 1);
    } catch (error) {
      console.error("[WebDevTools] Failed to clear index:", error);
    }
  }, [repoPath]);

  // Auto-enrich source location when element is selected
  useEffect(() => {
    const sourceLocation = selectedElement?.sourceLocation;
    if (!sourceLocation) {
      setEnrichedSourceLocation(null);
      setComponentDefinition(null);
      setComponentUsages([]);
      return;
    }

    let cancelled = false;
    setIsLookingUp(true);

    Promise.all([
      enrichSourceLocation(sourceLocation),
      getDefinitionAndUsages(sourceLocation),
    ]).then(([enriched, { definition, usages }]) => {
      if (!cancelled) {
        if (definition && enriched) {
          setEnrichedSourceLocation({
            ...enriched,
            path: enriched.path || definition.path,
            line: enriched.line ?? definition.line ?? null,
            method: "component-index",
          });
        } else {
          setEnrichedSourceLocation(enriched);
        }
        setComponentDefinition(definition);
        setComponentUsages(usages);
        setIsLookingUp(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    selectedElement?.sourceLocation,
    enrichSourceLocation,
    getDefinitionAndUsages,
  ]);

  // ---- DOM Tree ----
  const {
    tree: domTree,
    loading: treeLoading,
    error: treeError,
    refresh: refreshTree,
    expandedNodes,
    toggleExpanded,
    expandToNode,
    collapseAll,
    highlightNode,
    selectNode,
    highlightedXpath,
  } = useWebviewDOMTree({
    webviewLabel,
    enabled: isOpen && activeTab === "elements" && !!webviewLabel,
    pollInterval: DOM_TREE_DIRTY_POLL_MS,
  });

  const {
    spinClass: refreshTreeSpinClass,
    handleClick: handleRefreshTreeClick,
  } = useRefreshSpin(refreshTree, treeLoading);

  // Auto-refresh DOM tree on URL changes
  const prevUrlRef = useRef(currentUrl);
  useEffect(() => {
    if (currentUrl && currentUrl !== prevUrlRef.current) {
      prevUrlRef.current = currentUrl;
      const timer = setTimeout(() => {
        setLocalSelectedXPath(null);
        refreshTree();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [currentUrl, refreshTree]);

  // ---- Selection ----
  const [localSelectedXPath, setLocalSelectedXPath] = useState<string | null>(
    null
  );
  const [revealState, setRevealState] = useState<{
    xpath: string | null;
    key: number;
  }>({
    xpath: null,
    key: 0,
  });

  const triggerReveal = useCallback((xpath: string) => {
    setRevealState((prev) => ({ xpath, key: prev.key + 1 }));
  }, []);

  const effectiveSelectedXPath =
    localSelectedXPath || selectedElement?.xpath || null;

  // Sync selection when inspector picks an element (adjusting state during render)
  const [prevSelectedElement, setPrevSelectedElement] =
    useState(selectedElement);
  if (selectedElement && selectedElement !== prevSelectedElement) {
    setPrevSelectedElement(selectedElement);
    if (selectedElement.xpath) {
      setLocalSelectedXPath(selectedElement.xpath);
    }
  } else if (!selectedElement && prevSelectedElement) {
    setPrevSelectedElement(null);
  }

  // Two-phase expand → reveal
  const prevXpathForExpandRef = useRef<string | null>(null);
  const [pendingRevealXpath, setPendingRevealXpath] = useState<string | null>(
    null
  );

  useEffect(() => {
    const xpath = selectedElement?.xpath;
    if (!xpath) {
      prevXpathForExpandRef.current = null;
      setPendingRevealXpath(null);
      return;
    }
    if (xpath !== prevXpathForExpandRef.current) {
      prevXpathForExpandRef.current = xpath;
      expandToNode(xpath);
      setPendingRevealXpath(xpath);
    }
  }, [selectedElement?.xpath, expandToNode]);

  useEffect(() => {
    if (!pendingRevealXpath || !domTree) return;

    const parts = pendingRevealXpath.split("/").filter(Boolean);
    if (parts.length > 1) {
      let parentPath = "";
      for (let index = 0; index < parts.length - 1; index++) {
        parentPath += "/" + parts[index];
      }
      if (!expandedNodes.has(parentPath)) return;
    }

    const xpath = pendingRevealXpath;
    setPendingRevealXpath(null);
    triggerReveal(xpath);
  }, [pendingRevealXpath, domTree, expandedNodes, triggerReveal]);

  // ---- Style Editor ----
  const {
    styles: computedStyles,
    loading: stylesLoading,
    setStyle,
    refresh: refreshStyles,
    isPending: stylesPending,
  } = useWebviewStyleEditor({
    webviewLabel,
    selectedXPath: effectiveSelectedXPath,
    enabled: isOpen && !!webviewLabel && !!effectiveSelectedXPath,
  });

  // Handle tree node selection
  const handleTreeSelect = useCallback(
    async (xpath: string) => {
      setLocalSelectedXPath(xpath);
      await selectNode(xpath);
      setTimeout(() => refreshStyles(), 150);
    },
    [selectNode, refreshStyles]
  );

  const prevEffectiveXPathRef = useRef(effectiveSelectedXPath);
  useEffect(() => {
    if (
      effectiveSelectedXPath &&
      effectiveSelectedXPath !== prevEffectiveXPathRef.current
    ) {
      prevEffectiveXPathRef.current = effectiveSelectedXPath;
      const timer = setTimeout(() => refreshStyles(), 150);
      return () => clearTimeout(timer);
    }
  }, [effectiveSelectedXPath, refreshStyles]);

  const [styleEditCount, setStyleEditCount] = useState(0);

  useEffect(() => {
    setStyleEditCount(0);
  }, [effectiveSelectedXPath]);

  const handleStyleChange = useCallback(
    async (property: string, value: string) => {
      const success = await setStyle(property, value);
      if (success) setStyleEditCount((n) => n + 1);
    },
    [setStyle]
  );

  const handleStyleEditsUndo = useCallback(() => {
    setStyleEditCount((n) => Math.max(0, n - 1));
  }, []);

  const handleStyleEditsSend = useCallback(() => {
    setStyleEditCount(0);
  }, []);

  return {
    domTree,
    treeLoading,
    treeError,
    expandedNodes,
    highlightedXpath,
    refreshTreeSpinClass,
    handleRefreshTreeClick,
    collapseAll,
    toggleExpanded,
    revealState,
    highlightNode,
    effectiveSelectedXPath,
    handleTreeSelect,
    computedStyles,
    stylesLoading,
    stylesPending,
    styleEditCount,
    handleStyleChange,
    handleStyleEditsUndo,
    handleStyleEditsSend,
    enrichedSourceLocation,
    componentDefinition,
    componentUsages,
    isLookingUp,
    isIndexBuilt,
    openFileAtLine,
    searchForComponent,
    canSearchForComponent,
    handleBuildIndex,
    handleClearIndex,
    indexRefreshKey,
  };
}
