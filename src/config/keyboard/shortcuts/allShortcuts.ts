import { BROWSER_SHORTCUTS } from "./browserShortcuts";
import { DATABASE_SHORTCUTS } from "./databaseShortcuts";
import { EDITOR_SHORTCUTS } from "./editorShortcuts";
import { GLOBAL_SHORTCUTS } from "./globalShortcuts";
import { OVERLAY_SHORTCUTS } from "./overlayShortcuts";
import { PROJECT_SHORTCUTS } from "./projectShortcuts";
import { SOURCE_CONTROL_SHORTCUTS } from "./sourceControlShortcuts";
import { SPOTLIGHT_SHORTCUTS } from "./spotlightShortcuts";
import type { ShortcutEntry } from "./types";

export const ALL_SHORTCUTS: ShortcutEntry[] = [
  ...GLOBAL_SHORTCUTS,
  ...EDITOR_SHORTCUTS,
  ...BROWSER_SHORTCUTS,
  ...DATABASE_SHORTCUTS,
  ...SOURCE_CONTROL_SHORTCUTS,
  ...SPOTLIGHT_SHORTCUTS,
  ...OVERLAY_SHORTCUTS,
  ...PROJECT_SHORTCUTS,
];
