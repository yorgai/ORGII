/**
 * BackgroundSettings Component
 * Main orchestrator for background customization settings
 */
import {
  DETAIL_PANEL_TOKENS,
  PanelHeader,
  ScrollFadeContainer,
} from "@/src/modules/shared/layouts/blocks";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import Select from "@src/components/Select";
import {
  SECTION_CONTROL_STYLE,
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";

import { AnimationSection, ColorSection, ImageSection } from "./components";
import { useBackgroundSettings } from "./hooks";
import {
  BACKGROUND_CONTENT_SOURCE,
  type BackgroundContentSource,
  type BackgroundSettingsProps,
} from "./types";

export const BackgroundSettings: React.FC<BackgroundSettingsProps> = ({
  showHeader = true,
  embedded = false,
  translationNamespace = "settings",
}) => {
  const { t } = useTranslation(translationNamespace);

  const {
    // State
    config,
    appearanceMode,
    appearanceModeOptions,
    globalThemeId,
    themeOptions,
    isDarkTheme,
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
  } = useBackgroundSettings();

  const initialBackgroundSource: BackgroundContentSource =
    !config.backgroundColor && !config.liquidGlass && !!config.imageUrl
      ? BACKGROUND_CONTENT_SOURCE.IMAGES
      : BACKGROUND_CONTENT_SOURCE.COLORS;
  const [backgroundContentSource, setBackgroundContentSource] =
    useState<BackgroundContentSource>(initialBackgroundSource);

  const handleBackgroundSourceChange = useCallback(
    (value: string | number | (string | number)[]) => {
      const next = String(value) as BackgroundContentSource;
      if (next === BACKGROUND_CONTENT_SOURCE.IMAGES) {
        handleAnimationClear();
      }
      setBackgroundContentSource(next);
    },
    [handleAnimationClear]
  );

  const showAppearanceChrome = !embedded;

  const sections = (
    <>
      {showAppearanceChrome && (
        <div className="flex flex-col gap-2">
          <SectionRow compact label={t("general.appearanceMode")}>
            <Select
              value={appearanceMode}
              onChange={handleAppearanceModeChange}
              options={appearanceModeOptions}
              size="default"
              style={SECTION_CONTROL_STYLE}
            />
          </SectionRow>
          <SectionRow compact label={t("general.themePreset")}>
            <Select
              value={globalThemeId}
              onChange={handleThemePresetChange}
              options={themeOptions.map((option) => ({
                label: t(option.labelKey),
                value: option.value,
              }))}
              showSearch
              size="default"
              style={SECTION_CONTROL_STYLE}
            />
          </SectionRow>
        </div>
      )}

      <SectionContainer title={t("background.title")}>
        <SectionRow label={t("background.source")}>
          <Select
            value={backgroundContentSource}
            onChange={handleBackgroundSourceChange}
            options={[
              {
                label: t("background.colors"),
                value: BACKGROUND_CONTENT_SOURCE.COLORS,
              },
              {
                label: t("background.images"),
                value: BACKGROUND_CONTENT_SOURCE.IMAGES,
              },
            ]}
            size="default"
            style={SECTION_CONTROL_STYLE}
          />
        </SectionRow>

        {backgroundContentSource === BACKGROUND_CONTENT_SOURCE.COLORS && (
          <>
            <ColorSection
              config={config}
              translationNamespace={translationNamespace}
              onColorSelect={handleColorSelect}
              onSelectCustomHex={handleSelectCustomPaletteHex}
              onAddCustomHex={handleAddCustomPaletteHex}
              onRemoveCustomHex={handleRemoveCustomPaletteHex}
            />
            <AnimationSection
              config={config}
              isDarkTheme={isDarkTheme}
              translationNamespace={translationNamespace}
              onAnimationSelect={handleAnimationSelect}
              onAnimationClear={handleAnimationClear}
              onMatrixCharSetChange={handleMatrixCharSetChange}
            />
          </>
        )}

        {backgroundContentSource === BACKGROUND_CONTENT_SOURCE.IMAGES && (
          <ImageSection
            config={config}
            images={images}
            storagePath={storageInfo.path}
            isOptimizing={isOptimizing}
            translationNamespace={translationNamespace}
            onBlurChange={handleBlurChange}
            onImageSelect={handleImageSelect}
            onUpload={handleUpload}
            onDeleteCustomImage={handleDeleteCustomImage}
          />
        )}
      </SectionContainer>
    </>
  );

  if (embedded) {
    return <>{sections}</>;
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {showHeader && (
        <PanelHeader
          onBack={handleBack}
          breadcrumb={{
            parent: t("sections.general"),
            current: t("background.title"),
          }}
        />
      )}

      <ScrollFadeContainer className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 scrollbar-hide">
        <div
          className={`${DETAIL_PANEL_TOKENS.contentWidth} flex flex-col gap-3`}
        >
          {sections}
        </div>
      </ScrollFadeContainer>
    </div>
  );
};
