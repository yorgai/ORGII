import { Zap } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import {
  CollapsibleSection,
  DETAIL_PANEL_TOKENS,
  DetailPanelContainer,
  PanelFooter,
  PanelHeader,
} from "@src/modules/shared/layouts/blocks";

import { DetailHeaderClose } from "../../shared/DetailHeaderClose";
import { TRIGGER_CONFIG, TRIGGER_ICON_MAP } from "../config";
import type { AutomationRule } from "../types";
import AutomationOverviewSection from "./AutomationOverviewSection";
import AutomationQuickActionsSection from "./AutomationQuickActionsSection";

interface AutomationRuleDetailViewProps {
  rule: AutomationRule;
  onEdit: () => void;
  onDelete: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onBack: () => void;
}

const AutomationRuleDetailView: React.FC<AutomationRuleDetailViewProps> = ({
  rule,
  onEdit,
  onDelete,
  onToggleEnabled,
  onBack,
}) => {
  const { t } = useTranslation("integrations");
  const TriggerIcon = TRIGGER_ICON_MAP[rule.trigger.type] ?? Zap;
  const triggerLabel =
    TRIGGER_CONFIG[rule.trigger.type]?.label ?? rule.trigger.type;

  return (
    <DetailPanelContainer>
      <PanelHeader
        iconElement={<TriggerIcon size={14} className="text-primary-6" />}
        breadcrumb={{
          parent: triggerLabel,
          current: rule.name,
        }}
        actions={<DetailHeaderClose onClick={onBack} />}
      />

      <div className={DETAIL_PANEL_TOKENS.scrollContent}>
        <div className={DETAIL_PANEL_TOKENS.contentWidthWithPadding}>
          <CollapsibleSection title={t("agentOrgs.sections.quickActions")}>
            <AutomationQuickActionsSection
              enabled={rule.enabled}
              onToggleEnabled={onToggleEnabled}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          </CollapsibleSection>

          <CollapsibleSection title={t("common:common.overview")}>
            <AutomationOverviewSection rule={rule} />
          </CollapsibleSection>
        </div>
      </div>
      <PanelFooter
        primaryAction={{
          label: t("common:actions.edit"),
          onClick: onEdit,
        }}
        secondaryActions={[
          {
            label: t("common:actions.delete"),
            onClick: onDelete,
            variant: "danger",
            appearance: "outline",
          },
        ]}
      />
    </DetailPanelContainer>
  );
};

export default AutomationRuleDetailView;
