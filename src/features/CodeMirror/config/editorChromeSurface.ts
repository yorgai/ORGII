/**
 * Editor canvas colors for the active CodeMirror theme.
 *
 * Same default chrome values as static themes in getCodeMirrorTheme (themeConfig).
 * Drives --cm-editor-background on documentElement so Workstation tabs/file bars and
 * createGithubTheme(dynamic) stay aligned with the editor.
 */
import type { BaseEditorThemeId } from "@src/config/appearance/globalThemes";

import { defaultSettingsAbyss } from "../themes/abyss";
import {
  defaultSettingsGithubDark,
  defaultSettingsGithubLight,
} from "../themes/github";
import {
  defaultSettingsMonokaiDark,
  defaultSettingsMonokaiLight,
} from "../themes/monokai";
import {
  defaultSettingsSolarizedDark,
  defaultSettingsSolarizedLight,
} from "../themes/solarized";
import { defaultSettingsTomorrowNightBlue } from "../themes/tomorrowNightBlue";
import {
  defaultSettingsVSCodeDark,
  defaultSettingsVSCodeLight,
} from "../themes/vscode";

export interface EditorChromeSurface {
  background: string;
  gutterBackground: string;
}

function pickChrome(settings: EditorChromeSurface): EditorChromeSurface {
  return {
    background: settings.background,
    gutterBackground: settings.gutterBackground,
  };
}

export function getEditorChromeSurface(
  isDark: boolean,
  themeName: BaseEditorThemeId
): EditorChromeSurface {
  switch (themeName) {
    case "vscode":
      return pickChrome(
        isDark ? defaultSettingsVSCodeDark : defaultSettingsVSCodeLight
      );
    case "monokai":
      return pickChrome(
        isDark ? defaultSettingsMonokaiDark : defaultSettingsMonokaiLight
      );
    case "solarized":
      return pickChrome(
        isDark ? defaultSettingsSolarizedDark : defaultSettingsSolarizedLight
      );
    case "abyss":
      return pickChrome(
        isDark ? defaultSettingsAbyss : defaultSettingsGithubLight
      );
    case "tomorrowNightBlue":
      return pickChrome(
        isDark ? defaultSettingsTomorrowNightBlue : defaultSettingsGithubLight
      );
    case "github":
      return pickChrome(
        isDark ? defaultSettingsGithubDark : defaultSettingsGithubLight
      );
  }
}
