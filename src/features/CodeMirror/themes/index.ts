/**
 * CodeMirror Themes
 *
 * Local theme definitions integrated with the token system.
 * Syntax colors are defined in _editor-tokens.scss as CSS variables.
 *
 * Available themes:
 *   - GitHub (light + dark) - Default, integrated with CSS variable tokens
 *   - VS Code (light + dark) - Based on VS Code's Dark+ and Light+ themes
 *   - Monokai (light + dark) - Classic Monokai color scheme
 *   - Solarized (light + dark) - Ethan Schoonover's Solarized
 *   - Abyss (dark only) - Deep blue dark theme
 *   - Tomorrow Night Blue (dark only) - Pastel colors on deep blue
 *
 * Usage:
 *   - Use createGithubTheme(isDark) for dynamic theming (reads CSS vars)
 *   - Use static themes (githubLight, vscodeDark, monokai, etc.) for performance
 */

// GitHub Theme (light + dark) - integrated with CSS tokens
export {
  createGithubTheme,
  githubLight,
  githubDark,
  githubLightInit,
  githubDarkInit,
  githubLightStyle,
  githubDarkStyle,
  defaultSettingsGithubLight,
  defaultSettingsGithubDark,
} from "./github";

// VS Code Theme (light + dark)
export {
  vscodeDark,
  vscodeLight,
  vscodeDarkInit,
  vscodeLightInit,
  vscodeDarkStyle,
  vscodeLightStyle,
  defaultSettingsVSCodeDark,
  defaultSettingsVSCodeLight,
} from "./vscode";

// Monokai Theme (light + dark)
export {
  monokai,
  monokaiDark,
  monokaiLight,
  monokaiInit,
  monokaiDarkInit,
  monokaiLightInit,
  monokaiStyle,
  monokaiDarkStyle,
  monokaiLightStyle,
  defaultSettingsMonokai,
  defaultSettingsMonokaiDark,
  defaultSettingsMonokaiLight,
} from "./monokai";

// Solarized Theme (light + dark)
export {
  solarizedDark,
  solarizedLight,
  solarizedDarkInit,
  solarizedLightInit,
  solarizedDarkStyle,
  solarizedLightStyle,
  defaultSettingsSolarizedDark,
  defaultSettingsSolarizedLight,
} from "./solarized";

// Abyss Theme (dark only)
export { abyss, abyssInit, abyssStyle, defaultSettingsAbyss } from "./abyss";

// Tomorrow Night Blue Theme (dark only)
export {
  tomorrowNightBlue,
  tomorrowNightBlueInit,
  tomorrowNightBlueStyle,
  defaultSettingsTomorrowNightBlue,
} from "./tomorrowNightBlue";
