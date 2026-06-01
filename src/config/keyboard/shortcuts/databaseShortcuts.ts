import type { ShortcutEntry } from "./types";

export const DATABASE_SHORTCUTS: ShortcutEntry[] = [
  {
    id: "db_sidebar",
    command: "Toggle sidebar",
    macKeys: "⌘B",
    winKeys: "Ctrl+B",
    scope: "database",
    category: "panels",
  },
  {
    id: "db_connections",
    command: "Open connections",
    macKeys: "",
    winKeys: "",
    scope: "database",
    category: "navigation",
  },
  {
    id: "db_run_query",
    command: "Run query",
    macKeys: "⌘+Enter",
    winKeys: "Ctrl+Enter",
    scope: "database",
    category: "editing",
  },
];
