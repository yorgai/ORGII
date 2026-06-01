import type { SessionReplayPlaceholderMode } from "@src/modules/WorkStation/shared";

import type {
  CodePanelMode,
  ExploreOperationEntry,
  FileOperationEntry,
  ShellOperationEntry,
  ToolOperationEntry,
} from "../types";

export interface CodePanelProps {
  operation: FileOperationEntry | null;
  exploreOperation?: ExploreOperationEntry | null;
  shellOperation?: ShellOperationEntry | null;
  toolOperation?: ToolOperationEntry | null;
  mode?: CodePanelMode;
  /** When `"simulation"` (default), empty-state placeholders omit layout shortcut hints. */
  sessionReplayMode?: SessionReplayPlaceholderMode;
}

export interface PreviewModeState {
  filePath: string;
  active: boolean;
}
