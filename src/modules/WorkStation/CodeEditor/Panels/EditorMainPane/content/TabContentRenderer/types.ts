/**
 * TabContentRenderer Types
 *
 * Type definitions for the tab content renderer component.
 */
import type { UseTerminalStateReturn } from "@/src/engines/TerminalCore/exports";

import type { QuickAction } from "@src/modules/WorkStation/shared";
import type { SourceControlFilterMode } from "@src/modules/WorkStation/shared/SidebarModules";
import type { CursorPosition } from "@src/modules/WorkStation/shared/StatusBar/EditorStatusBar";
import type { WorkStationTab } from "@src/store/workstation/tabs";
import type { GitFile } from "@src/types/git/types";

import type { Diagnostic } from "../../../EditorBottomPanel/content/ProblemsContent/types";
import type { UseFileContentManagerReturn } from "../../hooks/useFileContentManager";

// ============================================
// Component Props
// ============================================

export interface TabContentRendererProps {
  /** Currently active tab */
  activeTab: WorkStationTab | null;
  /** Repository path */
  repoPath: string;
  /** Repository id from selection state */
  repoId: string | null;
  /** File content manager state */
  fileContentState: UseFileContentManagerReturn;
  /** Git files by path for diff viewing */
  gitFilesByPath: Map<string, GitFile>;
  /** Source Control files enriched with session attribution. */
  sourceControlAttributedFiles: GitFile[];
  /** Whether git diff is loading */
  gitDiffLoading: boolean;
  /** Force refresh git status */
  forceRefresh: () => void;
  /** File select callback */
  onFileSelect: (path: string) => void;
  /** Diagnostics change callback */
  onDiagnosticsChange?: (diagnostics: Diagnostic[]) => void;
  /** Cursor position change callback */
  onCursorPositionChange?: (position: CursorPosition | null) => void;
  /** Update an active search tab title from its query */
  onSearchTabTitleChange?: (tabId: string, query: string) => void;
  /** Sync git-diff local edits to tab bar unsaved indicator */
  onGitDiffUnsavedChange?: (hasUnsaved: boolean) => void;
  /** Sync binary preview edits to tab bar unsaved indicator */
  onBinaryUnsavedChange?: (hasUnsaved: boolean) => void;
  /** Monotonic signal from the Source Control header collapse-all action. */
  sourceControlCollapseAllSignal?: number;
  /** Current Source Control file filter selected in the header. */
  sourceControlFilterMode?: SourceControlFilterMode;
  /** Shared terminal runtime state for the pinned Terminal tab */
  terminalState: UseTerminalStateReturn;
  /** Regular editor placeholder actions reused by empty source-control focus view */
  editorQuickActions: QuickAction[];
}
