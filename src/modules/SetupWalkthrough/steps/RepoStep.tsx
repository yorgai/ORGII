/**
 * Repo Step
 *
 * Open or clone a repo to get started.
 */
import { FolderGit2, Github } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";

import { AnimatedTitle } from "../components";

export const RepoStep: React.FC = () => {
  const { t } = useTranslation("onboarding");

  return (
    <>
      <AnimatedTitle
        title={t("workspace.title")}
        subtitle={t("workspace.description")}
      />
      <div className="flex animate-[fadeInUp_0.6s_ease-out_2s_backwards] flex-col items-center gap-4 text-center">
        <div className="flex gap-3">
          <Button size="large" icon={<FolderGit2 size={18} />}>
            {t("workspace.openFolder")}
          </Button>
          <Button size="large" icon={<Github size={18} />}>
            {t("workspace.cloneRepo")}
          </Button>
        </div>
        <p className="m-0 text-sm text-text-3">{t("workspace.hint")}</p>
      </div>
    </>
  );
};
