/**
 * Usage History utilities — data fetching, chart helpers, and types.
 */
import dayjs from "dayjs";

import { CLI_AGENT } from "@src/api/tauri/rpc/schemas/validation";
import { invokeTauri } from "@src/util/platform/tauri/init";

import { getContributorColor } from "../GitDashboardView/config";

// ============================================
// Types
// ============================================

export const USAGE_SOURCE = {
  LOCAL: "local",
  POOLING: "pooling",
} as const;

export type UsageSource = (typeof USAGE_SOURCE)[keyof typeof USAGE_SOURCE];

export interface UsageHistoryFilters {
  source: "all" | UsageSource;
  selectedProvider: string | null;
  dateRange: string;
}

export const CHART_METRIC = {
  COST: "cost",
  TOKENS: "tokens",
} as const;

export type ChartMetric = (typeof CHART_METRIC)[keyof typeof CHART_METRIC];

/** Unified usage item for session display. */
export interface UsageItem {
  id: string;
  name: string;
  source: UsageSource;
  provider: string;
  model: string;
  tokens: number;
  /** Cost in USD — 0 for my_key sessions. */
  cost: number;
  date: dayjs.Dayjs;
  status: string;
}

// ============================================
// Wire type from Rust `session_usage_list`
// ============================================

interface UsageRecord {
  id: string;
  name: string;
  source: string;
  provider: string;
  model: string;
  tokens: number;
  cost: number;
  status: string;
  createdAt: string;
}

/** Filter passed to the Rust `session_usage_list` command. */
export interface UsageFilterParams {
  startDate?: string;
  endDate?: string;
  provider?: string;
}

// ============================================
// Data fetching
// ============================================

/** Fetch sessions from Rust via a single SQL UNION ALL query. */
export async function fetchUsageSessions(
  filter?: UsageFilterParams
): Promise<UsageItem[]> {
  const records = await invokeTauri<UsageRecord[]>("session_usage_list", {
    filter: filter ?? null,
  });
  if (!Array.isArray(records)) return [];

  return records.map((record) => ({
    id: record.id,
    name: record.name,
    source: (record.source === USAGE_SOURCE.POOLING
      ? USAGE_SOURCE.POOLING
      : USAGE_SOURCE.LOCAL) as UsageSource,
    provider: record.provider,
    model: record.model,
    tokens: record.tokens,
    cost: record.cost,
    date: dayjs(record.createdAt),
    status: record.status,
  }));
}

// ============================================
// Per-round token usage
// ============================================

/** Shape returned by Tauri `get_session_token_usage_records`. */
export interface TokenUsageRecord {
  id: number;
  sessionId: string;
  sessionType: string;
  model: string | null;
  accountId: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  contextTokens: number;
  createdAt: string;
}

/** Fetch per-round token usage records for a specific session. */
export async function fetchSessionTokenRecords(
  sessionId: string
): Promise<TokenUsageRecord[]> {
  const records = await invokeTauri<TokenUsageRecord[]>(
    "get_session_token_usage_records",
    { sessionId }
  );
  return Array.isArray(records) ? records : [];
}

// ============================================
// Chart helpers
// ============================================

/** Build Recharts-compatible data: one row per day, one key per provider. */
export function buildChartData(
  items: UsageItem[],
  startDateStr: string,
  endDateStr: string,
  metric: ChartMetric = CHART_METRIC.COST
): Array<Record<string, unknown>> {
  const start = dayjs(startDateStr).startOf("day");
  const end = dayjs(endDateStr).startOf("day");
  const days = Math.max(1, end.diff(start, "day") + 1);

  const buckets: Record<string, Record<string, number>> = {};
  for (let dayIndex = 0; dayIndex < days; dayIndex++) {
    const key = start.add(dayIndex, "day").format("MMM D");
    buckets[key] = {};
  }

  items.forEach((item) => {
    const key = item.date.format("MMM D");
    if (!buckets[key]) return;
    const value =
      metric === CHART_METRIC.TOKENS ? item.tokens / 1000 : item.cost;
    buckets[key][item.provider] = (buckets[key][item.provider] || 0) + value;
  });

  return Object.entries(buckets).map(([date, values]) => ({
    date,
    ...values,
  }));
}

// ============================================
// Provider colors
// ============================================

const AGENT_COLOR_ORDER = [
  CLI_AGENT.CURSOR,
  CLI_AGENT.CLAUDE_CODE,
  CLI_AGENT.CODEX,
  CLI_AGENT.GEMINI,
  CLI_AGENT.KIRO,
  CLI_AGENT.COPILOT,
  "sde_agent",
] as const;

const AGENT_COLOR_MAP = new Map<string, string>(
  AGENT_COLOR_ORDER.map((agent, idx) => [agent, getContributorColor(idx)])
);

export function getProviderColor(provider: string): string {
  return (
    AGENT_COLOR_MAP.get(provider) ?? getContributorColor(AGENT_COLOR_MAP.size)
  );
}
