/**
 * QueryHistoryContent Component
 *
 * Shows recent SQL queries for quick re-execution.
 * Queries are stored per-connection in local storage.
 */
import { Play, Trash2 } from "lucide-react";
import React, { memo } from "react";
import { useTranslation } from "react-i18next";

import { HEADER_BUTTON } from "@src/modules/WorkStation/shared/tokens";
import { Placeholder } from "@src/modules/shared/layouts/blocks";

// ============================================
// Types
// ============================================

interface QueryHistoryItem {
  id: string;
  sql: string;
  connectionId: string;
  connectionName: string;
  executedAt: number;
  duration?: number;
  rowCount?: number;
}

// ============================================
// Component
// ============================================

export const QueryHistoryContent: React.FC = memo(() => {
  const { t } = useTranslation();
  // TODO: Implement query history with Jotai atomWithStorage
  const history: QueryHistoryItem[] = [];

  // Empty state
  if (history.length === 0) {
    return (
      <Placeholder
        variant="empty"
        placement="sidebar"
        title={t("placeholders.noQueryHistory")}
        subtitle={t("placeholders.executedQueriesSubtitle")}
        fillParentHeight
      />
    );
  }

  // History list
  return (
    <div className="flex flex-col gap-1 p-2">
      {history.map((item) => (
        <div
          key={item.id}
          className="group flex flex-col gap-1 rounded border border-border-1 bg-workstation-bg p-2 transition-colors hover:border-border-2"
        >
          {/* Query preview */}
          <pre className="line-clamp-2 overflow-hidden text-ellipsis whitespace-pre-wrap font-mono text-xs text-text-2">
            {item.sql}
          </pre>

          {/* Meta info */}
          <div className="flex items-center justify-between text-xs text-text-3">
            <span>{item.connectionName}</span>
            <div className="flex items-center gap-2">
              {item.duration && <span>{item.duration}ms</span>}
              {item.rowCount !== undefined && <span>{item.rowCount} rows</span>}
            </div>
          </div>

          {/* Actions (shown on hover) */}
          <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              className={HEADER_BUTTON.success}
              title={t("tooltips.runQuery")}
            >
              <Play size={14} />
            </button>
            <button
              className={HEADER_BUTTON.danger}
              title={t("tooltips.removeFromHistory")}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
});

QueryHistoryContent.displayName = "QueryHistoryContent";

export default QueryHistoryContent;
