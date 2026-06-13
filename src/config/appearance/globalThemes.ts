export const GLOBAL_THEME_IDS = [
  "github-light",
  "github-dark",
  "orgii-high-contrast",
] as const;

export type GlobalThemeId = (typeof GLOBAL_THEME_IDS)[number];

export const THEME_PREFERENCE = {
  SYSTEM: "system",
} as const;

export const GLOBAL_THEME_PREFERENCES = [
  THEME_PREFERENCE.SYSTEM,
  ...GLOBAL_THEME_IDS,
] as const;

export type GlobalThemePreference = (typeof GLOBAL_THEME_PREFERENCES)[number];

export type SystemColorScheme = "light" | "dark";

export const APPEARANCE_MODE = {
  SYSTEM: "system",
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
export const DEFAULT_GLOBAL_THEME_PREFERENCE: GlobalThemePreference =
  THEME_PREFERENCE.SYSTEM;

export function isGlobalThemeId(value: string): value is GlobalThemeId {
  return value in GLOBAL_THEMES;
}

export function isGlobalThemePreference(
  value: string
): value is GlobalThemePreference {
  return value === THEME_PREFERENCE.SYSTEM || isGlobalThemeId(value);
}

export function getSystemColorScheme(): SystemColorScheme {
  if (typeof window === "undefined") return APPEARANCE_MODE.LIGHT;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? APPEARANCE_MODE.DARK
    : APPEARANCE_MODE.LIGHT;
}

export function getSystemThemeId(): GlobalThemeId {
  return getSystemColorScheme() === APPEARANCE_MODE.DARK
    ? "github-dark"
    : "github-light";
}

export function getSystemThemeEnglishLabel(
  colorScheme: SystemColorScheme = getSystemColorScheme()
): "Light" | "Dark" {
  return colorScheme === APPEARANCE_MODE.DARK ? "Dark" : "Light";
}

export function getFollowSystemThemeLabel(
  colorScheme: SystemColorScheme = getSystemColorScheme(),
  followSystemLabel = "Follow system"
): string {
  return `${followSystemLabel} (${getSystemThemeEnglishLabel(colorScheme)})`;
}

export function normalizeGlobalThemeId(
  value: string | null | undefined
): GlobalThemeId {
  if (!value) return DEFAULT_GLOBAL_THEME_ID;
  if (value === THEME_PREFERENCE.SYSTEM) return getSystemThemeId();
  if (isGlobalThemeId(value)) return value;
  return (
    LEGACY_THEME_ALIASES[value as keyof typeof LEGACY_THEME_ALIASES] ??
    DEFAULT_GLOBAL_THEME_ID
  );
}

export function normalizeGlobalThemePreference(
  value: string | null | undefined
): GlobalThemePreference {
  if (!value) return DEFAULT_GLOBAL_THEME_PREFERENCE;
  if (isGlobalThemePreference(value)) return value;
  return (
    LEGACY_THEME_ALIASES[value as keyof typeof LEGACY_THEME_ALIASES] ??
    DEFAULT_GLOBAL_THEME_PREFERENCE
  );
}

export function resolveGlobalThemePreference(
  preference: string | null | undefined
): GlobalThemeId {
  const normalizedPreference = normalizeGlobalThemePreference(preference);
  return normalizedPreference === THEME_PREFERENCE.SYSTEM
    ? getSystemThemeId()
    : normalizedPreference;
}

export function getGlobalTheme(
  themeId: string | null | undefined
): GlobalThemeDefinition {
  return GLOBAL_THEMES[resolveGlobalThemePreference(themeId)];
}

export function isThemeCssPathDark(
  themePath: string | null | undefined
): boolean {
  return getGlobalTheme(themePath).isDark;
}

export const GLOBAL_THEME_GROUPS: Record<
  Exclude<AppearanceMode, typeof APPEARANCE_MODE.SYSTEM>,
  GlobalThemeId[]
> = {
  [APPEARANCE_MODE.LIGHT]: ["github-light"],
  [APPEARANCE_MODE.DARK]: ["github-dark"],
  [APPEARANCE_MODE.HIGH_CONTRAST]: ["orgii-high-contrast"],
};

export function getAppearanceModeForTheme(
  themeId: string | null | undefined
): AppearanceMode {
  const normalizedPreference = normalizeGlobalThemePreference(themeId);
  if (normalizedPreference === THEME_PREFERENCE.SYSTEM) {
    return APPEARANCE_MODE.SYSTEM;
  }
  if (normalizedPreference === "orgii-high-contrast") {
    return APPEARANCE_MODE.HIGH_CONTRAST;
  }
  return GLOBAL_THEMES[normalizedPreference].isDark
    ? APPEARANCE_MODE.DARK
    : APPEARANCE_MODE.LIGHT;
}

export function normalizeAppearanceMode(value: string): AppearanceMode {
  if (value === APPEARANCE_MODE.SYSTEM) return APPEARANCE_MODE.SYSTEM;
  if (value === APPEARANCE_MODE.DARK) return APPEARANCE_MODE.DARK;
  if (value === APPEARANCE_MODE.HIGH_CONTRAST) {
    return APPEARANCE_MODE.HIGH_CONTRAST;
  }
  return APPEARANCE_MODE.LIGHT;
}

export function getDefaultThemePreferenceForAppearanceMode(
  mode: AppearanceMode
): GlobalThemePreference {
  if (mode === APPEARANCE_MODE.SYSTEM) return THEME_PREFERENCE.SYSTEM;
  return GLOBAL_THEME_GROUPS[mode][0];
}

export function getDefaultThemeForAppearanceMode(
  mode: Exclude<AppearanceMode, typeof APPEARANCE_MODE.SYSTEM>
): GlobalThemeId {
  return GLOBAL_THEME_GROUPS[mode][0];
}

export function getThemeOptionsForAppearanceMode(
  mode: AppearanceMode
): GlobalThemePreference[] {
  if (mode === APPEARANCE_MODE.SYSTEM) {
    return [THEME_PREFERENCE.SYSTEM];
  }
  return GLOBAL_THEME_GROUPS[mode];
}

export const APPEARANCE_MODE_OPTIONS = [
  APPEARANCE_MODE.SYSTEM,
  APPEARANCE_MODE.LIGHT,
  APPEARANCE_MODE.DARK,
  APPEARANCE_MODE.HIGH_CONTRAST,
] as const;
