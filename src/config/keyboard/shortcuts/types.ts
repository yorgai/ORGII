export type ShortcutScope =
  | "global"
  | "editor"
  | "browser"
  | "database"
  | "source-control"
  | "spotlight"
  | "chat"
  | "hunk-review"
  | "list"
  | "context-menu"
  | "modal"
  | "project"
  | "work-items";

export type ShortcutCategory =
  | "window"
  | "navigation"
  | "editing"
  | "panels"
  | "debugging"
  | "file"
  | "search"
  | "source-control"
  | "view";

export interface ShortcutEntry {
  id: string;
  command: string;
  macKeys: string;
  winKeys: string;
  scope: ShortcutScope;
  category: ShortcutCategory;
}
