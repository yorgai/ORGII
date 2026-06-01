export const GLOBAL_THEME_IDS = [
  "github-light",
  "github-dark",
  "vscode-light",
  "vscode-dark",
  "monokai-light",
  "monokai-dark",
  "solarized-light",
  "solarized-dark",
  "abyss",
  "tomorrowNightBlue",
] as const;

export type GlobalThemeId = (typeof GLOBAL_THEME_IDS)[number];

export const BASE_EDITOR_THEME_IDS = [
  "github",
  "vscode",
  "monokai",
  "solarized",
  "abyss",
  "tomorrowNightBlue",
] as const;

export type BaseEditorThemeId = (typeof BASE_EDITOR_THEME_IDS)[number];
export type ThemePrimaryColorPreset =
  | "blue"
  | "violet"
  | "green"
  | "teal"
  | "orange"
  | "gold"
  | "red"
  | "rose"
  | "mono";

export type ThemeCssPath = "/orgii_main.css" | "/orgii_dark.css";

export interface GlobalThemeDefinition {
  id: GlobalThemeId;
  i18nKey: string;
  baseCssPath: ThemeCssPath;
  isDark: boolean;
  editorTheme: BaseEditorThemeId;
  defaultPrimaryColor: ThemePrimaryColorPreset;
}

const GITHUB_LIGHT_THEME: GlobalThemeDefinition = {
  id: "github-light",
  i18nKey: "general.themeOptions.githubLight",
  baseCssPath: "/orgii_main.css",
  isDark: false,
  editorTheme: "github",
  defaultPrimaryColor: "blue",
};

const GITHUB_DARK_THEME: GlobalThemeDefinition = {
  id: "github-dark",
  i18nKey: "general.themeOptions.githubDark",
  baseCssPath: "/orgii_dark.css",
  isDark: true,
  editorTheme: "github",
  defaultPrimaryColor: "blue",
};

const VSCODE_LIGHT_THEME: GlobalThemeDefinition = {
  id: "vscode-light",
  i18nKey: "general.themeOptions.vscodeLight",
  baseCssPath: "/orgii_main.css",
  isDark: false,
  editorTheme: "vscode",
  defaultPrimaryColor: "blue",
};

const VSCODE_DARK_THEME: GlobalThemeDefinition = {
  id: "vscode-dark",
  i18nKey: "general.themeOptions.vscodeDark",
  baseCssPath: "/orgii_dark.css",
  isDark: true,
  editorTheme: "vscode",
  defaultPrimaryColor: "blue",
};

const MONOKAI_LIGHT_THEME: GlobalThemeDefinition = {
  id: "monokai-light",
  i18nKey: "general.themeOptions.monokaiLight",
  baseCssPath: "/orgii_main.css",
  isDark: false,
  editorTheme: "monokai",
  defaultPrimaryColor: "orange",
};

const MONOKAI_DARK_THEME: GlobalThemeDefinition = {
  id: "monokai-dark",
  i18nKey: "general.themeOptions.monokaiDark",
  baseCssPath: "/orgii_dark.css",
  isDark: true,
  editorTheme: "monokai",
  defaultPrimaryColor: "orange",
};

const SOLARIZED_LIGHT_THEME: GlobalThemeDefinition = {
  id: "solarized-light",
  i18nKey: "general.themeOptions.solarizedLight",
  baseCssPath: "/orgii_main.css",
  isDark: false,
  editorTheme: "solarized",
  defaultPrimaryColor: "green",
};

const SOLARIZED_DARK_THEME: GlobalThemeDefinition = {
  id: "solarized-dark",
  i18nKey: "general.themeOptions.solarizedDark",
  baseCssPath: "/orgii_dark.css",
  isDark: true,
  editorTheme: "solarized",
  defaultPrimaryColor: "green",
};

const ABYSS_THEME: GlobalThemeDefinition = {
  id: "abyss",
  i18nKey: "general.themeOptions.abyss",
  baseCssPath: "/orgii_dark.css",
  isDark: true,
  editorTheme: "abyss",
  defaultPrimaryColor: "violet",
};

const TOMORROW_NIGHT_BLUE_THEME: GlobalThemeDefinition = {
  id: "tomorrowNightBlue",
  i18nKey: "general.themeOptions.tomorrowNightBlue",
  baseCssPath: "/orgii_dark.css",
  isDark: true,
  editorTheme: "tomorrowNightBlue",
  defaultPrimaryColor: "violet",
};

export const GLOBAL_THEMES: Record<GlobalThemeId, GlobalThemeDefinition> = {
  "github-light": GITHUB_LIGHT_THEME,
  "github-dark": GITHUB_DARK_THEME,
  "vscode-light": VSCODE_LIGHT_THEME,
  "vscode-dark": VSCODE_DARK_THEME,
  "monokai-light": MONOKAI_LIGHT_THEME,
  "monokai-dark": MONOKAI_DARK_THEME,
  "solarized-light": SOLARIZED_LIGHT_THEME,
  "solarized-dark": SOLARIZED_DARK_THEME,
  abyss: ABYSS_THEME,
  tomorrowNightBlue: TOMORROW_NIGHT_BLUE_THEME,
};

export const LEGACY_THEME_ALIASES = {
  light: "github-light",
  dark: "github-dark",
  "/orgii_main.css": "github-light",
  "/orgii_dark.css": "github-dark",
} as const;

export const DEFAULT_GLOBAL_THEME_ID: GlobalThemeId = "github-light";

export function isGlobalThemeId(value: string): value is GlobalThemeId {
  return value in GLOBAL_THEMES;
}

export function normalizeGlobalThemeId(
  value: string | null | undefined
): GlobalThemeId {
  if (!value) return DEFAULT_GLOBAL_THEME_ID;
  if (isGlobalThemeId(value)) return value;
  return (
    LEGACY_THEME_ALIASES[value as keyof typeof LEGACY_THEME_ALIASES] ??
    DEFAULT_GLOBAL_THEME_ID
  );
}

export function getGlobalTheme(
  themeId: string | null | undefined
): GlobalThemeDefinition {
  return GLOBAL_THEMES[normalizeGlobalThemeId(themeId)];
}

export const GLOBAL_THEME_GROUPS = {
  light: GLOBAL_THEME_IDS.filter((id) => !GLOBAL_THEMES[id].isDark),
  dark: GLOBAL_THEME_IDS.filter((id) => GLOBAL_THEMES[id].isDark),
} as const;
