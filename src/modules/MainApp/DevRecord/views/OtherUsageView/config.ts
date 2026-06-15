import type { CursorSession } from "@src/api/tauri/orgtrackHistory/types";

// ============================================
// Tab config
// ============================================

export const OTHER_USAGE_TABS = [
  { key: "overview", labelKey: "otherUsage.tabs.overview" },
  { key: "cursor", labelKey: "otherUsage.tabs.cursor" },
  { key: "cli", labelKey: "otherUsage.tabs.cli" },
] as const;

export type OtherUsageTabKey = (typeof OTHER_USAGE_TABS)[number]["key"];

export const DEFAULT_TAB: OtherUsageTabKey = "overview";

// ============================================
// Types
// ============================================

export interface ModelStats {
  model: string;
  sessionCount: number;
  tokensUsed: number;
  completedCount: number;
}

export interface OtherUsageViewProps {
  /** Reserved for future per-repo scoping. */
  repoPath?: string | null;
}

// ============================================
// Model aggregation
// ============================================

export function buildModelStats(
  sessions: CursorSession[],
  formatModelName: (raw: string) => string
): ModelStats[] {
  const byDisplay = new Map<string, ModelStats>();

  for (const session of sessions) {
    const raw = session.model || "unknown";
    const displayKey = formatModelName(raw);
    const existing = byDisplay.get(displayKey);

    if (existing) {
      existing.sessionCount += 1;
      existing.tokensUsed += session.tokensUsed;
      if (session.status === "completed") existing.completedCount += 1;
    } else {
      byDisplay.set(displayKey, {
        model: raw,
        sessionCount: 1,
        tokensUsed: session.tokensUsed,
        completedCount: session.status === "completed" ? 1 : 0,
      });
    }
  }

  return Array.from(byDisplay.values()).sort(
    (rowA, rowB) => rowB.tokensUsed - rowA.tokensUsed
  );
}
