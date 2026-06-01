/**
 * Control Action Configurations
 *
 * Inline templates for control flow actions (wait, if, loop)
 */
import React from "react";

import InlineDropdown from "../../InlineDropdown";
import InlineNumberInput from "../../InlineNumberInput";
import type { InlineActionConfig, InlineTemplateProps } from "../types";

// ============================================
// Control Actions
// ============================================

// Wait: "Wait for [5] [seconds]"
export const waitConfig: InlineActionConfig = {
  showInlineInHeader: true,
  template: (props: InlineTemplateProps) =>
    React.createElement(
      React.Fragment,
      null,
      React.createElement(
        "span",
        { className: "text-text-1 whitespace-nowrap font-semibold" },
        "Wait for"
      ),
      React.createElement(InlineNumberInput, {
        value: props.getValue(0) as number,
        onChange: (val) => props.onChange(0, val),
        min: 0,
        unit: props.getUnit(0),
      })
    ),
};

// If (conditional)
export const ifConfig: InlineActionConfig = {
  showInlineInHeader: true,
  template: (props: InlineTemplateProps) => {
    const condition = props.getValue(0) as string;
    const needsValue = ["equals", "not-equals", "contains"].includes(condition);

    return React.createElement(
      React.Fragment,
      null,
      React.createElement(
        "span",
        { className: "text-text-1 whitespace-nowrap font-semibold" },
        "If output"
      ),
      React.createElement(InlineDropdown, {
        value: condition,
        onChange: (val) => props.onChange(0, val),
        options: [
          { label: "equals", value: "equals" },
          { label: "not equals", value: "not-equals" },
          { label: "contains", value: "contains" },
          { label: "is empty", value: "is-empty" },
          { label: "is not empty", value: "is-not-empty" },
        ],
        placeholder: "condition",
      }),
      needsValue &&
        React.createElement("input", {
          type: "text",
          value: (props.getValue(1) as string) || "",
          onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
            props.onChange(1, e.target.value),
          placeholder: "value",
          className:
            "rounded bg-bg-2 px-2 py-0.5 text-text-1 outline-none min-w-[80px]",
        })
    );
  },
};
