/**
 * AutomationOverviewSection — InfoCard showing automation rule metadata.
 */
import { Zap } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import StatusDot from "@src/components/StatusDot";
import { InfoCard } from "@src/modules/shared/layouts/blocks";

import { TRIGGER_CONFIG, TRIGGER_ICON_MAP } from "../config";
import type { AutomationRule } from "../types";

interface AutomationOverviewSectionProps {
  rule: AutomationRule;
}

/** Short human-readable trigger summary. */
function triggerSummary(rule: AutomationRule): string {
  const trigger = rule.trigger;
  switch (trigger.type) {
    case "timer":
      return `Every ${trigger.intervalSecs}s`;
    case "scheduledTime": {
      const frequency = trigger.frequency;
      const days = trigger.daysOfWeek?.join(", ");
      const monthlyMode = trigger.monthlyMode ?? "dayOfMonth";
      const datePart =
        frequency === "weekly" && days
          ? days
          : frequency === "monthly" && monthlyMode === "lastDay"
            ? "last day"
            : frequency === "monthly" && monthlyMode === "weekdayOfMonth"
              ? `${trigger.weekOfMonth ?? "first"} ${trigger.weekdayOfMonth ?? "monday"}`
              : frequency === "monthly"
                ? `day ${trigger.dayOfMonth ?? 1}`
                : frequency;
      return `${datePart} at ${trigger.time} ${trigger.timezone}`;
    }
    case "cron":
      return trigger.expression;
    case "gitActivity":
      return trigger.events.join(", ");
    case "channelMessage":
      return trigger.channel;
    case "fileWatch":
      return `${trigger.paths.length} path(s)`;
    case "webhook":
      return trigger.route;
  }
}

const AutomationOverviewSection: React.FC<AutomationOverviewSectionProps> = ({
  rule,
}) => {
  const { t } = useTranslation("integrations");

  const TriggerIcon = TRIGGER_ICON_MAP[rule.trigger.type] ?? Zap;
  const triggerLabel =
    TRIGGER_CONFIG[rule.trigger.type]?.label ?? rule.trigger.type;
  const actionsCount = rule.actions.length;

  return (
    <InfoCard
      rows={[
        {
          label: t("agentOrgs.trigger"),
          value: (
            <span className="flex items-center gap-1.5">
              <TriggerIcon size={14} className="text-primary-6" />
              {triggerLabel}
            </span>
          ),
        },
        {
          label: t("agentOrgs.overview.triggerConfig"),
          value: triggerSummary(rule),
        },
        {
          label: t("agentOrgs.overview.actions"),
          value: `${actionsCount} action${actionsCount !== 1 ? "s" : ""}`,
        },
        {
          label: t("common:common.status"),
          value: (
            <StatusDot
              color={rule.enabled ? "bg-success-6" : "bg-fill-3"}
              size="inline"
              labelClassName={`text-[12px] ${rule.enabled ? "text-success-6" : "text-text-3"}`}
              label={
                rule.enabled ? t("agentOrgs.enabled") : t("agentOrgs.disabled")
              }
            />
          ),
        },
        {
          label: t("agentOrgs.overview.fireCount"),
          value: String(rule.fireCount),
        },
        {
          label: t("agentOrgs.overview.lastFired"),
          value: rule.lastFired ? (
            <span className="text-text-1">{rule.lastFired}</span>
          ) : (
            <span className="text-text-3">—</span>
          ),
        },
        {
          label: t("agentOrgs.cooldown"),
          value: rule.cooldownSecs ? `${rule.cooldownSecs}s` : "—",
          hidden: !rule.cooldownSecs,
        },
        {
          label: t("agentOrgs.overview.maxFires"),
          value: rule.maxFires ? String(rule.maxFires) : "—",
          hidden: !rule.maxFires,
        },
      ]}
    />
  );
};

export default AutomationOverviewSection;
