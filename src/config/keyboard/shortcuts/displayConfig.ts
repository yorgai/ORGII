import type { ShortcutCategory, ShortcutScope } from "./types";

export const CATEGORY_CONFIG: Record<
  ShortcutCategory,
  { label: string; order: number }
> = {
  window: { label: "Window", order: 1 },
  navigation: { label: "Navigation", order: 2 },
  file: { label: "File", order: 3 },
  editing: { label: "Editing", order: 4 },
  search: { label: "Search", order: 5 },
  panels: { label: "Panels", order: 6 },
  view: { label: "View", order: 7 },
  "source-control": { label: "Source Control", order: 8 },
  debugging: { label: "Debugging", order: 9 },
};

export const SCOPE_LABELS: Record<ShortcutScope, string> = {
  global: "Global",
  editor: "Editor",
  browser: "Browser",
  database: "Database",
  "source-control": "Source Control",
  spotlight: "Spotlight",
  chat: "Chat",
  "hunk-review": "Hunk Review",
  list: "Lists & Menus",
  "context-menu": "Context Menu",
  modal: "Modals",
  project: "Project Manager",
  "work-items": "Work Items",
};
