/**
 * useBackgroundSettings Hook
 * Handles all business logic for background customization.
 * Image upload/delete logic lives in useBackgroundImageHandlers.ts.
 */
import { useAtom } from "jotai";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import Message from "@src/components/Message";
import {
  GLOBAL_THEMES,
  GLOBAL_THEME_GROUPS,
  type GlobalThemeId,
  getGlobalTheme,
  isGlobalThemeId,
  normalizeGlobalThemeId,
} from "@src/config/appearance/globalThemes";
import type { PrimaryColorPreset } from "@src/config/appearance/primaryColors";
import { buildSettingsPath } from "@src/config/mainAppPaths";
import { useBackgroundImageStorage } from "@src/hooks/theme/useBackgroundImageStorage";
import { useUndoStackWithRestore } from "@src/hooks/ui";
import {
  backgroundConfigPersistAtom,
  globalThemeIdAtom,
  primaryColorPresetAtom,
} from "@src/store";
import type { BackgroundConfig } from "@src/store/ui/backgroundConfigAtom";
import { getStorageInfo } from "@src/util/core/storage/backgroundImage";
import { setLiquidGlassThickness } from "@src/util/platform/ipcRenderer";
import { prewarmColorPair } from "@src/util/ui/theme/glassMaterial";
import { preloadThemeCss, swapThemeCss } from "@src/util/ui/theme/swapThemeCss";
import { showThemeTransitionCover } from "@src/util/ui/theme/themeTransitionCover";

import {
  MAX_CUSTOM_BACKGROUND_COLORS,
  PRESET_COLORS,
  getColorPairById,
  resolveColorPair,
} from "../config";
import type { MatrixCharSet, StorageInfo } from "../types";
import { normalizeHexColor } from "../utils";
import { useBackgroundImageHandlers } from "./useBackgroundImageHandlers";

export interface UseBackgroundSettingsReturn {
  // State
  config: BackgroundConfig;
  globalThemeId: string;
  isDarkTheme: boolean;
  appearanceMode: "light" | "dark";
  themeOptions: { labelKey: string; value: string }[];
  isOptimizing: boolean;
  images: Map<string, string>;
  storageInfo: StorageInfo;

  // Handlers
  handleBack: () => void;
  handleImageSelect: (imageUrl: string, imageId?: string) => void;
  handleColorSelect: (pairId: string) => void;
  handleAnimationSelect: (animationId: string) => void;
  handleAnimationClear: () => void;
  handleSelectCustomPaletteHex: (hex: string) => void;
  handleAddCustomPaletteHex: (hex: string) => void;
  handleRemoveCustomPaletteHex: (hex: string, event: React.MouseEvent) => void;
  handleBlurChange: (val: number | number[]) => void;
  handleUpload: (file: File) => Promise<boolean>;
  handleDeleteCustomImage: (
    event: React.MouseEvent,
    imageId: string
  ) => Promise<void>;
  handleAppearanceModeChange: (
    value: string | number | (string | number)[]
  ) => void;
  handleThemePresetChange: (
    value: string | number | (string | number)[]
  ) => void;
  handleMatrixCharSetChange: (charSet: MatrixCharSet) => void;
}

export function useBackgroundSettings(): UseBackgroundSettingsReturn {
  const navigate = useNavigate();
  const { t } = useTranslation("settings");
  const [config, setConfig] = useAtom(backgroundConfigPersistAtom);
  const [globalThemeId, setGlobalThemeId] = useAtom(globalThemeIdAtom);
  const [, setPrimaryColorPreset] = useAtom(primaryColorPresetAtom);
  const [storageInfo, setStorageInfo] = useState<StorageInfo>({
    path: "",
    used: 0,
    limit: 5 * 1024 * 1024,
  });
  const { images, saveImage, removeImage, migrateImages } =
    useBackgroundImageStorage();

  // Determine if dark theme is active
  const isDarkTheme = getGlobalTheme(globalThemeId).isDark;
  const appearanceMode = isDarkTheme ? "dark" : "light";

  const themeOptions = useMemo(() => {
    const ids =
      appearanceMode === "dark"
        ? GLOBAL_THEME_GROUPS.dark
        : GLOBAL_THEME_GROUPS.light;
    return ids.map((themeId) => ({
      labelKey: GLOBAL_THEMES[themeId].i18nKey,
      value: themeId,
    }));
  }, [appearanceMode]);

  // Load storage info
  useEffect(() => {
    let cancelled = false;

    const loadStorageInfo = async () => {
      try {
        const info = await getStorageInfo();
        if (!cancelled) {
          setStorageInfo({
            path: info.path,
            used: info.used,
            limit: info.quota,
          });
        }
      } catch (error) {
        console.error("Failed to load storage info:", error);
      }
    };

    loadStorageInfo();

    return () => {
      cancelled = true;
    };
  }, [config.customImages]);

  // Cleanup and migrate old storage format on mount
  useEffect(() => {
    const cleanupAndMigrate = async () => {
      let needsUpdate = false;
      const updatedConfig = { ...config };

      // Clean up base64 dataUrl in imageUrl field
      if (config.imageUrl && config.imageUrl.startsWith("data:")) {
        updatedConfig.imageUrl = "";
        needsUpdate = true;
      }

      // Filter out any base64 images from customImages array
      const oldBase64Images = (config.customImages || []).filter(
        (img: string) => typeof img === "string" && img.startsWith("data:")
      );

      if (oldBase64Images.length > 0) {
        try {
          const newImageIds = await migrateImages(oldBase64Images);
          updatedConfig.customImages = [
            ...(config.customImages || []).filter(
              (img: string) => !img.startsWith("data:")
            ),
            ...newImageIds,
          ];

          if (config.imageUrl && oldBase64Images.includes(config.imageUrl)) {
            const index = oldBase64Images.indexOf(config.imageUrl);
            updatedConfig.imageUrl = "";
            updatedConfig.selectedImageId = newImageIds[index];
          }

          needsUpdate = true;
        } catch (error) {
          console.error("[BackgroundPage] Migration failed:", error);
          updatedConfig.customImages = (config.customImages || []).filter(
            (img: string) => !img.startsWith("data:")
          );
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        setConfig(updatedConfig);
      }
    };

    cleanupAndMigrate();
  }, [config, migrateImages, setConfig]);

  // Sync the Rust tint to whatever level the stored config has.
  // setLiquidGlassThickness is idempotent, so re-firing on changes is fine.
  useEffect(() => {
    if (config.liquidGlass) {
      setLiquidGlassThickness(config.liquidGlass);
    }
  }, [config.liquidGlass]);

  // Warm the browser's stylesheet cache for every theme variant the moment
  // the user lands on the background page. The actual swap on click then
  // hits cached bytes and applies on the same frame as the JS atom flip,
  // so Tailwind / CSS-variable surfaces stop visibly trailing the
  // background and other JS-driven layers during a theme switch.
  useEffect(() => {
    const uniquePaths = Array.from(
      new Set(Object.values(GLOBAL_THEMES).map((theme) => theme.baseCssPath))
    );
    preloadThemeCss(uniquePaths);
  }, []);

  // Prewarm the glass-material cache for both sides of the active color
  // pair so flipping the appearance mode is instantaneous (no async sampling
  // or per-component microtask hop). The color path is fully synchronous,
  // so this finishes within a single tick.
  //
  // Note: we deliberately do NOT mirror the resolved hex back into
  // `config.backgroundColor` here — `resolvedBackgroundConfigAtom` already
  // derives that reactively for every renderer, and writing it back would
  // cause an extra `localStorage` round-trip on every theme flip.
  useEffect(() => {
    if (!config.backgroundColorId) return;
    const pair = getColorPairById(config.backgroundColorId);
    if (!pair) return;
    prewarmColorPair(pair.light, pair.dark);
  }, [config.backgroundColorId]);

  // Undo/redo for config changes (Ctrl+Z / Cmd+Z)
  const undoStack = useUndoStackWithRestore<BackgroundConfig>({
    keyboardShortcut: true,
    currentValue: config,
    onRestore: (prev) => setConfig(prev),
  });

  const setConfigWithUndo = useCallback(
    (next: BackgroundConfig) => {
      undoStack.snapshot(config);
      setConfig(next);
    },
    [config, setConfig, undoStack]
  );

  const { isOptimizing, handleUpload, handleDeleteCustomImage } =
    useBackgroundImageHandlers({
      config,
      setConfig,
      saveImage,
      removeImage,
      setStorageInfo,
    });

  // Handlers
  const handleBack = useCallback(() => {
    navigate(buildSettingsPath({ section: "appearance" }));
  }, [navigate]);

  const handleImageSelect = useCallback(
    (imageUrl: string, imageId?: string) => {
      setConfigWithUndo({
        ...config,
        imageUrl: imageId ? "" : imageUrl,
        selectedImageId: imageId,
        backgroundColor: undefined,
        backgroundColorId: undefined,
        liquidGlass: undefined,
      });
    },
    [config, setConfigWithUndo]
  );

  const handleColorSelect = useCallback(
    (pairId: string) => {
      const pair = getColorPairById(pairId);
      if (!pair) return;
      setConfigWithUndo({
        ...config,
        imageUrl: "",
        selectedImageId: undefined,
        backgroundColor: resolveColorPair(pair, isDarkTheme),
        backgroundColorId: pair.id,
        liquidGlass: undefined,
      });
    },
    [config, isDarkTheme, setConfigWithUndo]
  );

  const handleAnimationSelect = useCallback(
    (animationId: string) => {
      const newAnimation =
        config.animation === animationId ? undefined : animationId;
      setConfigWithUndo({
        ...config,
        animation: newAnimation,
        liquidGlass: undefined,
      });
    },
    [config, setConfigWithUndo]
  );

  const handleAnimationClear = useCallback(() => {
    if (!config.animation) return;
    setConfigWithUndo({
      ...config,
      animation: undefined,
    });
  }, [config, setConfigWithUndo]);

  const handleSelectCustomPaletteHex = useCallback(
    (hex: string) => {
      const normalized = normalizeHexColor(hex);
      if (!normalized) return;
      setConfigWithUndo({
        ...config,
        imageUrl: "",
        selectedImageId: undefined,
        backgroundColor: normalized,
        backgroundColorId: undefined,
        liquidGlass: undefined,
      });
    },
    [config, setConfigWithUndo]
  );

  const handleAddCustomPaletteHex = useCallback(
    (hex: string) => {
      const normalized = normalizeHexColor(hex);
      if (!normalized) return;
      const current = [...(config.customColors ?? [])];
      const exists = current.some(
        (entry) => normalizeHexColor(entry) === normalized
      );
      let nextList = current;
      if (!exists) {
        if (current.length >= MAX_CUSTOM_BACKGROUND_COLORS) {
          Message.warning(
            t("background.customColorsLimit", {
              max: MAX_CUSTOM_BACKGROUND_COLORS,
            })
          );
          return;
        }
        nextList = [...current, normalized];
      }
      setConfigWithUndo({
        ...config,
        customColors: nextList,
        imageUrl: "",
        selectedImageId: undefined,
        backgroundColor: normalized,
        backgroundColorId: undefined,
        liquidGlass: undefined,
      });
    },
    [config, setConfigWithUndo, t]
  );

  const handleRemoveCustomPaletteHex = useCallback(
    (hex: string, event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const normalizedRemove = normalizeHexColor(hex);
      if (!normalizedRemove) return;
      const nextList = (config.customColors ?? []).filter(
        (entry) => normalizeHexColor(entry) !== normalizedRemove
      );
      const activeHex =
        config.backgroundColor &&
        !config.backgroundColorId &&
        !config.liquidGlass
          ? normalizeHexColor(config.backgroundColor)
          : null;
      const removingActive =
        activeHex !== null && activeHex === normalizedRemove;

      let nextConfig: BackgroundConfig = {
        ...config,
        customColors: nextList,
      };

      if (removingActive) {
        const firstPair = PRESET_COLORS[0];
        if (firstPair) {
          nextConfig = {
            ...nextConfig,
            imageUrl: "",
            selectedImageId: undefined,
            backgroundColor: resolveColorPair(firstPair, isDarkTheme),
            backgroundColorId: firstPair.id,
            liquidGlass: undefined,
          };
        }
      }

      setConfigWithUndo(nextConfig);
    },
    [config, isDarkTheme, setConfigWithUndo]
  );

  const handleBlurChange = useCallback(
    (val: number | number[]) => {
      const blurAmount = Array.isArray(val) ? val[0] : val;
      setConfigWithUndo({ ...config, blurAmount });
    },
    [config, setConfigWithUndo]
  );

  const applyThemeChange = useCallback(
    async (themeIdValue: string) => {
      const themeId = normalizeGlobalThemeId(themeIdValue);
      const selectedTheme = getGlobalTheme(themeId);
      const cover = showThemeTransitionCover();
      try {
        await swapThemeCss(selectedTheme.baseCssPath);
        setGlobalThemeId(themeId);
        setPrimaryColorPreset(
          selectedTheme.defaultPrimaryColor as PrimaryColorPreset
        );
        localStorage.setItem("theme", themeId);
      } finally {
        await cover.hide();
      }
    },
    [setGlobalThemeId, setPrimaryColorPreset]
  );

  const handleThemePresetChange = useCallback(
    (value: string | number | (string | number)[]) => {
      const themeValue = Array.isArray(value) ? value[0] : value;
      void applyThemeChange(String(themeValue));
    },
    [applyThemeChange]
  );

  const handleAppearanceModeChange = useCallback(
    (value: string | number | (string | number)[]) => {
      const selectedMode =
        String(Array.isArray(value) ? value[0] : value) === "dark"
          ? "dark"
          : "light";
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
        applyThemeChange(matchedVariant);
        return;
      }
      const fallbackThemeId =
        selectedMode === "dark"
          ? GLOBAL_THEME_GROUPS.dark[0]
          : GLOBAL_THEME_GROUPS.light[0];
      applyThemeChange(fallbackThemeId);
    },
    [applyThemeChange, globalThemeId]
  );

  const handleMatrixCharSetChange = useCallback(
    (charSet: MatrixCharSet) => {
      setConfigWithUndo({
        ...config,
        matrixCharSet: charSet,
      });
    },
    [config, setConfigWithUndo]
  );

  return {
    // State
    config,
    globalThemeId,
    isDarkTheme,
    appearanceMode,
    themeOptions,
    isOptimizing,
    images,
    storageInfo,

    // Handlers
    handleBack,
    handleImageSelect,
    handleColorSelect,
    handleAnimationSelect,
    handleAnimationClear,
    handleSelectCustomPaletteHex,
    handleAddCustomPaletteHex,
    handleRemoveCustomPaletteHex,
    handleBlurChange,
    handleUpload,
    handleDeleteCustomImage,
    handleAppearanceModeChange,
    handleThemePresetChange,
    handleMatrixCharSetChange,
  };
}
