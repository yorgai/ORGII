import { useAtom } from "jotai";
import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";

import Message from "@src/components/Message";
import { APPLICATION_UI_FONT_IDS } from "@src/config/appearance/applicationUiFonts";
import {
  GLOBAL_THEMES,
  GLOBAL_THEME_GROUPS,
  type GlobalThemeId,
  getGlobalTheme,
  isGlobalThemeId,
  normalizeGlobalThemeId,
} from "@src/config/appearance/globalThemes";
import { PRIMARY_COLOR_PRESETS } from "@src/config/appearance/primaryColors";
import {
  UI_SCALE_CONFIG,
  applicationUiFontAtom,
  autoHideTabBarAtom,
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
  const [autoHideTabBar, setAutoHideTabBar] = useAtom(autoHideTabBarAtom);
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
    () => (GLOBAL_THEMES[globalThemeId].isDark ? "dark" : "light"),
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
      const selectedMode = String(value) === "dark" ? "dark" : "light";
      const currentThemeId = normalizeGlobalThemeId(globalThemeId);

      const getVariantThemeId = (
        id: GlobalThemeId,
        mode: "light" | "dark"
      ): GlobalThemeId | null => {
        if (id.endsWith("-light") || id.endsWith("-dark")) {
          const variantId = id.replace(/-(light|dark)$/, `-${mode}`);
          if (isGlobalThemeId(variantId)) {
            return variantId;
          }
        }
        return null;
      };

      const matchedVariant = getVariantThemeId(currentThemeId, selectedMode);
      if (matchedVariant) {
        await handleThemeChange(matchedVariant);
        return;
      }

      const fallbackThemeId =
        selectedMode === "dark"
          ? GLOBAL_THEME_GROUPS.dark[0]
          : GLOBAL_THEME_GROUPS.light[0];
      await handleThemeChange(fallbackThemeId);
    },
    [globalThemeId, handleThemeChange]
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

  const themeOptions = useMemo(() => {
    const options =
      appearanceMode === "dark"
        ? GLOBAL_THEME_GROUPS.dark
        : GLOBAL_THEME_GROUPS.light;
    return options.map((themeId) => ({
      label: t(GLOBAL_THEMES[themeId].i18nKey),
      value: themeId,
    }));
  }, [appearanceMode, t]);

  return {
    globalThemeId,
    primaryColorPreset,
    setPrimaryColorPreset,
    uiScale,
    applicationUiFont,
    setApplicationUiFont,
    autoHideTabBar,
    setAutoHideTabBar,
    globalLayoutMethod,
    setGlobalLayoutMethod,
    appearanceMode,
    themeOptions,
    primaryColorOptions,
    applicationUiFontOptions,
    handleThemeChange,
    handleAppearanceModeChange,
    handleUIScaleChange,
    getApproxFontSize,
  };
}
