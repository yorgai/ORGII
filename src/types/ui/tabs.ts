/**
 * Browser Session Type
 *
 * Used by BrowserContext and BrowserSessionWebview for browser session state management
 * in WorkStation' browser functionality.
 *
 * NOTE: Tab types are now defined in their respective stores:
 * - MainApp tabs: src/store/tabs/types.ts (MainAppTab)
 * - WorkStation tabs: src/store/workStationTabs/types.ts
 */

/**
 * BrowserSession - Browser session state
 *
 * Used by:
 * - src/contexts/workstation/BrowserContext.tsx
 * - src/engines/BrowserCore/BrowserSessionWebview.tsx
 */
export interface BrowserHistoryEntry {
  url: string;
  title: string;
  visitedAt: number;
}

export interface BrowserSession {
  id: string;
  url: string;
  title: string;
  history: string[];
  historyIndex: number;
  historyEntries?: BrowserHistoryEntry[];
  isLoading: boolean;
  error: string | null;
  incognito?: boolean;
}
