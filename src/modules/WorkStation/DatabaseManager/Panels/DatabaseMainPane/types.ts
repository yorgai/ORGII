/**
 * DatabaseMainPane Types
 */
import type { TableInfo } from "@src/engines/DatabaseCore";

import type { ViewMode } from "./config";

// ============================================
// Component Props
// ============================================

export interface DatabaseMainPaneProps {
  connectionId: string | null;
  tableName: string | null;
  repoPath: string;
  /** Available tables for SQL autocomplete */
  tables?: TableInfo[];
}

// ============================================
// Re-export ViewMode
// ============================================

export type { ViewMode };
