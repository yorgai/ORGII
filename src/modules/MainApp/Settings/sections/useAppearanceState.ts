import { useAtom } from "jotai";
import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";

import Message from "@src/components/Message";
import { APPLICATION_UI_FONT_IDS } from "@src/config/appearance/applicationUiFonts";
import {
  APPEARANCE_MODE_OPTIONS,
  GLOBAL_THEMES,
  getAppearanceModeForTheme,
  getDefaultThemeForAppearanceMode,
  getGlobalTheme,
  getThemeOptionsForAppearanceMode,
  normalizeAppearanceMode,
  normalizeGlobalThemeId,
} from "@src/config/appearance/globalThemes";
import { PRIMARY_COLOR_PRESETS } from "@src/config/appearance/primaryColors";
import {
  UI_SCALE_CONFIG,
  applicationUiFontAtom,
  globalLayoutMethodAtom,
  globalThemeIdAtom,
  primaryColorPresetAtom,
  uiScaleAtom,
} from "@src/store";
import { preloadThemeCss, swapThemeCss } from "@src/util/ui/theme/swapThemeCss";
import { showThemeTransitionCover } from "@src/util/ui/theme/themeTransitionCover";

const getApproxFontSize = (scale: number): string => {
  const baseFontSize = 14;
  const scaledSize = Math.round((baseFontSize * scale) / 100);
  return `${scaledSize}px`;
};

export const UI_SCALE_OPTIONS: number[] = [];
for (
  let scaleValue = UI_SCALE_CONFIG.MIN;
  scaleValue <= UI_SCALE_CONFIG.MAX;
  scaleValue += UI_SCALE_CONFIG.STEP
) {
  UI_SCALE_OPTIONS.push(scaleValue);
}

export function useAppearanceState() {
  const { t } = useTranslation("settings");

  const [globalThemeId, setGlobalThemeId] = useAtom(globalThemeIdAtom);
  const [primaryColorPreset, setPrimaryColorPreset] = useAtom(
    primaryColorPresetAtom
  );
  const [uiScale, setUIScale] = useAtom(uiScaleAtom);
  const [applicationUiFont, setApplicationUiFont] = useAtom(
    applicationUiFontAtom
  );
  const [globalLayoutMethod, setGlobalLayoutMethod] = useAtom(
    globalLayoutMethodAtom
  );

  // Warm the browser's stylesheet cache for every theme variant the moment
  // the user lands on the appearance page. The actual swap on click then
  // hits cached bytes and applies on the same frame as the JS atom flip,
  // so Tailwind / CSS-variable surfaces stop visibly trailing the
  // background and other JS-driven layers during a theme switch.
  useEffect(() => {
    const uniquePaths = Array.from(
      new Set(Object.values(GLOBAL_THEMES).map((theme) => theme.baseCssPath))
    );
    preloadThemeCss(uniquePaths);
  }, []);

  const appearanceMode = useMemo(
    () => getAppearanceModeForTheme(globalThemeId),
    [globalThemeId]
  );

  const handleThemeChange = useCallback(
    async (themeIdValue: string) => {
      const themeId = normalizeGlobalThemeId(themeIdValue);
      const selectedTheme = getGlobalTheme(themeId);
      const cover = showThemeTransitionCover();
      try {
        await swapThemeCss(selectedTheme.baseCssPath);
        setGlobalThemeId(themeId);
        setPrimaryColorPreset(selectedTheme.defaultPrimaryColor);
        localStorage.setItem("theme", themeId);
      } finally {
        await cover.hide();
      }
    },
    [setGlobalThemeId, setPrimaryColorPreset]
  );

  const handleAppearanceModeChange = useCallback(
    async (value: string | number | (string | number)[]) => {
      const rawMode = String(Array.isArray(value) ? value[0] : value);
      const selectedMode = normalizeAppearanceMode(rawMode);
      await handleThemeChange(getDefaultThemeForAppearanceMode(selectedMode));
    },
    [handleThemeChange]
  );

  const handleUIScaleChange = useCallback(
    (value: string) => {
      const scale = parseInt(value, 10);
      setUIScale(scale);
      const fontSize = getApproxFontSize(scale);
      Message.info({
        id: "ui-scale-message",
        content: `UI scale: ${scale}% · Font: ${fontSize}`,
        duration: 1500,
      });
    },
    [setUIScale]
  );

  const appearanceModeOptions = useMemo(
    () =>
      APPEARANCE_MODE_OPTIONS.map((mode) => ({
        label: t(`general.${mode}`),
        value: mode,
      })),
    [t]
  );

  const primaryColorOptions = useMemo(
    () =>
      PRIMARY_COLOR_PRESETS.map((preset) => ({
        label: t(`general.primaryColorOptions.${preset}`),
        value: preset,
      })),
    [t]
  );

  const applicationUiFontOptions = useMemo(
    () =>
      APPLICATION_UI_FONT_IDS.map((fontId) => ({
        label: t(`general.applicationFontOptions.${fontId}`),
        value: fontId,
      })),
    [t]
  );

  const themeOptions = useMemo(
    () =>
      getThemeOptionsForAppearanceMode(appearanceMode).map((themeId) => ({
        label: t(GLOBAL_THEMES[themeId].i18nKey),
        value: themeId,
      })),
    [appearanceMode, t]
  );

  return {
    globalThemeId,
    primaryColorPreset,
    setPrimaryColorPreset,
    uiScale,
    applicationUiFont,
    setApplicationUiFont,
    globalLayoutMethod,
    setGlobalLayoutMethod,
    appearanceMode,
    appearanceModeOptions,
    themeOptions,
    primaryColorOptions,
    applicationUiFontOptions,
    handleThemeChange,
    handleAppearanceModeChange,
    handleUIScaleChange,
    getApproxFontSize,
  };
}
