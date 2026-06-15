/**
 * Control Action Configurations
 *
 * Inline templates for control flow actions (wait, if, loop)
 */
import React from "react";
import { useTranslation } from "react-i18next";

import InlineDropdown from "@src/components/InlineDropdown";

import InlineNumberInput from "../../InlineNumberInput";
import type { InlineActionConfig, InlineTemplateProps } from "../types";

// ============================================
// Control Actions
// ============================================

// Wait: "Wait for [5] [seconds]"
const WaitTemplate: React.FC<InlineTemplateProps> = (props) => {
  const { t } = useTranslation("integrations");

  return (
    <>
      <span className="whitespace-nowrap font-semibold text-text-1">
        {t("workflowActions.inline.waitFor")}
      </span>
      <InlineNumberInput
        value={props.getValue(0) as number}
        onChange={(val) => props.onChange(0, val)}
        min={0}
        unit={props.getUnit(0)}
      />
    </>
  );
};

export const waitConfig: InlineActionConfig = {
  showInlineInHeader: true,
  template: (props) => <WaitTemplate {...props} />,
};

// If (conditional)
const IfTemplate: React.FC<InlineTemplateProps> = (props) => {
  const { t } = useTranslation("integrations");
  const condition = props.getValue(0) as string;
  const needsValue = ["equals", "not-equals", "contains"].includes(condition);

  return (
    <>
      <span className="whitespace-nowrap font-semibold text-text-1">
        {t("workflowActions.inline.ifOutput")}
      </span>
      <InlineDropdown
        value={condition}
        onChange={(val) => props.onChange(0, val)}
        options={[
          { label: t("workflowActions.inline.condEquals"), value: "equals" },
          {
            label: t("workflowActions.inline.condNotEquals"),
            value: "not-equals",
          },
          {
            label: t("workflowActions.inline.condContains"),
            value: "contains",
          },
          { label: t("workflowActions.inline.condIsEmpty"), value: "is-empty" },
          {
            label: t("workflowActions.inline.condIsNotEmpty"),
            value: "is-not-empty",
          },
        ]}
        placeholder={t("workflowActions.inline.conditionPlaceholder")}
      />
      {needsValue && (
        <input
          type="text"
          value={(props.getValue(1) as string) || ""}
          onChange={(e) => props.onChange(1, e.target.value)}
          placeholder={t("workflowActions.inline.valuePlaceholder")}
          className="min-w-[80px] rounded bg-bg-2 px-2 py-0.5 text-text-1 outline-none"
        />
      )}
    </>
  );
};

export const ifConfig: InlineActionConfig = {
  showInlineInHeader: true,
  template: (props) => <IfTemplate {...props} />,
};
