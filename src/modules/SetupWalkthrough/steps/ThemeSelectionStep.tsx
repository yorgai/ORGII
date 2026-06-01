/**
 * Theme Selection Step
 *
 * Allows user to select background/theme settings.
 */
import React from "react";
import { useTranslation } from "react-i18next";

import { BackgroundSettings } from "@src/modules/MainApp/Settings/subpages/BackgroundPage";

import { AnimatedTitle } from "../components";

export const ThemeSelectionStep: React.FC = () => {
  const { t } = useTranslation("onboarding");

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden scrollbar-hide">
      <AnimatedTitle
        title={t("theme.title")}
        subtitle={t("theme.description")}
      />
      <div className="absolute inset-0 top-14 flex animate-[fadeInUp_0.6s_ease-out_2s_backwards] flex-col scrollbar-hide">
        <BackgroundSettings
          showHeader={false}
          translationNamespace="settings"
        />
      </div>
    </div>
  );
};
