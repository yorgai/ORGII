export const GLOBAL_THEME_IDS = [
  "github-light",
  "github-dark",
  "orgii-high-contrast",
] as const;

export type GlobalThemeId = (typeof GLOBAL_THEME_IDS)[number];

export const APPEARANCE_MODE = {
  LIGHT: "light",
  DARK: "dark",
  HIGH_CONTRAST: "highContrast",
} as const;

export type AppearanceMode =
  (typeof APPEARANCE_MODE)[keyof typeof APPEARANCE_MODE];

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

export type ThemeCssPath =
  | "/orgii_main.css"
  | "/orgii_dark.css"
  | "/orgii_high_contrast.css";

export interface GlobalThemeDefinition {
  id: GlobalThemeId;
  i18nKey: string;
  baseCssPath: ThemeCssPath;
  isDark: boolean;
  defaultPrimaryColor: ThemePrimaryColorPreset;
}

const ORGII_LIGHT_THEME: GlobalThemeDefinition = {
  id: "github-light",
  i18nKey: "general.themeOptions.githubLight",
  baseCssPath: "/orgii_main.css",
  isDark: false,
  defaultPrimaryColor: "blue",
};

const ORGII_DARK_THEME: GlobalThemeDefinition = {
  id: "github-dark",
  i18nKey: "general.themeOptions.githubDark",
  baseCssPath: "/orgii_dark.css",
  isDark: true,
  defaultPrimaryColor: "blue",
};

const ORGII_HIGH_CONTRAST_THEME: GlobalThemeDefinition = {
  id: "orgii-high-contrast",
  i18nKey: "general.themeOptions.orgiiHighContrast",
  baseCssPath: "/orgii_high_contrast.css",
  isDark: true,
  defaultPrimaryColor: "blue",
};

export const GLOBAL_THEMES: Record<GlobalThemeId, GlobalThemeDefinition> = {
  "github-light": ORGII_LIGHT_THEME,
  "github-dark": ORGII_DARK_THEME,
  "orgii-high-contrast": ORGII_HIGH_CONTRAST_THEME,
};

export const LEGACY_THEME_ALIASES = {
  light: "github-light",
  dark: "github-dark",
  "/orgii_main.css": "github-light",
  "/orgii_dark.css": "github-dark",
  "/orgii_high_contrast.css": "orgii-high-contrast",
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

export function isThemeCssPathDark(
  themePath: string | null | undefined
): boolean {
  return getGlobalTheme(themePath).isDark;
}

export const GLOBAL_THEME_GROUPS: Record<AppearanceMode, GlobalThemeId[]> = {
  [APPEARANCE_MODE.LIGHT]: ["github-light"],
  [APPEARANCE_MODE.DARK]: ["github-dark"],
  [APPEARANCE_MODE.HIGH_CONTRAST]: ["orgii-high-contrast"],
};

export function getAppearanceModeForTheme(
  themeId: string | null | undefined
): AppearanceMode {
  const normalizedThemeId = normalizeGlobalThemeId(themeId);
  if (normalizedThemeId === "orgii-high-contrast") {
    return APPEARANCE_MODE.HIGH_CONTRAST;
  }
  return GLOBAL_THEMES[normalizedThemeId].isDark
    ? APPEARANCE_MODE.DARK
    : APPEARANCE_MODE.LIGHT;
}

export function normalizeAppearanceMode(value: string): AppearanceMode {
  if (value === APPEARANCE_MODE.DARK) return APPEARANCE_MODE.DARK;
  if (value === APPEARANCE_MODE.HIGH_CONTRAST) {
    return APPEARANCE_MODE.HIGH_CONTRAST;
  }
  return APPEARANCE_MODE.LIGHT;
}

export function getDefaultThemeForAppearanceMode(
  mode: AppearanceMode
): GlobalThemeId {
  return GLOBAL_THEME_GROUPS[mode][0];
}

export function getThemeOptionsForAppearanceMode(
  mode: AppearanceMode
): GlobalThemeId[] {
  return GLOBAL_THEME_GROUPS[mode];
}

export const APPEARANCE_MODE_OPTIONS = [
  APPEARANCE_MODE.LIGHT,
  APPEARANCE_MODE.DARK,
  APPEARANCE_MODE.HIGH_CONTRAST,
] as const;
