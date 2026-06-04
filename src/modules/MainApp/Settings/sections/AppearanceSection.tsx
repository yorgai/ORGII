import {
  SECTION_CONTROL_STYLE,
  SECTION_GAP_CLASSES,
  SectionContainer,
  SectionRow,
} from "@/src/modules/shared/layouts/SectionLayout";
import React from "react";
import { useTranslation } from "react-i18next";

import Select from "@src/components/Select";
import type { ApplicationUiFontId } from "@src/config/appearance/applicationUiFonts";
import type { PrimaryColorPreset } from "@src/config/appearance/primaryColors";
import { BackgroundSettings } from "@src/modules/MainApp/Settings/subpages/BackgroundPage/BackgroundSettings";
import {
  FeaturesSection as EditorFeaturesSection,
  TerminalSection as EditorTerminalSection,
  TypographySection as EditorTypographySection,
} from "@src/modules/MainApp/Settings/subpages/EditorAppearancePage";
import { LayoutPresetOption } from "@src/modules/WorkStation/shared/LayoutSettingsDropdown/LayoutDropdownControls";
import {
  CompactLayoutThumb,
  FullLayoutThumb,
  InsetLayoutThumb,
} from "@src/modules/WorkStation/shared/LayoutSettingsDropdown/LayoutThumbs";
import type { GlobalLayoutMethod } from "@src/store/ui/uiAtom";

import { ChatPanelAppearanceTab } from "./ChatPanelAppearanceTab";
import { UI_SCALE_OPTIONS, useAppearanceState } from "./useAppearanceState";

const getApproxFontSize = (scale: number): string => {
  const baseFontSize = 14;
  const scaledSize = Math.round((baseFontSize * scale) / 100);
  return `${scaledSize}px`;
};

export const APPEARANCE_TAB_KEYS = {
  APP: "app",
  CODE_EDITOR: "code-editor",
  CHAT_PANEL: "chat-panel",
} as const;

export type AppearanceTabKey =
  (typeof APPEARANCE_TAB_KEYS)[keyof typeof APPEARANCE_TAB_KEYS];

const GLOBAL_LAYOUT_METHODS: GlobalLayoutMethod[] = [
  "compact",
  "inset",
  "full",
];

function renderGlobalLayoutThumb(method: GlobalLayoutMethod) {
  switch (method) {
    case "inset":
      return <InsetLayoutThumb />;
    case "full":
      return <FullLayoutThumb />;
    case "compact":
      return <CompactLayoutThumb />;
  }
}

interface AppearanceSectionProps {
  activeTab?: string;
}

const AppearanceSection: React.FC<AppearanceSectionProps> = ({
  activeTab = APPEARANCE_TAB_KEYS.APP,
}) => {
  const { t } = useTranslation("settings");
  const {
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
  } = useAppearanceState();

  return (
    <div className={SECTION_GAP_CLASSES}>
      {activeTab === APPEARANCE_TAB_KEYS.APP && (
        <>
          <SectionContainer>
            <SectionRow label={t("general.appearanceMode")}>
              <Select
                value={appearanceMode}
                onChange={handleAppearanceModeChange}
                options={appearanceModeOptions}
                showSearch
                size="default"
                style={SECTION_CONTROL_STYLE}
              />
            </SectionRow>
            <SectionRow label={t("general.themePreset")}>
              <Select
                value={globalThemeId}
                onChange={(value) => handleThemeChange(String(value))}
                options={themeOptions}
                showSearch
                size="default"
                style={SECTION_CONTROL_STYLE}
              />
            </SectionRow>
            <SectionRow label={t("general.primaryColor")}>
              <Select
                value={primaryColorPreset}
                onChange={(value) =>
                  setPrimaryColorPreset(String(value) as PrimaryColorPreset)
                }
                options={primaryColorOptions}
                showSearch
                size="default"
                style={SECTION_CONTROL_STYLE}
              />
            </SectionRow>
          </SectionContainer>

          <SectionContainer>
            <SectionRow label={t("general.applicationFont")}>
              <Select
                value={applicationUiFont}
                onChange={(value) =>
                  setApplicationUiFont(value as ApplicationUiFontId)
                }
                options={applicationUiFontOptions}
                showSearch
                size="default"
                style={SECTION_CONTROL_STYLE}
              />
            </SectionRow>
            <SectionRow label={t("general.uiScale")}>
              <Select
                value={String(uiScale)}
                onChange={(value) => handleUIScaleChange(String(value))}
                options={UI_SCALE_OPTIONS.map((scale) => ({
                  label: `${scale}% · ${getApproxFontSize(scale)}`,
                  value: String(scale),
                }))}
                size="default"
                style={SECTION_CONTROL_STYLE}
              />
            </SectionRow>
          </SectionContainer>

          <SectionContainer title={t("general.layout")}>
            <SectionRow
              label={t("general.globalLayoutMethod")}
              description={t("general.globalLayoutMethodDesc")}
              align="start"
              headerClassName="@[480px]:pt-1"
            >
              <div className="flex max-w-full flex-wrap gap-3 @[480px]:justify-end">
                {GLOBAL_LAYOUT_METHODS.map((method) => (
                  <LayoutPresetOption
                    key={method}
                    active={globalLayoutMethod === method}
                    label={t(`general.${method}`)}
                    captionSize="body"
                    stretch={false}
                    onClick={() => setGlobalLayoutMethod(method)}
                  >
                    {renderGlobalLayoutThumb(method)}
                  </LayoutPresetOption>
                ))}
              </div>
            </SectionRow>
          </SectionContainer>

          <BackgroundSettings embedded showHeader={false} />
        </>
      )}

      {activeTab === APPEARANCE_TAB_KEYS.CODE_EDITOR && (
        <>
          <EditorTypographySection showTitle={false} />
          <EditorTerminalSection />
          <EditorFeaturesSection />
        </>
      )}

      {activeTab === APPEARANCE_TAB_KEYS.CHAT_PANEL && (
        <ChatPanelAppearanceTab />
      )}
    </div>
  );
};

export default AppearanceSection;
