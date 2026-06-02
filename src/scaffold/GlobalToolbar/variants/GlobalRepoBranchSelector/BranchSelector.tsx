/**
 * BranchSelector Component
 *
 * Branch selection UI - always shows current branch from git
 * Never shows "Select branch" - shows loading or the actual branch
 */
import { GitBranch, Loader2 } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import { CODE_EDITOR_TOUR_TARGETS } from "@src/scaffold/Tutorials/codeEditorTourConfig";

import PillSelector from "../../components/PillSelector";
import type { BranchOption } from "../../types";

interface BranchSelectorProps {
  branchOptions: BranchOption[];
  selectedBranch: string;
  handleBranchClick: (e: React.MouseEvent) => void;
  loading?: boolean;
  checkoutLoading?: boolean;
  /** When true, hide text label and show only the icon */
  compact?: boolean;
  /** Called when hover state changes */
  onHoverChange?: (hovered: boolean) => void;
  /** When true, suppress hover visuals (selector form is open) */
  formOpen?: boolean;
}

const BranchSelector: React.FC<BranchSelectorProps> = ({
  branchOptions,
  selectedBranch,
  handleBranchClick,
  loading = false,
  checkoutLoading = false,
  compact = false,
  onHoverChange,
  formOpen = false,
}) => {
  const { t } = useTranslation();
  // Determine the label to show
  // Priority: 1) Match from options, 2) selectedBranch value, 3) loading indicator, 4) fallback to "main"
  const getLabel = () => {
    // If we have branch options, try to find a matching label
    const matchedOption = branchOptions.find(
      (branch) => branch.value === selectedBranch
    );
    if (matchedOption) {
      return matchedOption.label;
    }

    // If we have a selectedBranch value, show it
    if (selectedBranch) {
      return selectedBranch;
    }

    // If loading, show loading indicator
    if (loading) {
      return t("status.loading");
    }

    // Fallback to "main" - never show "Select branch"
    return "main";
  };

  const isLoadingWithNoBranch = loading && !selectedBranch;
  const showSpinner = isLoadingWithNoBranch || checkoutLoading;

  return (
    <PillSelector
      icon={showSpinner ? Loader2 : GitBranch}
      iconClassName={showSpinner ? "animate-spin" : undefined}
      label={getLabel()}
      onClick={handleBranchClick}
      maxLabelWidth={180}
      hideLabel={compact}
      onHoverChange={onHoverChange}
      formOpen={formOpen}
      dataTourTarget={CODE_EDITOR_TOUR_TARGETS.branchSelector}
    />
  );
};

export default BranchSelector;
