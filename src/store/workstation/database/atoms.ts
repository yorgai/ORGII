/**
 * Database State Atoms
 *
 * Global state for database connections using Jotai.
 * Connections persist across component remounts.
 *
 * Persistence: Stores connection configs in localStorage so they can be
 * reopened on app restart. The actual database service instances are
 * recreated from configs.
 *
 * Architecture:
 * - DatabaseConnection: Runtime state for UI (tables, loading, etc.)
 * - DatabaseConnectionConfig: Persisted config (from types.ts)
 * - IDatabaseService: Service instances (managed by factory)
 */
import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

import type {
  DatabaseConnectionConfig,
  DatabaseType,
  TableInfo,
} from "@src/engines/DatabaseCore";

// ============================================
// Runtime Connection State (UI)
// ============================================

/**
 * Runtime state for a database connection
 * This is used by UI components for display and interaction
 */
export interface DatabaseConnection {
  /** Unique connection ID (matches config.id) */
  id: string;
  /** Display name */
  name: string;
  /** Database type */
  type: DatabaseType;
  /** File path (SQLite) or URL (remote) */
  path: string;
  /** Tables in the database */
  tables: TableInfo[];
  /** Whether tree is expanded in UI */
  isExpanded: boolean;
  /** Loading state */
  isLoading: boolean;
  /** Error message if any */
  error?: string;
}

// ============================================
// Pending Change Types (CRUD)
// ============================================

/** Types of pending changes */
export type PendingChangeType = "insert" | "update" | "delete";

/** A pending change to be applied on save */
export interface PendingChange {
  /** Unique ID for this change */
  id: string;
  /** Type of change */
  type: PendingChangeType;
  /** Row index in the current data (for display) */
  rowIndex: number;
  /** Original row data (for update/delete - used for WHERE clause) */
  originalData?: Record<string, unknown>;
  /** New row data (for insert/update) */
  newData?: Record<string, unknown>;
  /** Column that was changed (for single cell updates) */
  changedColumn?: string;
}

// ============================================
// Storage Keys
// ============================================

const STORAGE_KEY_V2 = "orgii:database-connection-configs";

// ============================================
// Config Persistence
// ============================================

/**
 * Load connection configs from localStorage
 * Supports all database types (SQLite, PostgreSQL, MySQL, Supabase, Neon, Turso)
 */
export function loadConnectionConfigs(): DatabaseConnectionConfig[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_V2);
    if (stored) {
      return JSON.parse(stored) as DatabaseConnectionConfig[];
    }
  } catch (error) {
    console.warn("Failed to load connection configs:", error);
  }
  return [];
}

/**
 * Save connection configs to localStorage
 */
export function saveConnectionConfigs(
  configs: DatabaseConnectionConfig[]
): void {
  try {
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(configs));
  } catch (error) {
    console.warn("Failed to save connection configs:", error);
  }
}

/**
 * Add a new connection config
 */
export function addConnectionConfig(
  config: DatabaseConnectionConfig
): DatabaseConnectionConfig[] {
  const configs = loadConnectionConfigs();
  // Check for duplicate
  const exists = configs.some((existing) => existing.id === config.id);
  if (!exists) {
    configs.push(config);
    saveConnectionConfigs(configs);
  }
  return configs;
}

/**
 * Remove a connection config by ID
 */
export function removeConnectionConfig(
  connectionId: string
): DatabaseConnectionConfig[] {
  const configs = loadConnectionConfigs();
  const filtered = configs.filter((config) => config.id !== connectionId);
  saveConnectionConfigs(filtered);
  return filtered;
}

/**
 * Update a connection config
 */
export function updateConnectionConfig(
  connectionId: string,
  updates: Partial<DatabaseConnectionConfig>
): DatabaseConnectionConfig[] {
  const configs = loadConnectionConfigs();
  const index = configs.findIndex((config) => config.id === connectionId);
  if (index !== -1) {
    configs[index] = {
      ...configs[index],
      ...updates,
      updatedAt: Date.now(),
    } as DatabaseConnectionConfig;
    saveConnectionConfigs(configs);
  }
  return configs;
}

// ============================================
// Atoms
// ============================================

/** All open database connections (runtime state for UI) */
export const databaseConnectionsAtom = atom<DatabaseConnection[]>([]);

/** Currently loading state */
export const databaseLoadingAtom = atom(false);

/** Error state */
export const databaseErrorAtom = atom<string | null>(null);

/** Currently selected connection ID */
export const activeConnectionIdAtom = atom<string | null>(null);

/** Currently selected table name */
export const selectedTableAtom = atom<string | null>(null);

// ============================================
// Derived Atoms
// ============================================

/** Get connection by ID */
export const getConnectionByIdAtom = atom((get) => {
  const connections = get(databaseConnectionsAtom);
  return (id: string) => connections.find((conn) => conn.id === id);
});

/** Get all connection paths (for checking duplicates) */
export const connectionPathsAtom = atom((get) => {
  const connections = get(databaseConnectionsAtom);
  return new Set(connections.map((conn) => conn.path));
});

/** Get the active connection */
export const activeConnectionAtom = atom((get) => {
  const connections = get(databaseConnectionsAtom);
  const activeId = get(activeConnectionIdAtom);
  return connections.find((conn) => conn.id === activeId) ?? null;
});

/** Get tables for the active connection */
export const activeConnectionTablesAtom = atom((get) => {
  const activeConnection = get(activeConnectionAtom);
  return activeConnection?.tables ?? [];
});

// ============================================
// Pending Changes Helper Functions
// ============================================

/** Generate a unique change ID */
export function generateChangeId(): string {
  return `change-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================
// Query History Types
// ============================================

/** A query history item */
export interface QueryHistoryItem {
  /** The SQL query */
  sql: string;
  /** When the query was executed */
  timestamp: number;
  /** Query execution duration in ms */
  duration: number;
  /** Whether the query succeeded */
  success: boolean;
  /** Number of rows returned (for SELECT) */
  rowCount?: number;
  /** Error message if failed */
  error?: string;
}

// ============================================
// Query History Storage
// ============================================

const QUERY_HISTORY_KEY = "orgii:database-query-history";
export const MAX_HISTORY_PER_CONNECTION = 50;

/**
 * Load query history for a connection from localStorage
 */
export function loadQueryHistory(connectionId: string): QueryHistoryItem[] {
  try {
    const stored = localStorage.getItem(QUERY_HISTORY_KEY);
    if (stored) {
      const allHistory = JSON.parse(stored) as Record<
        string,
        QueryHistoryItem[]
      >;
      return allHistory[connectionId] || [];
    }
  } catch (error) {
    console.warn("Failed to load query history:", error);
  }
  return [];
}

/**
 * Save a query to history for a connection
 */
export function saveQueryToHistory(
  connectionId: string,
  item: QueryHistoryItem
): void {
  try {
    const stored = localStorage.getItem(QUERY_HISTORY_KEY);
    const allHistory: Record<string, QueryHistoryItem[]> = stored
      ? JSON.parse(stored)
      : {};

    // Get existing history for this connection
    const history = allHistory[connectionId] || [];

    // Add new item at the beginning
    history.unshift(item);

    // Limit to max items
    if (history.length > MAX_HISTORY_PER_CONNECTION) {
      history.length = MAX_HISTORY_PER_CONNECTION;
    }

    // Save back
    allHistory[connectionId] = history;
    localStorage.setItem(QUERY_HISTORY_KEY, JSON.stringify(allHistory));
  } catch (error) {
    console.warn("Failed to save query history:", error);
  }
}

/**
 * Clear query history for a connection
 */
export function clearQueryHistory(connectionId: string): void {
  try {
    const stored = localStorage.getItem(QUERY_HISTORY_KEY);
    if (stored) {
      const allHistory = JSON.parse(stored) as Record<
        string,
        QueryHistoryItem[]
      >;
      delete allHistory[connectionId];
      localStorage.setItem(QUERY_HISTORY_KEY, JSON.stringify(allHistory));
    }
  } catch (error) {
    console.warn("Failed to clear query history:", error);
  }
}

// ============================================
// Query History Atom (atomWithStorage)
// ============================================

type QueryHistoryMap = Record<string, QueryHistoryItem[]>;

const queryHistoryStorage = {
  getItem: (key: string, initialValue: QueryHistoryMap): QueryHistoryMap => {
    try {
      const stored = localStorage.getItem(key);
      if (!stored) return initialValue;
      const parsed = JSON.parse(stored) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return initialValue;
      }
      return parsed as QueryHistoryMap;
    } catch {
      return initialValue;
    }
  },
  setItem: (key: string, value: QueryHistoryMap): void => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.warn("Failed to persist query history:", error);
    }
  },
  removeItem: (key: string): void => {
    localStorage.removeItem(key);
  },
};

/**
 * Persisted query history atom keyed by connectionId.
 * Each connection stores up to MAX_HISTORY_PER_CONNECTION entries (most recent first).
 */
export const queryHistoryAtom = atomWithStorage<QueryHistoryMap>(
  QUERY_HISTORY_KEY,
  {},
  queryHistoryStorage
);
queryHistoryAtom.debugLabel = "queryHistoryAtom";
