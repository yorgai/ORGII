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
