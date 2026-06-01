/**
 * AutomationQuickActionsSection — Status bar + action cards for automation rule detail.
 */
import { Pencil, Trash2 } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import ActionCard from "@src/components/ActionCard";
import Switch from "@src/components/Switch";
import {
  STATUS_BAR_TOKENS,
  STATUS_ICON,
  STATUS_ICON_SIZE,
} from "@src/modules/MainApp/Integrations/panelTokens";
import { DETAIL_PANEL_TOKENS } from "@src/modules/shared/layouts/blocks";

interface AutomationQuickActionsSectionProps {
  enabled: boolean;
  onToggleEnabled: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}

const AutomationQuickActionsSection: React.FC<
  AutomationQuickActionsSectionProps
> = ({ enabled, onToggleEnabled, onEdit, onDelete }) => {
  const { t } = useTranslation("integrations");

  return (
    <div className={DETAIL_PANEL_TOKENS.contentStack}>
      {/* Status line: Enabled / Disabled with Switch */}
      <div className={STATUS_BAR_TOKENS.container}>
        <span className={STATUS_BAR_TOKENS.label}>
          <STATUS_ICON
            size={STATUS_ICON_SIZE}
            className={
              enabled
                ? STATUS_BAR_TOKENS.enabledClass
                : STATUS_BAR_TOKENS.disabledClass
            }
          />
          <span className={STATUS_BAR_TOKENS.labelText}>
            {t("common:common.status")}:
          </span>
          <span
            className={
              enabled
                ? STATUS_BAR_TOKENS.enabledClass
                : STATUS_BAR_TOKENS.disabledClass
            }
          >
            {enabled ? t("agentOrgs.enabled") : t("agentOrgs.disabled")}
          </span>
        </span>
        <Switch checked={enabled} onChange={onToggleEnabled} />
      </div>

      {/* Action cards */}
      <div className="grid grid-cols-2 gap-2 max-[480px]:grid-cols-1">
        <ActionCard
          icon={Pencil}
          title={t("agentOrgs.editRoutine")}
          description={t("agentOrgs.quickActions.editDesc")}
          variant="default"
          onClick={onEdit}
          showArrow
        />
        <ActionCard
          icon={Trash2}
          title={t("agentOrgs.quickActions.delete")}
          description={t("agentOrgs.quickActions.deleteDesc")}
          variant="default"
          onClick={onDelete}
          showArrow
        />
      </div>
    </div>
  );
};

export default AutomationQuickActionsSection;
