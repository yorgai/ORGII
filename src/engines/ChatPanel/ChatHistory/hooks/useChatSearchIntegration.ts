/**
 * useChatSearchIntegration Hook
 *
 * Wires useChatSearch to the Virtuoso list and handles:
 * - Search visibility state
 * - chunk_id → optimizedChatHistory index mapping
 * - Content-based fallback search
 * - DOM text highlighting
 * - Search visibility and Escape-to-close handling
 */
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useEventNavigation } from "@src/engines/SessionCore";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import type { OptimizedChatItem } from "../chatItemPipeline/types";
import type { ChatHistoryListHandle } from "../components/ChatHistoryList";
import type { ChatSearchBarHandle } from "../components/ChatSearchBar";
import { type UseChatSearchReturn, useChatSearch } from "./useChatSearch";

// ============================================
// Types
// ============================================

export interface UseChatSearchIntegrationOptions {
  chatHistory: SessionEvent[];
  optimizedChatHistory: OptimizedChatItem[];
  virtualListRef: RefObject<ChatHistoryListHandle | null>;
  chatContainerRef: RefObject<HTMLDivElement | null>;
  /** Maps optimizedChatHistory index -> virtual flat item index. */
  originalToFlatIndex?: Map<number, number>;
}

export interface UseChatSearchIntegrationReturn {
  search: UseChatSearchReturn;
  isSearchVisible: boolean;
  searchBarRef: RefObject<ChatSearchBarHandle | null>;
  handleOpenSearch: () => void;
  handleCloseSearch: () => void;
}

// ============================================
// Hook
// ============================================

export function useChatSearchIntegration({
  chatHistory,
  optimizedChatHistory,
  virtualListRef,
  chatContainerRef,
  originalToFlatIndex,
}: UseChatSearchIntegrationOptions): UseChatSearchIntegrationReturn {
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const searchBarRef = useRef<ChatSearchBarHandle>(null);
  const { navigateToEvent } = useEventNavigation();

  // Build a map from chunk_id to optimizedChatHistory index for scroll navigation
  const chunkIdToOptimizedIndex = useMemo(() => {
    const map = new Map<string, number>();
    optimizedChatHistory.forEach((item, idx) => {
      if (item.chunk_id) {
        map.set(item.chunk_id, idx);

        // Also map original chunk_id if it's a group: prefixed id
        if (item.chunk_id.startsWith("group:")) {
          const parts = item.chunk_id.split(":");
          if (parts.length >= 4) {
            const originalId = parts.slice(3).join(":");
            map.set(originalId, idx);
          }
        }
      }
    });
    return map;
  }, [optimizedChatHistory]);

  // Fallback: find index by searching content
  const findOptimizedIndexByContent = useCallback(
    (searchQuery: string): number => {
      const query = searchQuery.toLowerCase();
      for (let idx = 0; idx < optimizedChatHistory.length; idx++) {
        const item = optimizedChatHistory[idx];
        if (item.event?.result) {
          const resultStr = JSON.stringify(item.event.result).toLowerCase();
          if (resultStr.includes(query)) return idx;
        }
        if (item.event?.displayText) {
          const displayText = String(item.event.displayText).toLowerCase();
          if (displayText.includes(query)) return idx;
        }
      }
      return -1;
    },
    [optimizedChatHistory]
  );

  // Wire useChatSearch with navigation callback
  const search = useChatSearch({
    chatHistory,
    onNavigateToEvent: useCallback(
      (eventId: string, _index: number, searchQuery: string) => {
        if (eventId) navigateToEvent(eventId);

        let optimizedIndex = chunkIdToOptimizedIndex.get(eventId);
        if (optimizedIndex === undefined && searchQuery) {
          optimizedIndex = findOptimizedIndexByContent(searchQuery);
        }

        if (
          optimizedIndex !== undefined &&
          optimizedIndex >= 0 &&
          virtualListRef.current
        ) {
          const scrollIdx = originalToFlatIndex
            ? (originalToFlatIndex.get(optimizedIndex) ?? optimizedIndex)
            : optimizedIndex;
          virtualListRef.current.scrollToIndex({
            index: scrollIdx,
            behavior: "smooth",
            align: "center",
          });
        }
      },
      [
        navigateToEvent,
        virtualListRef,
        chunkIdToOptimizedIndex,
        findOptimizedIndexByContent,
        originalToFlatIndex,
      ]
    ),
  });

  // DOM text highlighting
  useEffect(() => {
    if (!chatContainerRef.current) return;

    const container = chatContainerRef.current;
    const query = search.query.trim();

    const clearHighlights = () => {
      const marks = container.querySelectorAll("mark.search-text-highlight");
      marks.forEach((mark) => {
        const parent = mark.parentNode;
        if (parent) {
          parent.replaceChild(
            document.createTextNode(mark.textContent || ""),
            mark
          );
          parent.normalize();
        }
      });
    };

    clearHighlights();

    if (!query || !search.isSearchActive) return;

    const highlightText = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || "";
        const lowerText = text.toLowerCase();
        const lowerQuery = query.toLowerCase();
        const index = lowerText.indexOf(lowerQuery);

        if (index >= 0) {
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, index + query.length);

          const mark = document.createElement("mark");
          mark.className = "search-text-highlight";
          range.surroundContents(mark);
          return true;
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element;
        if (
          element.tagName === "SCRIPT" ||
          element.tagName === "STYLE" ||
          element.tagName === "MARK" ||
          element.classList.contains("search-text-highlight")
        ) {
          return false;
        }
        const children = Array.from(node.childNodes);
        for (const child of children) {
          highlightText(child);
        }
      }
      return false;
    };

    const timeoutId = setTimeout(() => {
      highlightText(container);
    }, 50);

    return () => {
      clearTimeout(timeoutId);
      clearHighlights();
    };
  }, [search.query, search.isSearchActive, chatContainerRef]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isSearchVisible) {
        event.preventDefault();
        event.stopPropagation();
        setIsSearchVisible(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isSearchVisible]);

  const handleOpenSearch = useCallback(() => {
    setIsSearchVisible(true);
  }, []);

  const handleCloseSearch = useCallback(() => {
    setIsSearchVisible(false);
  }, []);

  return {
    search,
    isSearchVisible,
    searchBarRef,
    handleOpenSearch,
    handleCloseSearch,
  };
}
