/**
 * Output channel types shared across the workstation domain.
 *
 * Canonical home for OutputChannel, OutputChannelType, OutputLine, and
 * OutputPanelConfig. Lives here so src/store/, src/hooks/, and src/services/
 * do not need to import from a deep CodeEditor panel path.
 */

export type OutputChannelType =
  | "tasks"
  | "git"
  | "build"
  | "filesync"
  | "test"
  | "extension"
  | "lsp"
  | "gui-agent"
  | "custom";

export interface OutputLine {
  id: string;
  content: string;
  timestamp: number;
  type?: "normal" | "error" | "warning" | "info" | "success";
}

export interface OutputChannel {
  id: string;
  name: string;
  type: OutputChannelType;
  content: string;
  maxChars?: number;
  active?: boolean;
  processAnsi?: boolean;
}

export interface OutputPanelConfig {
  defaultMaxLines?: number;
  autoScroll?: boolean;
  showTimestamps?: boolean;
  wordWrap?: boolean;
}
