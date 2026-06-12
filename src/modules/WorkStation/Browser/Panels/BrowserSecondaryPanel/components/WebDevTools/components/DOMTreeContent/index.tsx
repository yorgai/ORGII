/**
 * DOMTreeContent Component
 *
 * Renders the DOM tree structure for the browser inspector.
 * Reuses the shared tree rendering patterns for consistency.
 *
 * Features:
 * - Virtualized rendering for large DOM trees
 * - Syntax-colored tag names (tag#id.class)
 * - Bidirectional highlighting (hover tree → highlight element)
 * - Selection sync with webview inspector
 * - Auto-scroll to selected element (reveal)
 */
import React, { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";

import { TREE_ROW_HEIGHT } from "@src/components/TreeRow";
import type { DOMTreeNode } from "@src/modules/WorkStation/Browser/hooks/useWebviewDOMTree";
import { Placeholder } from "@src/modules/shared/layouts/blocks";

import { DOMTreeNodeRow } from "./DOMTreeNodeRow";
import type { FlattenedDOMNode } from "./types";
import { findNodeIndex, flattenDOMTree } from "./utils";

// ============================================
// Types
// ============================================

export interface DOMTreeContentProps {
  /** The DOM tree data */
  tree: DOMTreeNode | null;
  /** Set of expanded node xpaths */
  expandedNodes: Set<string>;
  /** Currently selected element xpath */
  selectedXPath: string | null;
  /** Currently highlighted xpath (hover) */
  highlightedXPath?: string | null;
  /** Toggle expanded state */
  onToggle: (xpath: string) => void;
  /** Select a node */
  onSelect: (xpath: string) => void;
  /** Hover a node (for highlighting) */
  onHover: (xpath: string | null) => void;
  /** Whether tree is loading */
  loading?: boolean;
  /** Error message */
  error?: string | null;
  /** Empty state message */
  emptyMessage?: string;
  /** XPath to scroll to (triggers scroll when changed) */
  revealXPath?: string | null;
  /** Key that increments to trigger reveal (even for same xpath) */
  revealKey?: number;
}

// ============================================
// Component
// ============================================

export const DOMTreeContent: React.FC<DOMTreeContentProps> = memo(
  ({
    tree,
    expandedNodes,
    selectedXPath,
    highlightedXPath,
    onToggle,
    onSelect,
    onHover,
    loading = false,
    error = null,
    emptyMessage,
    revealXPath,
    revealKey,
  }) => {
    const { t } = useTranslation();
    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    // Flatten tree for virtualization
    const flattenedNodes = useMemo(
      () => flattenDOMTree(tree, expandedNodes),
      [tree, expandedNodes]
    );

    // Keep a ref to flattened nodes for polling access
    const flattenedNodesRef = useRef(flattenedNodes);
    flattenedNodesRef.current = flattenedNodes;

    // Use virtualization for large trees
    const useVirtualization = flattenedNodes.length > 50;
    const useVirtualizationRef = useRef(useVirtualization);
    useVirtualizationRef.current = useVirtualization;

    // Track last reveal key to prevent duplicate scrolls
    const lastRevealKeyRef = useRef<number | undefined>(undefined);

    // Reveal/scroll to xpath (polling pattern like Explorer)
    useEffect(() => {
      // Only process if we have a new revealKey
      if (
        revealKey === undefined ||
        revealKey === lastRevealKeyRef.current ||
        !revealXPath
      ) {
        return;
      }

      const targetXPath = revealXPath;

      const attemptScroll = (): boolean => {
        const currentNodes = flattenedNodesRef.current;
        const index = findNodeIndex(currentNodes, targetXPath);

        if (index === -1) return false;

        // Found the node, scroll to it
        requestAnimationFrame(() => {
          if (useVirtualizationRef.current && virtuosoRef.current) {
            virtuosoRef.current.scrollToIndex({
              index,
              align: "center",
              behavior: "smooth",
            });
          } else if (scrollContainerRef.current) {
            const nodeElements =
              scrollContainerRef.current.querySelectorAll("[data-xpath]");
            const targetNode = Array.from(nodeElements).find(
              (el) => el.getAttribute("data-xpath") === targetXPath
            );
            if (targetNode) {
              targetNode.scrollIntoView({
                behavior: "smooth",
                block: "center",
              });
            }
          }
        });

        return true;
      };

      // Try immediately
      if (attemptScroll()) {
        lastRevealKeyRef.current = revealKey;
        return;
      }

      // Poll for async directory expansion (like Explorer)
      let attempts = 0;
      const intervalId = setInterval(() => {
        attempts++;
        if (attemptScroll() || attempts >= 20) {
          clearInterval(intervalId);
          lastRevealKeyRef.current = revealKey;
        }
      }, 100);

      return () => clearInterval(intervalId);
    }, [revealKey, revealXPath]);

    // Render a single node
    const renderNode = useCallback(
      (item: FlattenedDOMNode) => (
        <DOMTreeNodeRow
          node={item.node}
          depth={item.depth}
          isExpanded={expandedNodes.has(item.node.xpath)}
          isSelected={item.node.xpath === selectedXPath}
          isHighlighted={item.node.xpath === highlightedXPath}
          hasChildren={item.node.children.length > 0}
          onToggle={onToggle}
          onSelect={onSelect}
          onHover={onHover}
        />
      ),
      [
        expandedNodes,
        selectedXPath,
        highlightedXPath,
        onToggle,
        onSelect,
        onHover,
      ]
    );

    // Don't clear on container mouse leave - let debouncing handle it
    // This prevents flicker when state changes cause re-renders

    // Loading state
    if (loading && !tree) {
      return (
        <Placeholder
          variant="loading"
          placement="detail-panel"
          fillParentHeight
        />
      );
    }

    // Error state - but don't show "not found" errors (webview not loaded yet)
    if (error && !error.toLowerCase().includes("not found")) {
      return (
        <Placeholder
          variant="error"
          placement="detail-panel"
          title={error}
          fillParentHeight
        />
      );
    }

    // Empty state
    if (!tree || flattenedNodes.length === 0) {
      return (
        <Placeholder
          variant="empty"
          placement="sidebar"
          title={emptyMessage ?? t("placeholders.noDomTree")}
          fillParentHeight
        />
      );
    }

    return (
      <div className="h-full overflow-hidden">
        {useVirtualization ? (
          <Virtuoso
            ref={virtuosoRef}
            totalCount={flattenedNodes.length}
            itemContent={(index) => renderNode(flattenedNodes[index])}
            computeItemKey={(index) => flattenedNodes[index].node.xpath}
            overscan={30}
            increaseViewportBy={{ top: 200, bottom: 200 }}
            className="h-full scrollbar-hide"
            defaultItemHeight={TREE_ROW_HEIGHT}
          />
        ) : (
          <div
            ref={scrollContainerRef}
            className="h-full overflow-y-auto py-1 scrollbar-hide"
          >
            {flattenedNodes.map((item) => (
              <div key={item.node.xpath} data-xpath={item.node.xpath}>
                {renderNode(item)}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
);

DOMTreeContent.displayName = "DOMTreeContent";

export default DOMTreeContent;
