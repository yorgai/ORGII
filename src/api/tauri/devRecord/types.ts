/**
 * Dev Record — TypeScript Types
 *
 * Mirrors Rust structs from src-tauri/src/dev_record/types.rs.
 * All field names are camelCase (Rust uses #[serde(rename_all = "camelCase")]).
 */

export interface DailySummary {
  date: string;
  workspacePath: string | null;
  language: string | null;
  totalSeconds: number;
  fileEdits: number;
  linesAdded: number;
  linesRemoved: number;
  terminalCmds: number;
  agentActions: number;
  filesTouched: number;
  primarySource: string;
}

export interface LanguageStat {
  language: string;
  totalSeconds: number;
  fileEdits: number;
  linesAdded: number;
  linesRemoved: number;
}

export interface HeatmapCell {
  hour: number;
  dayOfWeek: number;
  count: number;
}

export interface IdeUsageStat {
  source: string;
  totalSeconds: number;
  fileEdits: number;
  heartbeatCount: number;
}

export interface StreakInfo {
  currentStreak: number;
  longestStreak: number;
  lastActiveDate: string | null;
}

export interface CodingSession {
  id: number;
  startTime: string;
  endTime: string | null;
  workspacePath: string | null;
  source: string;
  durationSeconds: number;
  heartbeatCount: number;
}

export interface DetectedIde {
  source: string;
  pid: number;
  processName: string;
  isFrontmost: boolean;
}

export interface FileHotspot {
  filePath: string;
  editCount: number;
  linesAdded: number;
  linesRemoved: number;
  commitCount: number;
}

export interface CursorSession {
  id: string;
  name: string;
  createdAt: number;
  lastActiveAt: number;
  status: string;
  isAgentic: boolean;
  mode: string;
  model: string;
  linesAdded: number;
  linesRemoved: number;
  filesChanged: number;
  tokensUsed: number;
}

export interface ClaudeCodeSession {
  id: string;
  name: string;
  createdAt: number;
  lastActiveAt: number;
  messageCount: number;
  model: string;
  workspacePath: string;
  gitBranch: string;
  inputTokens: number;
  outputTokens: number;
}

export const CLI_TOOLS = {
  codex: "codex",
  gemini: "gemini",
  kiro: "kiro",
  aider: "aider",
  cursor_cli: "cursor_cli",
} as const;

export type CliTool = (typeof CLI_TOOLS)[keyof typeof CLI_TOOLS];

export const CLI_TOOL_LABELS: Record<CliTool, string> = {
  codex: "Codex",
  gemini: "Gemini CLI",
  kiro: "Kiro CLI",
  aider: "Aider",
  cursor_cli: "Cursor",
};

export interface CliSession {
  id: string;
  tool: CliTool;
  name: string;
  createdAt: number;
  lastActiveAt: number;
  messageCount: number;
  model: string;
  workspacePath: string;
  inputTokens: number;
  outputTokens: number;
}
