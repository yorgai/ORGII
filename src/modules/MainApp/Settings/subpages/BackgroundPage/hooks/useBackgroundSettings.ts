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
  BACKGROUND_COLOR_PAIRS,
  getColorPairById,
  resolveColorPair,
} from "@src/config/appearance/backgroundColorPairs";
import {
  APPEARANCE_MODE_OPTIONS,
  type AppearanceMode,
  GLOBAL_THEMES,
  getAppearanceModeForTheme,
  getDefaultThemeForAppearanceMode,
  getGlobalTheme,
  getThemeOptionsForAppearanceMode,
  normalizeAppearanceMode,
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
import { setGlassThickness } from "@src/util/platform/ipcRenderer";
import { prewarmColor } from "@src/util/ui/theme/glassMaterial";
import { preloadThemeCss, swapThemeCss } from "@src/util/ui/theme/swapThemeCss";
import { showThemeTransitionCover } from "@src/util/ui/theme/themeTransitionCover";

import { MAX_CUSTOM_BACKGROUND_COLORS } from "../config";
import type { MatrixCharSet, StorageInfo } from "../types";
import { normalizeHexColor } from "../utils";
import { useBackgroundImageHandlers } from "./useBackgroundImageHandlers";

export interface UseBackgroundSettingsReturn {
  // State
  config: BackgroundConfig;
  globalThemeId: string;
  isDarkTheme: boolean;
  appearanceMode: AppearanceMode;
  appearanceModeOptions: { label: string; value: AppearanceMode }[];
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

  const isDarkTheme = getGlobalTheme(globalThemeId).isDark;
  const appearanceMode = getAppearanceModeForTheme(globalThemeId);

  const appearanceModeOptions = useMemo(
    () =>
      APPEARANCE_MODE_OPTIONS.map((mode) => ({
        label: t(`general.${mode}`),
        value: mode,
      })),
    [t]
  );

  const themeOptions = useMemo(
    () =>
      getThemeOptionsForAppearanceMode(appearanceMode).map((themeId) => ({
        labelKey: GLOBAL_THEMES[themeId].i18nKey,
        value: themeId,
      })),
    [appearanceMode]
  );

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
  // setGlassThickness is idempotent, so re-firing on changes is fine.
  useEffect(() => {
    if (config.glass) {
      setGlassThickness(config.glass);
    }
  }, [config.glass]);

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

  useEffect(() => {
    if (!config.backgroundColorId) return;
    const pair = getColorPairById(config.backgroundColorId);
    if (!pair) return;
    prewarmColor(resolveColorPair(pair));
  }, [config.backgroundColorId, globalThemeId]);

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
        glass: undefined,
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
        backgroundColor: undefined,
        backgroundColorId: pair.id,
        glass: undefined,
      });
    },
    [config, setConfigWithUndo]
  );

  const handleAnimationSelect = useCallback(
    (animationId: string) => {
      const newAnimation =
        config.animation === animationId ? undefined : animationId;
      setConfigWithUndo({
        ...config,
        animation: newAnimation,
        glass: undefined,
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
        glass: undefined,
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
        glass: undefined,
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
        config.backgroundColor && !config.backgroundColorId && !config.glass
          ? normalizeHexColor(config.backgroundColor)
          : null;
      const removingActive =
        activeHex !== null && activeHex === normalizedRemove;

      let nextConfig: BackgroundConfig = {
        ...config,
        customColors: nextList,
      };

      if (removingActive) {
        const firstPair = BACKGROUND_COLOR_PAIRS[0];
        if (firstPair) {
          nextConfig = {
            ...nextConfig,
            imageUrl: "",
            selectedImageId: undefined,
            backgroundColor: undefined,
            backgroundColorId: firstPair.id,
            glass: undefined,
          };
        }
      }

      setConfigWithUndo(nextConfig);
    },
    [config, setConfigWithUndo]
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
      const rawMode = String(Array.isArray(value) ? value[0] : value);
      const selectedMode = normalizeAppearanceMode(rawMode);
      applyThemeChange(getDefaultThemeForAppearanceMode(selectedMode));
    },
    [applyThemeChange]
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
    appearanceModeOptions,
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
