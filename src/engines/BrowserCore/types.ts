// Browser-specific types

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

export interface BrowserTabData {
  sessions: BrowserSession[];
  activeSessionId: string;
  useProxy: boolean;
  homeUrl: string;
}

export interface ProxyResponse {
  body: string;
  content_type: string;
  status: number;
  is_binary: boolean;
}

export interface NavigationAction {
  type: "navigate" | "back" | "forward" | "refresh" | "home";
  url?: string;
}
