/**
 * Dev Record — Tauri API Wrappers
 *
 * Thin invoke wrappers around the dev_record Tauri commands.
 */
import { invoke } from "@tauri-apps/api/core";

import type {
  ClaudeCodeSession,
  CliSession,
  CodingSession,
  CursorSession,
  DailySummary,
  DetectedIde,
  FileHotspot,
  HeatmapCell,
  IdeUsageStat,
  LanguageStat,
  StreakInfo,
} from "./types";

export async function getDevRecordSummary(
  startDate: string,
  endDate: string
): Promise<DailySummary[]> {
  return invoke<DailySummary[]>("dev_record_get_summary", {
    startDate,
    endDate,
  });
}

export async function getDevRecordLanguageStats(
  startDate: string,
  endDate: string
): Promise<LanguageStat[]> {
  return invoke<LanguageStat[]>("dev_record_get_language_stats", {
    startDate,
    endDate,
  });
}

export async function getDevRecordHeatmap(
  startDate: string,
  endDate: string
): Promise<HeatmapCell[]> {
  return invoke<HeatmapCell[]>("dev_record_get_heatmap", {
    startDate,
    endDate,
  });
}

export async function getDevRecordIdeUsage(
  startDate: string,
  endDate: string
): Promise<IdeUsageStat[]> {
  return invoke<IdeUsageStat[]>("dev_record_get_ide_usage", {
    startDate,
    endDate,
  });
}

export async function getDevRecordStreaks(): Promise<StreakInfo> {
  return invoke<StreakInfo>("dev_record_get_streaks");
}

export async function getDevRecordActiveIdes(): Promise<DetectedIde[]> {
  return invoke<DetectedIde[]>("dev_record_get_active_ides");
}

export async function getDevRecordSessions(
  startDate: string,
  endDate: string
): Promise<CodingSession[]> {
  return invoke<CodingSession[]>("dev_record_get_sessions", {
    startDate,
    endDate,
  });
}

export async function getDevRecordSessionCount(
  startDate: string,
  endDate: string
): Promise<number> {
  return invoke<number>("dev_record_get_session_count", {
    startDate,
    endDate,
  });
}

export async function getCursorSessions(
  startDate: string,
  endDate: string
): Promise<CursorSession[]> {
  return invoke<CursorSession[]>("dev_record_get_cursor_sessions", {
    startDate,
    endDate,
  });
}

export async function getClaudeCodeSessions(
  startDate: string,
  endDate: string
): Promise<ClaudeCodeSession[]> {
  return invoke<ClaudeCodeSession[]>("dev_record_get_claude_sessions", {
    startDate,
    endDate,
  });
}

export async function getDevRecordFileHotspots(
  startDate: string,
  endDate: string,
  limit?: number
): Promise<FileHotspot[]> {
  return invoke<FileHotspot[]>("dev_record_get_file_hotspots", {
    startDate,
    endDate,
    limit,
  });
}

export async function importHeartbeats(): Promise<number> {
  return invoke<number>("dev_record_import_heartbeats");
}

export async function getCliSessions(
  startDate: string,
  endDate: string,
  tool?: string
): Promise<CliSession[]> {
  return invoke<CliSession[]>("dev_record_get_cli_sessions", {
    tool: tool ?? null,
    startDate,
    endDate,
  });
}
