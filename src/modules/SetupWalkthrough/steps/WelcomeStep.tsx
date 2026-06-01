/**
 * Welcome Step
 *
 * Initial welcome screen with persistent animated title.
 */
import React from "react";
import { useTranslation } from "react-i18next";

import { AnimatedTitle } from "../components";

export const WelcomeStep: React.FC = () => {
  const { t } = useTranslation("onboarding");

  return (
    <AnimatedTitle
      title={t("welcome.title")}
      subtitle={t("welcome.description")}
      persistent={true}
      hideSmallTitle={true}
    />
  );
};
