/**
 * MultiSelectFooter — Reusable footer for multi-select dropdowns.
 *
 * Left: "Select All" / "Unselect All" toggle (no check icon).
 * Right: Primary action button (e.g. "Import (3)").
 */
import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";

import DropdownFooter from "./DropdownFooter";
import { MULTI_SELECT_TOKENS } from "./tokens";

export interface MultiSelectFooterProps {
  /** Whether all selectable items are selected */
  allSelected: boolean;
  /** Total selectable count (for Select All toggle) */
  selectableCount: number;
  /** Called when user clicks Select All / Unselect All */
  onSelectAll: () => void;
  /** Primary action label (e.g. "Import") */
  primaryLabel: string;
  /** Selected count shown in button (e.g. "Import (3)") */
  selectedCount: number;
  /** Called when user clicks primary button */
  onPrimary: () => void;
  /** Primary button loading state */
  primaryLoading?: boolean;
  /** Primary button disabled (e.g. when none selected) */
  primaryDisabled?: boolean;
}

const MultiSelectFooter: React.FC<MultiSelectFooterProps> = ({
  allSelected,
  selectableCount,
  onSelectAll,
  primaryLabel,
  selectedCount,
  onPrimary,
  primaryLoading = false,
  primaryDisabled = false,
}) => {
  const { t } = useTranslation();

  if (selectableCount === 0) return null;

  return (
    <DropdownFooter>
      <button
        type="button"
        className={MULTI_SELECT_TOKENS.footerSelectAll}
        onClick={onSelectAll}
      >
        {allSelected
          ? t("common:actions.unselectAll")
          : t("common:actions.selectAll")}
      </button>
      <Button
        variant="primary"
        size="small"
        disabled={primaryDisabled || primaryLoading}
        loading={primaryLoading}
        onClick={onPrimary}
        className="ml-auto shrink-0"
      >
        {primaryLabel} ({selectedCount})
      </Button>
    </DropdownFooter>
  );
};

export default MultiSelectFooter;
