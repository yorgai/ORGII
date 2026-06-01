/**
 * BrowserLayout Types
 */

export interface BrowserLayoutProps {
  /** Repository path (for context) */
  repoPath: string;
  /** Repository name for display */
  repoName: string;
  /** Whether the Browser is currently visible */
  isActive?: boolean;
}

export interface AgentBrowserOverlayProps {
  screenshot: string | null;
  action: string | null;
  url: string;
  isPaused: boolean;
  onTakeover: () => void;
  onResume: () => Promise<string>;
  onStop: () => void;
}
