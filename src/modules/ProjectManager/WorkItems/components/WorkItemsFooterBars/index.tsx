import { Trash2 } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { PanelFooter } from "@src/modules/shared/layouts/blocks";

interface MultiSelectBarProps {
  selectedCount: number;
  visibleItemCount: number;
  deleting: boolean;
  onSelectAll: () => void;
  onUnselectAll: () => void;
  onDelete: () => void;
}

export const MultiSelectBar: React.FC<MultiSelectBarProps> = ({
  selectedCount,
  visibleItemCount,
  deleting,
  onSelectAll,
  onUnselectAll,
  onDelete,
}) => {
  const { t } = useTranslation("projects");

  if (selectedCount === 0) return null;

  const allSelected = selectedCount > 0 && selectedCount === visibleItemCount;

  return (
    <PanelFooter
      left={
        <Button
          size="small"
          onClick={allSelected ? onUnselectAll : onSelectAll}
        >
          {allSelected
            ? t("common:actions.unselectAll")
            : t("common:actions.selectAll")}
        </Button>
      }
      secondaryActions={[
        { label: t("common:actions.cancel"), onClick: onUnselectAll },
      ]}
      primaryAction={{
        label: t("workItems.deleteItems", { count: selectedCount }),
        onClick: onDelete,
        icon: <Trash2 size={14} />,
        variant: "danger",
        appearance: "outline",
        disabled: deleting,
        loading: deleting,
      }}
    />
  );
};
