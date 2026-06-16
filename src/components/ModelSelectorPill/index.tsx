/**
 * ModelSelectorPill
 *
 * Shared model selector trigger used by the active chat input and the
 * SessionCreator input. Keeps model label, variant display, icon, and tooltip
 * behavior consistent across both surfaces.
 */
import { Brain, Grip } from "lucide-react";
import React, { forwardRef, useMemo } from "react";

import { isHostedKey } from "@src/api/tauri/session";
import {
  PILL_SM_ICON_SIZE,
  PILL_SM_LABEL_CLASS,
} from "@src/components/CompoundPill/config";
import ModelIcon from "@src/components/ModelIcon";
import ModelPillTooltipContent from "@src/components/ModelPillTooltipContent";
import SelectorPill from "@src/components/SelectorPill";
import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";
import { useModelPillLabel } from "@src/hooks/models";
import {
  accountHasModel,
  useModelAccountLookup,
} from "@src/hooks/models/useModelAccountLookup";
import type { LastModelSelection } from "@src/store/session/creatorDefaultModelAtom";
import { resolveDefaultVariant } from "@src/util/defaultModelVariant";
import { resolveModelVariantFields } from "@src/util/modelVariants";

export interface ModelSelectorPillProps {
  selection: LastModelSelection | null | undefined;
  defaultLabel: string;
  active: boolean;
  onClick: () => void;
  className?: string;
  dataTestId?: string;
  ariaLabel?: string;
  iconSize?: number;
  /** When false (browsing a historical session), skip variant resolution
   *  so the pill shows the session's original model, not a remapped variant. */
  isActiveSession?: boolean;
}

function resolveDisplaySelection(
  selection: LastModelSelection | null | undefined,
  accounts: ReturnType<typeof useModelAccountLookup>["accounts"],
  isActiveSession: boolean
): LastModelSelection | null | undefined {
  if (!selection || isHostedKey(selection.keySource) || !selection.model) {
    return selection;
  }
  if (!isActiveSession) return selection;

  const selectedAccount = accounts.find((account) => {
    if (selection.selectedAccountId) {
      return account.id === selection.selectedAccountId;
    }
    if (
      selection.selectedSourceModelType &&
      account.modelType !== selection.selectedSourceModelType
    ) {
      return false;
    }
    if (selection.selectedSourceLabel) {
      return account.name === selection.selectedSourceLabel;
    }
    return accountHasModel(account, selection.model ?? "");
  });
  if (!selectedAccount) return selection;

  const baseModel = resolveModelVariantFields(selection.model).base_model;
  const accountModelIds = (selectedAccount.availableModels ?? []).filter(
    (modelId) =>
      accountHasModel(selectedAccount, modelId) &&
      resolveModelVariantFields(modelId).base_model === baseModel
  );
  if (accountModelIds.length === 0) return selection;

  const persistedModel = (selectedAccount.defaultVariants ?? []).find(
    (variant) =>
      variant.base_model === baseModel &&
      accountModelIds.includes(variant.model)
  )?.model;
  const variantInfos = accountModelIds.map((modelId) =>
    resolveModelVariantFields(modelId)
  );
  const effectiveModel = resolveDefaultVariant(
    baseModel,
    variantInfos,
    persistedModel
  );
  if (!effectiveModel || effectiveModel === selection.model) return selection;

  return { ...selection, model: effectiveModel };
}

const ModelSelectorPill = forwardRef<HTMLButtonElement, ModelSelectorPillProps>(
  (
    {
      selection,
      defaultLabel,
      active,
      onClick,
      className,
      dataTestId,
      ariaLabel,
      iconSize = PILL_SM_ICON_SIZE,
      isActiveSession = false,
    },
    ref
  ) => {
    const { accounts } = useModelAccountLookup();
    const displaySelection = useMemo(
      () => resolveDisplaySelection(selection, accounts, isActiveSession),
      [accounts, selection, isActiveSession]
    );

    const {
      label: modelLabel,
      title: modelTitle,
      accountName,
      displayParts,
    } = useModelPillLabel(displaySelection, defaultLabel);

    const modelIconName = useMemo(
      () =>
        displaySelection?.listingModel || displaySelection?.model || undefined,
      [displaySelection]
    );
    const modelIconAgent = useMemo(
      () =>
        displaySelection?.listingModelType ??
        displaySelection?.selectedSourceModelType,
      [displaySelection]
    );
    const hasModelSelection = Boolean(modelIconName);

    const modelLabelContent = useMemo(() => {
      const hasVariantInfo =
        displayParts.thinking || Boolean(displayParts.variantInfo);
      if (!hasVariantInfo) return modelLabel;

      const accentClass = active ? "text-primary-6" : "text-text-3";

      return (
        <span
          className={`inline-flex min-w-0 items-center gap-1.5 ${PILL_SM_LABEL_CLASS}`}
        >
          <span className={`min-w-0 truncate ${PILL_SM_LABEL_CLASS}`}>
            {displayParts.label}
          </span>
          {displayParts.variantInfo && (
            <span
              className={`inline-flex shrink-0 items-center text-[12px] font-normal ${PILL_SM_LABEL_CLASS} ${accentClass}`}
            >
              {displayParts.variantInfo}
            </span>
          )}
          {displayParts.thinking && (
            <span
              className={`inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center ${accentClass}`}
            >
              <Brain size={14} strokeWidth={1.5} />
            </span>
          )}
        </span>
      );
    }, [displayParts, modelLabel, active]);

    return (
      <SelectorPill
        ref={ref}
        icon={
          hasModelSelection ? (
            <ModelIcon
              modelName={modelIconName}
              agentType={modelIconAgent}
              size={iconSize}
            />
          ) : (
            <Grip
              size={iconSize}
              strokeWidth={1.75}
              className="text-primary-6"
            />
          )
        }
        label={modelLabel}
        labelContent={modelLabelContent}
        title={modelTitle}
        tooltip={
          <ModelPillTooltipContent
            accountName={accountName}
            modelLabel={displayParts.rawValue ?? displayParts.label}
            modelId={modelIconName}
            modelType={modelIconAgent}
            variantInfo={
              displayParts.rawValue ? undefined : displayParts.variantInfo
            }
            thinking={displayParts.rawValue ? false : displayParts.thinking}
            shortcut={getShortcutKeys("open_model_selector")}
          />
        }
        tooltipFramed
        active={active}
        danger={!hasModelSelection}
        className={className}
        onClick={onClick}
        dataTestId={dataTestId}
        ariaLabel={ariaLabel}
      />
    );
  }
);

ModelSelectorPill.displayName = "ModelSelectorPill";

export default ModelSelectorPill;
