import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";

interface EditModeHeaderProps {
  editLabel: string;
  editHeaderActions?: boolean;
  onEditCancel?: () => void;
  onEditSubmit: () => void;
}

const EditModeHeader: React.FC<EditModeHeaderProps> = ({
  editLabel,
  editHeaderActions = true,
  onEditCancel,
  onEditSubmit,
}) => {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[28px] items-center justify-between bg-fill-1 px-2">
      <span className="text-[12px] font-medium text-text-2">{editLabel}</span>
      {editHeaderActions && (
        <div className="flex items-center gap-1">
          {onEditCancel && (
            <Button
              variant="tertiary"
              size="mini"
              htmlType="button"
              onClick={onEditCancel}
            >
              {t("common:actions.cancel")}
            </Button>
          )}
          <Button
            variant="primary"
            size="mini"
            htmlType="button"
            onClick={onEditSubmit}
          >
            {t("common:actions.save")}
          </Button>
        </div>
      )}
    </div>
  );
};

export default EditModeHeader;
