/**
 * Repository Action Configurations
 *
 * Inline templates for repository/branch actions
 */
import { GitBranch } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import InlineDropdown from "@src/components/InlineDropdown";

import type { InlineActionConfig, InlineTemplateProps } from "../types";

const REPO_ICON = GitBranch as React.ComponentType<{
  size?: number;
  className?: string;
}>;

// ============================================
// Repo/Branch Actions
// ============================================

const OpenExternalEditorTemplate: React.FC<InlineTemplateProps> = (props) => {
  const { t } = useTranslation("integrations");

  return (
    <>
      <span className="whitespace-nowrap font-semibold text-text-1">
        {t("workflowActions.inline.open")}
      </span>
      <InlineDropdown
        value={props.getValue(0) as string}
        onChange={(val) => props.onChange(0, val)}
        options={props.repoOptions.map((opt) => ({ ...opt, icon: REPO_ICON }))}
        placeholder={t("workflowActions.inline.repoPlaceholder")}
        showSearch
        loading={props.spotlightData?.loadingRepos}
      />
      <span className="whitespace-nowrap text-text-1">
        {t("workflowActions.inline.inExternalEditor")}
      </span>
    </>
  );
};

export const openExternalEditorConfig: InlineActionConfig = {
  showInlineInHeader: true,
  template: (props) => <OpenExternalEditorTemplate {...props} />,
};
