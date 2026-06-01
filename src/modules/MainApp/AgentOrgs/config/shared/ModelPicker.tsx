/**
 * ModelPicker — single-select dropdown over registered models.
 *
 * Lists only models that come from currently configured KeyVault
 * accounts. Disallows free-form entry — the user must pick a model
 * that the runtime can actually reach. Pass `allowEmpty` to render a
 * clear-selection option.
 */
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import ModelIcon from "@src/components/ModelIcon";
import Select, { type SelectOptionGroup } from "@src/components/Select";
import {
  buildAccountLookup,
  getRustCompatibleAccounts,
  useAgentCompatibility,
  useModelAccountLookup,
} from "@src/hooks/models";
import { formatModelNameFull } from "@src/util/formatModelName";

interface ModelPickerProps {
  value: string | null | undefined;
  onChange: (modelId: string | null) => void;
  placeholder?: string;
  allowEmpty?: boolean;
  disabled?: boolean;
  className?: string;
}

const SENTINEL_EMPTY = "__model_picker_clear__";

const ModelPicker: React.FC<ModelPickerProps> = ({
  value,
  onChange,
  placeholder,
  allowEmpty = true,
  disabled,
  className,
}) => {
  const { t } = useTranslation("settings");
  const { accounts: allAccounts } = useModelAccountLookup();
  const { registry } = useAgentCompatibility();

  const accounts = useMemo(
    () => getRustCompatibleAccounts(registry, allAccounts),
    [registry, allAccounts]
  );

  const accountLookup = useMemo(() => buildAccountLookup(accounts), [accounts]);

  const optionGroups = useMemo<SelectOptionGroup[]>(() => {
    const options = Array.from(accountLookup.entries())
      .sort(([idA], [idB]) => idA.localeCompare(idB))
      .map(([modelId]) => {
        const label = (
          <span className="flex items-center gap-2">
            <ModelIcon modelName={modelId} size="small" />
            <span className="truncate">{formatModelNameFull(modelId)}</span>
          </span>
        );
        return { value: modelId, label, triggerLabel: label };
      });

    if (allowEmpty) {
      return [
        {
          label: "",
          options: [
            {
              value: SENTINEL_EMPTY,
              label: t("sharedAgentConfig.modelPicker.useDefault"),
            },
            ...options,
          ],
        },
      ];
    }
    return [{ label: "", options }];
  }, [accountLookup, allowEmpty, t]);

  return (
    <Select
      value={value || (allowEmpty ? SENTINEL_EMPTY : undefined)}
      options={optionGroups}
      onChange={(val) => {
        const next = String(val);
        onChange(next === SENTINEL_EMPTY ? null : next);
      }}
      placeholder={
        placeholder ?? t("sharedAgentConfig.modelPicker.placeholder")
      }
      showSearch
      size="default"
      className={className}
      disabled={disabled}
    />
  );
};

export default ModelPicker;
