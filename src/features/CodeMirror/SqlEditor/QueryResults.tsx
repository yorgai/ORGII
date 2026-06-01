/**
 * QueryResults Component
 *
 * Displays SQL query results in a table format.
 * Features:
 * - Success/error status indicator
 * - Duration display
 * - Row count
 * - Scrollable results table
 */
import { AlertCircle, CheckCircle2, Clock } from "lucide-react";
import React, { memo } from "react";

import type { QueryResult } from "@src/engines/DatabaseCore";
import { Placeholder } from "@src/modules/shared/layouts/blocks";

// ============================================
// Types
// ============================================

export interface QueryResultsProps {
  /** Query result data */
  result: QueryResult | null;
  /** Error message if query failed */
  error: string | null;
  /** Loading state */
  loading?: boolean;
}

// ============================================
// Component
// ============================================

export const QueryResults: React.FC<QueryResultsProps> = memo(
  ({ result, error, loading }) => {
    // Loading state
    if (loading) {
      return <Placeholder variant="loading" title="Executing query..." />;
    }

    // Error state
    if (error) {
      return (
        <div className="flex h-full flex-col">
          {/* Error header */}
          <div className="bg-[color-mix(in srgb, var(--color-danger-6) 10%, transparent)] flex items-center gap-2 border-b border-border-1 px-3 py-2">
            <AlertCircle
              size={14}
              strokeWidth={1.75}
              className="text-[var(--color-danger-6)]"
            />
            <span className="text-xs font-medium text-[var(--color-danger-6)]">
              Query failed
            </span>
          </div>

          {/* Error message */}
          <div className="flex-1 overflow-auto p-3">
            <pre className="whitespace-pre-wrap text-xs text-[var(--color-danger-6)]">
              {error}
            </pre>
          </div>
        </div>
      );
    }

    // Empty state (no query run yet)
    if (!result) {
      return <Placeholder variant="empty" title="Run a query to see results" />;
    }

    // No results
    if (result.rowCount === 0) {
      return (
        <div className="flex h-full flex-col">
          {/* Success header */}
          <div className="bg-[color-mix(in srgb, var(--color-success-6) 10%, transparent)] flex items-center gap-3 border-b border-border-1 px-3 py-2">
            <div className="flex items-center gap-1.5">
              <CheckCircle2
                size={14}
                strokeWidth={1.75}
                className="text-[var(--color-success-6)]"
              />
              <span className="text-xs font-medium text-[var(--color-success-6)]">
                Query completed
              </span>
            </div>
            <div className="flex items-center gap-1 text-xs text-text-3">
              <Clock size={12} strokeWidth={1.75} />
              <span>{result.duration.toFixed(1)}ms</span>
            </div>
          </div>

          {/* Empty message */}
          <div className="flex flex-1 items-center justify-center">
            <Placeholder
              variant="no-results"
              title="Query returned no results"
            />
          </div>
        </div>
      );
    }

    // Results table
    return (
      <div className="flex h-full flex-col">
        {/* Success header with stats */}
        <div className="flex items-center gap-3 border-b border-border-1 bg-[color-mix(in_srgb,var(--color-success-6)_5%,transparent)] px-3 py-2">
          <div className="flex items-center gap-1.5">
            <CheckCircle2
              size={14}
              strokeWidth={1.75}
              className="text-[var(--color-success-6)]"
            />
            <span className="text-xs font-medium text-text-1">
              {result.rowCount} row{result.rowCount !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="flex items-center gap-1 text-xs text-text-3">
            <Clock size={12} strokeWidth={1.75} />
            <span>{result.duration.toFixed(1)}ms</span>
          </div>
        </div>

        {/* Results table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-bg-3">
              <tr>
                {result.columns.map((column, idx) => (
                  <th
                    key={idx}
                    className="border-b border-r border-border-1 px-3 py-2 text-left font-medium text-text-2 last:border-r-0"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.values.map((row, rowIdx) => (
                <tr key={rowIdx} className="hover:bg-fill-1">
                  {row.map((cell, cellIdx) => (
                    <td
                      key={cellIdx}
                      className="border-b border-r border-border-1 px-3 py-1.5 last:border-r-0"
                    >
                      {renderCellValue(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
);

// ============================================
// Helper Functions
// ============================================

function renderCellValue(value: unknown): React.ReactNode {
  if (value === null) {
    return <span className="italic text-text-4">NULL</span>;
  }
  if (value === undefined) {
    return <span className="text-text-4">—</span>;
  }
  if (typeof value === "boolean") {
    return <span className="text-[#722ed1]">{value ? "true" : "false"}</span>;
  }
  if (typeof value === "number") {
    return <span className="text-[#14c9c9]">{value}</span>;
  }
  // Truncate long strings
  const strValue = String(value);
  if (strValue.length > 100) {
    return (
      <span className="text-text-1" title={strValue}>
        {strValue.slice(0, 100)}…
      </span>
    );
  }
  // Ensure strings are visible in both light/dark themes.
  return <span className="text-text-1">{strValue}</span>;
}

QueryResults.displayName = "QueryResults";

export default QueryResults;
