import { invoke } from "@tauri-apps/api/core";

import type { ClaudeCodeSession, CliSession, CursorSession } from "./types";

export async function getOrgtrackCursorSessions(
  startDate: string,
  endDate: string
): Promise<CursorSession[]> {
  return invoke<CursorSession[]>("orgtrack_get_cursor_sessions", {
    startDate,
    endDate,
  });
}

export async function getOrgtrackClaudeCodeSessions(
  startDate: string,
  endDate: string
): Promise<ClaudeCodeSession[]> {
  return invoke<ClaudeCodeSession[]>("orgtrack_get_claude_sessions", {
    startDate,
    endDate,
  });
}

export async function getOrgtrackCliSessions(
  startDate: string,
  endDate: string,
  tool?: string
): Promise<CliSession[]> {
  return invoke<CliSession[]>("orgtrack_get_cli_sessions", {
    tool: tool ?? null,
    startDate,
    endDate,
  });
}
