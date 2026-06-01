/**
 * VariantPill
 *
 * Compact pill showing the currently selected variant of a model —
 * reasoning effort and the optional "fast" flag — e.g. `Medium · Fast`.
 *
 * Rendered at the end of an account row in the UnifiedModelPalette's
 * right column. Clicking the pen icon opens the
 * {@link ModelPropertiesDropdown} so the user can edit the per-key
 * default variant (Thinking, Fast, Effort/Reasoning level) inline. The
 * change is persisted via the supplied `onApply` callback (which the
 * caller wires to `saveKey` with `default_variants`).
 */
import { Pencil } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import ModelPropertiesDropdown from "@src/components/ModelPropertiesDropdown";
import {
  formatReasoningLevel,
  parseModelVariant,
} from "@src/util/modelVariants";
import { buildVariantEditOptions } from "@src/util/variantEditOptions";

export interface VariantPillProps {
  /** Concrete model id whose variant is being displayed. */
  modelId: string;
  /**
   * Every variant id in the model's family. Drives the
   * {@link ModelPropertiesDropdown}'s available level/fast matrix.
   * When omitted, the pill is non-editable (legacy callers).
   */
  groupModelIds?: readonly string[];
  /**
   * Called when the user picks a new variant and clicks Apply. Receives
   * the resolved model id. Caller persists it via the relevant
   * `default_variants` write path.
   */
  onApply?: (modelId: string) => void;
}

export const VariantPill: React.FC<VariantPillProps> = ({
  modelId,
  groupModelIds,
  onApply,
}) => {
  const { t } = useTranslation();
  const variant = parseModelVariant(modelId);

  const variantOptions = React.useMemo(
    () => buildVariantEditOptions(groupModelIds ?? [modelId]),
    [groupModelIds, modelId]
  );

  // Match the 28px / border-2 pill style used by the Models & Keys
  // ModelVariantInlineCard. The enclosing spotlight row already lifts to
  // `bg-fill-2` on hover/selection, so the pill jumps one stop higher to
  // `bg-fill-3` + `border-3` when hovered or its dropdown is open — that
  // keeps the pill visually separated from the row underneath.
  const pillClasses =
    "inline-flex h-[28px] shrink-0 items-center gap-1 rounded-full border border-border-2 px-2.5 text-[12px] font-semibold text-text-2";

  // No variants: show a non-editable "Default" pill. Intentionally not
  // localized — reads as a stable technical label across locales,
  // consistent with how we treat other developer-facing tokens.
  const defaultPillClasses = `${pillClasses.replace("text-text-2", "text-text-3")}`;
  if (!variant) {
    return <span className={defaultPillClasses}>Default</span>;
  }

  const parts: string[] = [];
  if (variant.reasoning) {
    parts.push(formatReasoningLevel(variant.reasoning));
  }
  if (variant.fast) {
    parts.push(t("selectors.modelSelector.variantFast"));
  }
  if (parts.length === 0) {
    return <span className={defaultPillClasses}>Default</span>;
  }

  const editable = onApply !== undefined && (groupModelIds?.length ?? 0) > 1;

  // Renders the pill contents. The `active` flag is set when the
  // dropdown is open so the JSX can force the same "lifted" text +
  // icon colour the hover state uses (we can't rely on `:hover` for
  // the dropdown-open case).
  const renderBody = (active: boolean) => (
    <>
      {parts.map((part, index) => (
        <React.Fragment key={part}>
          {index > 0 && (
            <span
              className={
                active ? "text-text-1" : "text-text-4 group-hover:text-text-1"
              }
            >
              ·
            </span>
          )}
          <span className={active ? "text-text-1" : "group-hover:text-text-1"}>
            {part}
          </span>
        </React.Fragment>
      ))}
      <Pencil
        className={`ml-0.5 ${
          active ? "text-text-1" : "text-text-3 group-hover:text-text-1"
        }`}
        size={11}
      />
    </>
  );

  if (!editable || !onApply) {
    return <span className={pillClasses}>{renderBody(false)}</span>;
  }

  return (
    <ModelPropertiesDropdown
      variantOptions={variantOptions}
      value={modelId}
      onApply={onApply}
      centerInContainer
      renderTrigger={({ ref, onClick, ariaExpanded }) => {
        const isActive = ariaExpanded;
        return (
          <button
            ref={ref}
            type="button"
            onClick={onClick}
            aria-expanded={ariaExpanded}
            aria-label="Edit variant"
            // `group` enables `group-hover:` text/icon lifts on the
            // nested label · separator · pencil. When the dropdown is
            // open (`isActive`), we pin the lifted colours via JSX so
            // the pill stays in its "active" appearance without
            // depending on the cursor staying inside.
            className={`${pillClasses} group cursor-pointer hover:border-border-3 hover:bg-fill-4 ${
              isActive ? "border-border-3 bg-fill-4" : ""
            }`}
          >
            {renderBody(isActive)}
          </button>
        );
      }}
    />
  );
};

export default VariantPill;
