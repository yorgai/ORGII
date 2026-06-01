/**
 * Repository Action Configurations
 *
 * Inline templates for repository/branch actions
 */
import { GitBranch } from "lucide-react";
import React from "react";

import InlineDropdown from "../../InlineDropdown";
import type { InlineActionConfig, InlineTemplateProps } from "../types";

// ============================================
// Repo/Branch Actions
// ============================================

export const openExternalEditorConfig: InlineActionConfig = {
  showInlineInHeader: true,
  template: (props: InlineTemplateProps) =>
    React.createElement(
      React.Fragment,
      null,
      React.createElement(
        "span",
        { className: "text-text-1 whitespace-nowrap font-semibold" },
        "Open"
      ),
      React.createElement(InlineDropdown, {
        value: props.getValue(0) as string,
        onChange: (val) => props.onChange(0, val),
        options: props.repoOptions.map((opt) => ({
          ...opt,
          icon: GitBranch as React.ComponentType<{
            size?: number;
            className?: string;
          }>,
        })),
        placeholder: "repo",
        showSearch: true,
        loading: props.spotlightData?.loadingRepos,
      }),
      React.createElement(
        "span",
        { className: "text-text-1 whitespace-nowrap" },
        "in external editor"
      )
    ),
};
