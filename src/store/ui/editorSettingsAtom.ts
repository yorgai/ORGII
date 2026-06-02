/**
 * Editor Settings Store
 *
 * Manages user-defined settings for the Orgii Editor.
 * Backed by the central settings system (~/.orgii/settings.jsonc).
 * Legacy atoms are now derived from the central settingsAtom.
 */
import { atom } from "jotai";

import {
  type BaseEditorThemeId,
  getGlobalTheme,
  normalizeGlobalThemeId,
} from "@src/config/appearance/globalThemes";
import {
  settingsAtom,
  updateSettingAtom,
} from "@src/store/settings/settingsAtom";

// ============================================
// Editor Appearance Settings
// ============================================

/**
 * Code font family preset
 * Applies to CodeMirror, Terminal (xterm.js), and output panels
 */
export type CodeFontFamily =
  | "system"
  | "jetbrains-mono"
  | "fira-code"
  | "source-code-pro"
  | "cascadia-code"
  | "ibm-plex-mono"
  | "ubuntu-mono"
  | "hack"
  | "inconsolata"
  | "custom";

/** Preset font family options for the UI */
export const CODE_FONT_FAMILIES: { value: CodeFontFamily; label: string }[] = [
  { value: "system", label: "System Default" },
  { value: "jetbrains-mono", label: "JetBrains Mono" },
  { value: "fira-code", label: "Fira Code" },
  { value: "source-code-pro", label: "Source Code Pro" },
  { value: "cascadia-code", label: "Cascadia Code" },
  { value: "ibm-plex-mono", label: "IBM Plex Mono" },
  { value: "ubuntu-mono", label: "Ubuntu Mono" },
  { value: "hack", label: "Hack" },
  { value: "inconsolata", label: "Inconsolata" },
  { value: "custom", label: "Custom" },
];

/** CSS font-family values for each preset */
export const CODE_FONT_FAMILY_CSS: Record<CodeFontFamily, string> = {
  system:
    '"SF Mono", "Menlo", "Monaco", "Consolas", "Liberation Mono", "Courier New", monospace',
  "jetbrains-mono":
    '"JetBrains Mono", "SF Mono", "Menlo", "Monaco", "Consolas", monospace',
  "fira-code":
    '"Fira Code", "SF Mono", "Menlo", "Monaco", "Consolas", monospace',
  "source-code-pro":
    '"Source Code Pro", "SF Mono", "Menlo", "Monaco", "Consolas", monospace',
  "cascadia-code":
    '"Cascadia Code", "SF Mono", "Menlo", "Monaco", "Consolas", monospace',
  "ibm-plex-mono":
    '"IBM Plex Mono", "SF Mono", "Menlo", "Monaco", "Consolas", monospace',
  "ubuntu-mono":
    '"Ubuntu Mono", "SF Mono", "Menlo", "Monaco", "Consolas", monospace',
  hack: '"Hack", "SF Mono", "Menlo", "Monaco", "Consolas", monospace',
  inconsolata:
    '"Inconsolata", "SF Mono", "Menlo", "Monaco", "Consolas", monospace',
  custom:
    '"SF Mono", "Menlo", "Monaco", "Consolas", "Liberation Mono", "Courier New", monospace',
};

/** Map human-readable font names (JSON) ↔ internal kebab-case IDs (code) */
const FONT_NAME_TO_ID: Record<string, CodeFontFamily> = {
  "System Default": "system",
  "JetBrains Mono": "jetbrains-mono",
  "Fira Code": "fira-code",
  "Source Code Pro": "source-code-pro",
  "Cascadia Code": "cascadia-code",
  "IBM Plex Mono": "ibm-plex-mono",
  "Ubuntu Mono": "ubuntu-mono",
  Hack: "hack",
  Inconsolata: "inconsolata",
  Custom: "custom",
};
const FONT_ID_TO_NAME: Record<CodeFontFamily, string> = {
  system: "System Default",
  "jetbrains-mono": "JetBrains Mono",
  "fira-code": "Fira Code",
  "source-code-pro": "Source Code Pro",
  "cascadia-code": "Cascadia Code",
  "ibm-plex-mono": "IBM Plex Mono",
  "ubuntu-mono": "Ubuntu Mono",
  hack: "Hack",
  inconsolata: "Inconsolata",
  custom: "Custom",
};

/**
 * Selected code font family preset (backed by settings.jsonc)
 * JSON stores human-readable names; code uses kebab-case IDs.
 */
export const codeFontFamilyAtom = atom(
  (get) => {
    const name = get(settingsAtom)["editor.fontFamily"];
    return FONT_NAME_TO_ID[name] ?? "system";
  },
  (_get, set, value: CodeFontFamily) => {
    const name = FONT_ID_TO_NAME[value] ?? "System Default";
    set(updateSettingAtom, { key: "editor.fontFamily", value: name });
  }
);

/**
 * Custom font family name (when codeFontFamily is "custom")
 */
export const customCodeFontFamilyAtom = atom(
  (get) => get(settingsAtom)["editor.customFontFamily"],
  (_get, set, value: string) => {
    set(updateSettingAtom, { key: "editor.customFontFamily", value });
  }
);

/**
 * Resolved CSS font-family string (derived atom)
 * Use this to get the actual font-family CSS value
 */
export const resolvedCodeFontFamilyAtom = atom<string>((get) => {
  const preset = get(codeFontFamilyAtom);
  if (preset === "custom") {
    const customFont = get(customCodeFontFamilyAtom).trim();
    if (customFont) {
      return `"${customFont}", "SF Mono", "Menlo", "Monaco", "Consolas", monospace`;
    }
    return CODE_FONT_FAMILY_CSS.system;
  }
  return CODE_FONT_FAMILY_CSS[preset];
});

/**
 * Resolved CSS font-family string for the terminal.
 *
 * When the user has chosen a specific font preset it respects their choice
 * (same as the editor).  When they are on "System Default" the terminal uses
 * Menlo-first — matching Cursor's macOS terminal default — because Menlo
 * renders heavier and more legible in xterm's WebGL renderer than SF Mono.
 */
export const resolvedTerminalFontFamilyAtom = atom<string>((get) => {
  const preset = get(codeFontFamilyAtom);
  if (preset === "custom") {
    const customFont = get(customCodeFontFamilyAtom).trim();
    if (customFont) {
      return `"${customFont}", "Menlo", "Monaco", "Courier New", monospace`;
    }
    return 'Menlo, Monaco, "Courier New", monospace';
  }
  if (preset === "system") {
    return 'Menlo, Monaco, "Courier New", monospace';
  }
  return CODE_FONT_FAMILY_CSS[preset];
});

/**
 * Font size for the code editor (in pixels)
 * Range: 10-24px, default: 13px
 */
export type EditorFontSize = 10 | 11 | 12 | 13 | 14 | 15 | 16 | 18 | 20 | 24;

export const EDITOR_FONT_SIZES: { value: EditorFontSize; label: string }[] = [
  { value: 10, label: "10px" },
  { value: 11, label: "11px" },
  { value: 12, label: "12px" },
  { value: 13, label: "13px (default)" },
  { value: 14, label: "14px" },
  { value: 15, label: "15px" },
  { value: 16, label: "16px" },
  { value: 18, label: "18px" },
  { value: 20, label: "20px" },
  { value: 24, label: "24px" },
];

export const editorFontSizeAtom = atom(
  (get) => get(settingsAtom)["editor.fontSize"] as EditorFontSize,
  (_get, set, value: EditorFontSize) => {
    set(updateSettingAtom, { key: "editor.fontSize", value });
  }
);

/**
 * Tab size (number of spaces per tab)
 */
export type EditorTabSize = 2 | 4 | 8;

export const EDITOR_TAB_SIZES: { value: EditorTabSize; label: string }[] = [
  { value: 2, label: "2 spaces" },
  { value: 4, label: "4 spaces" },
  { value: 8, label: "8 spaces" },
];

export const editorTabSizeAtom = atom(
  (get) => get(settingsAtom)["editor.tabSize"] as EditorTabSize,
  (_get, set, value: EditorTabSize) => {
    set(updateSettingAtom, { key: "editor.tabSize", value });
  }
);

/**
 * Line height multiplier
 */
export type EditorLineHeight = 1.2 | 1.4 | 1.5 | 1.6 | 1.8 | 2.0;

export const EDITOR_LINE_HEIGHTS: { value: EditorLineHeight; label: string }[] =
  [
    { value: 1.2, label: "Compact (1.2)" },
    { value: 1.4, label: "Tight (1.4)" },
    { value: 1.5, label: "Normal (1.5)" },
    { value: 1.6, label: "Relaxed (1.6)" },
    { value: 1.8, label: "Loose (1.8)" },
    { value: 2.0, label: "Double (2.0)" },
  ];

export const editorLineHeightAtom = atom(
  (get) => get(settingsAtom)["editor.lineHeight"] as EditorLineHeight,
  (_get, set, value: EditorLineHeight) => {
    set(updateSettingAtom, { key: "editor.lineHeight", value });
  }
);

/**
 * Line numbers display mode
 * - on: Show absolute line numbers (default)
 * - off: Hide line numbers
 * - relative: Show relative line numbers (Vim-style)
 * - interval: Show line numbers every 10 lines
 */
export type EditorLineNumbers = "on" | "off" | "relative" | "interval";

export const EDITOR_LINE_NUMBERS: {
  value: EditorLineNumbers;
  label: string;
}[] = [
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
  { value: "relative", label: "Relative" },
  { value: "interval", label: "Interval (every 10)" },
];

export const editorLineNumbersAtom = atom(
  (get) => get(settingsAtom)["editor.lineNumbers"] as EditorLineNumbers,
  (_get, set, value: EditorLineNumbers) => {
    set(updateSettingAtom, { key: "editor.lineNumbers", value });
  }
);

/**
 * Enable word wrap (soft wrap long lines)
 */
export const editorWordWrapAtom = atom(
  (get) => get(settingsAtom)["editor.wordWrap"],
  (_get, set, value: boolean) => {
    set(updateSettingAtom, { key: "editor.wordWrap", value });
  }
);

/**
 * Automatically save edited files after typing stops
 */
export const editorAutoSaveAtom = atom(
  (get) => get(settingsAtom)["editor.autoSave"],
  (_get, set, value: boolean) => {
    set(updateSettingAtom, { key: "editor.autoSave", value });
  }
);

/**
 * Show minimap (code overview panel)
 */
export const editorShowMinimapAtom = atom(
  (get) => get(settingsAtom)["editor.showMinimap"],
  (_get, set, value: boolean) => {
    set(updateSettingAtom, { key: "editor.showMinimap", value });
  }
);

/**
 * Show indent guides (vertical lines for indentation)
 */
export const editorShowIndentGuidesAtom = atom(
  (get) => get(settingsAtom)["editor.showIndentGuides"],
  (_get, set, value: boolean) => {
    set(updateSettingAtom, { key: "editor.showIndentGuides", value });
  }
);

/**
 * Show tree indent guides (file tree, source control, etc.)
 */
export const editorShowTreeIndentGuidesAtom = atom(
  (get) => get(settingsAtom)["editor.showTreeIndentGuides"],
  (_get, set, value: boolean) => {
    set(updateSettingAtom, { key: "editor.showTreeIndentGuides", value });
  }
);

/**
 * Highlight active line
 */
export const editorHighlightActiveLineAtom = atom(
  (get) => get(settingsAtom)["editor.highlightActiveLine"],
  (_get, set, value: boolean) => {
    set(updateSettingAtom, { key: "editor.highlightActiveLine", value });
  }
);

/**
 * Show inline git blame annotation on the current cursor line
 * (GitLens-style: author, time, commit summary)
 */
export const editorShowBlameAtom = atom(
  (get) => get(settingsAtom)["editor.showBlame"],
  (_get, set, value: boolean) => {
    set(updateSettingAtom, { key: "editor.showBlame", value });
  }
);

// ============================================
// Terminal Settings
// ============================================

/**
 * Shell type selection
 */
export type ShellType = "repo" | "default" | "custom";

export const shellTypeAtom = atom(
  (get) => get(settingsAtom)["terminal.shellType"] as ShellType,
  (_get, set, value: ShellType) => {
    set(updateSettingAtom, { key: "terminal.shellType", value });
  }
);

/**
 * Custom shell path (when shellType is "custom")
 */
export const customShellPathAtom = atom(
  (get) => get(settingsAtom)["terminal.customShellPath"],
  (_get, set, value: string) => {
    set(updateSettingAtom, { key: "terminal.customShellPath", value });
  }
);

/**
 * Active settings tab
 */
export const editorSettingsTabAtom = atom<string>("terminal");

// ============================================
// Git Settings
// ============================================

/**
 * Git executable selection mode.
 * - auto: Prefer system Git when available, otherwise bundled Git
 * - system: Require Git from PATH
 * - bundled: Always use ORGII's bundled Git
 */
export type GitExecutableMode = "auto" | "system" | "bundled";

export const GIT_EXECUTABLE_MODES: {
  value: GitExecutableMode;
  labelKey: string;
}[] = [
  { value: "auto", labelKey: "editor.git.executableModeAuto" },
  { value: "system", labelKey: "editor.git.executableModeSystem" },
  { value: "bundled", labelKey: "editor.git.executableModeBundled" },
];

export const gitExecutableModeAtom = atom(
  (get) => get(settingsAtom)["git.executableMode"] as GitExecutableMode,
  (_get, set, value: GitExecutableMode) => {
    set(updateSettingAtom, { key: "git.executableMode", value });
  }
);

/**
 * Git pull strategy
 * - merge: Standard merge (preserves history)
 * - rebase: Rebase local commits on top of remote (linear history)
 * - ff-only: Fast-forward only (refuses if branches have diverged)
 */
export type GitPullStrategy = "merge" | "rebase" | "ff-only";

export const GIT_PULL_STRATEGIES: {
  value: GitPullStrategy;
  labelKey: string;
}[] = [
  { value: "rebase", labelKey: "editor.git.strategyRebase" },
  { value: "merge", labelKey: "editor.git.strategyMerge" },
  { value: "ff-only", labelKey: "editor.git.strategyFfOnly" },
];

export const gitPullStrategyAtom = atom(
  (get) => get(settingsAtom)["git.pullStrategy"] as GitPullStrategy,
  (_get, set, value: GitPullStrategy) => {
    set(updateSettingAtom, { key: "git.pullStrategy", value });
  }
);

export const gitAutoFetchAtom = atom(
  (get) => get(settingsAtom)["git.autoFetch"],
  (_get, set, value: boolean) => {
    set(updateSettingAtom, { key: "git.autoFetch", value });
  }
);

export const gitAutoFetchIntervalAtom = atom(
  (get) => get(settingsAtom)["git.autoFetchInterval"],
  (_get, set, value: number) => {
    set(updateSettingAtom, { key: "git.autoFetchInterval", value });
  }
);

/**
 * Maximum concurrent agent worktrees per repo (backed by settings.jsonc).
 * Range: 1–32, default: 8.
 */
export const gitWorktreeMaxCountAtom = atom(
  (get) => get(settingsAtom)["git.worktree.maxCount"] as number,
  (_get, set, value: number) => {
    set(updateSettingAtom, { key: "git.worktree.maxCount", value });
  }
);

export const gitWorktreeCleanupIntervalHoursAtom = atom(
  (get) => get(settingsAtom)["git.worktree.cleanupIntervalHours"] as number,
  (_get, set, value: number) => {
    set(updateSettingAtom, {
      key: "git.worktree.cleanupIntervalHours",
      value,
    });
  }
);

// ============================================
// Editor Theme Settings
// ============================================

/**
 * Available editor themes
 */
export type EditorTheme =
  | "system"
  | "github"
  | "vscode"
  | "monokai"
  | "solarized"
  | "abyss"
  | "tomorrowNightBlue";

export const EDITOR_THEMES: { value: EditorTheme; label: string }[] = [
  { value: "system", label: "Follow system" },
  { value: "github", label: "GitHub" },
  { value: "vscode", label: "VS Code" },
  { value: "monokai", label: "Monokai" },
  { value: "solarized", label: "Solarized" },
  { value: "abyss", label: "Abyss" },
  { value: "tomorrowNightBlue", label: "Tomorrow Night Blue" },
];

/**
 * Selected editor theme (persisted to localStorage)
 */
export const editorThemeAtom = atom(
  (get) => get(settingsAtom)["editor.theme"] as EditorTheme,
  (_get, set, value: EditorTheme) => {
    set(updateSettingAtom, { key: "editor.theme", value });
  }
);

export const resolvedEditorThemeAtom = atom<BaseEditorThemeId>((get) => {
  const selectedTheme = get(editorThemeAtom);
  if (selectedTheme !== "system") {
    return selectedTheme;
  }

  const globalThemeRaw = get(settingsAtom)["general.theme"];
  const globalTheme = getGlobalTheme(normalizeGlobalThemeId(globalThemeRaw));
  return globalTheme.editorTheme;
});
resolvedEditorThemeAtom.debugLabel = "resolvedEditorThemeAtom";
