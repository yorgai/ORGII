/**
 * Types for Browser
 */

export interface BrowserProps {
  /** Repository path (for context) */
  repoPath: string;
  /** Repository name for display */
  repoName: string;
  /** Whether the Browser is currently visible (WorkStation is active AND browser mode is active) */
  isActive?: boolean;
}
