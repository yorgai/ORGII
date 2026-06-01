export {
  GLOBAL_THEME_IDS,
  BASE_EDITOR_THEME_IDS,
  type GlobalThemeId,
  type BaseEditorThemeId,
  type ThemePrimaryColorPreset,
  type ThemeCssPath,
  type GlobalThemeDefinition,
} from "./globalThemes";

export {
  COLOR_PRIMARY_VARIABLE_KEYS,
  PRIMARY_COLOR_PALETTES,
  PRIMARY_COLOR_PRESETS,
  DEFAULT_PRIMARY_COLOR_PRESET,
  type ColorPrimaryVariableKey,
  type PrimaryColorPreset,
  type PrimaryPalette,
  type PrimaryColorSchema,
} from "./primaryColors";

export {
  PRIMARY_SCHEMA_BY_BACKGROUND_PAIR_ID,
  getPrimarySchemaForBackgroundPairId,
} from "./primaryColorSchemas";
