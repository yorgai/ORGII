/**
 * GitHub Step
 *
 * Connect GitHub account for repository access.
 */
import { Github } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";

import { AnimatedTitle } from "../components";

export const GitHubStep: React.FC = () => {
  const { t } = useTranslation("onboarding");

  return (
    <>
      <AnimatedTitle
        title={t("github.title")}
        subtitle={t("github.description")}
      />
      <div className="flex animate-[fadeInUp_0.6s_ease-out_2s_backwards] flex-col items-center gap-4 text-center">
        <Button variant="primary" size="large" icon={<Github size={18} />}>
          {t("github.connectButton")}
        </Button>
        <p className="m-0 text-sm text-text-3">{t("github.hint")}</p>
      </div>
    </>
  );
};
