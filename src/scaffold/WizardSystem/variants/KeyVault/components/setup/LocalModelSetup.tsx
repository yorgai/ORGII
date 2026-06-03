import { Check, MessageSquare, Server, Sparkles } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { LOCAL_MODEL_PROVIDER } from "@src/api/types/keys";
import Button from "@src/components/Button";
import InlineAlert from "@src/components/InlineAlert";
import Input from "@src/components/Input";
import Select from "@src/components/Select";
import {
  SECTION_GAP_CLASSES,
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";
import {
  SelectionGrid,
  type SelectionGridOption,
} from "@src/scaffold/WizardSystem/primitives";

import type { AgentSetupProps } from "./types";

type LocalRuntime = "ollama" | "lm_studio" | "vllm" | "llamacpp" | "custom";

type LocalPreset = {
  runtime: LocalRuntime;
  baseUrl: string;
  apiKey: string;
  models: string[];
};

const DEFAULT_LOCAL_ACCOUNT_NAME = "Local Models";

const LOCAL_PRESETS: Record<LocalRuntime, LocalPreset> = {
  ollama: {
    runtime: "ollama",
    baseUrl: "http://localhost:11434/v1",
    apiKey: "ollama-local",
    models: ["llama3.2", "qwen2.5", "mistral"],
  },
  lm_studio: {
    runtime: "lm_studio",
    baseUrl: "http://localhost:1234/v1",
    apiKey: "lm-studio-local",
    models: ["local-model"],
  },
  vllm: {
    runtime: "vllm",
    baseUrl: "http://localhost:8000/v1",
    apiKey: "vllm-local",
    models: ["meta-llama/Llama-3.1-8B-Instruct"],
  },
  llamacpp: {
    runtime: "llamacpp",
    baseUrl: "http://localhost:8080/v1",
    apiKey: "llama-cpp-local",
    models: ["local-gguf"],
  },
  custom: {
    runtime: "custom",
    baseUrl: "http://localhost:8000/v1",
    apiKey: "local-model",
    models: ["local-model"],
  },
};

function mergeUniqueModels(existingModels: string[], presetModels: string[]) {
  const merged = [...existingModels];
  for (const model of presetModels) {
    if (!merged.includes(model)) merged.push(model);
  }
  return merged;
}

const LocalModelSetup: React.FC<AgentSetupProps> = ({
  data,
  onChange,
  keyValidated,
  validatingKey,
  validateKey,
}) => {
  const { t } = useTranslation("integrations");

  const runtimeOptions = useMemo<SelectionGridOption<LocalRuntime>[]>(
    () => [
      {
        key: "ollama",
        label: t("keyVault.localModel.presets.ollama"),
        description: t("keyVault.localModel.presets.ollamaDesc"),
        icon: Sparkles,
      },
      {
        key: "lm_studio",
        label: t("keyVault.localModel.presets.lmStudio"),
        description: t("keyVault.localModel.presets.lmStudioDesc"),
        icon: MessageSquare,
      },
      {
        key: "vllm",
        label: t("keyVault.localModel.presets.vllm"),
        description: t("keyVault.localModel.presets.vllmDesc"),
        icon: Server,
      },
      {
        key: "llamacpp",
        label: t("keyVault.localModel.presets.llamaCpp"),
        description: t("keyVault.localModel.presets.llamaCppDesc"),
        icon: Server,
      },
      {
        key: "custom",
        label: t("keyVault.localModel.presets.custom"),
        description: t("keyVault.localModel.presets.customDesc"),
        icon: Server,
      },
    ],
    [t]
  );

  const [selectedRuntime, setSelectedRuntime] = useState<LocalRuntime>(() => {
    const currentUrl = data.extracted_base_url;
    const match = Object.values(LOCAL_PRESETS).find(
      (preset) => preset.baseUrl === currentUrl
    );
    return match?.runtime ?? "ollama";
  });

  useEffect(() => {
    if (data.name.trim() || data.agent_type !== LOCAL_MODEL_PROVIDER) return;
    onChange({ name: DEFAULT_LOCAL_ACCOUNT_NAME });
  }, [data.agent_type, data.name, onChange]);

  const applyPreset = (runtime: LocalRuntime) => {
    const preset = LOCAL_PRESETS[runtime];
    setSelectedRuntime(runtime);
    onChange({
      raw_key_input: data.raw_key_input.trim() || preset.apiKey,
      extracted_base_url: preset.baseUrl,
      custom_models: mergeUniqueModels(data.custom_models ?? [], preset.models),
      enabled_models: mergeUniqueModels(
        data.enabled_models ?? [],
        preset.models
      ),
      validated: false,
    });
  };

  const modelQuickAddOptions = useMemo(
    () =>
      LOCAL_PRESETS[selectedRuntime].models.map((model) => ({
        value: model,
        label: model,
      })),
    [selectedRuntime]
  );

  const addModel = (model: string) => {
    const trimmedModel = model.trim();
    if (!trimmedModel) return;
    onChange({
      custom_models: mergeUniqueModels(data.custom_models ?? [], [
        trimmedModel,
      ]),
      enabled_models: mergeUniqueModels(data.enabled_models ?? [], [
        trimmedModel,
      ]),
    });
  };

  return (
    <div className={SECTION_GAP_CLASSES}>
      <InlineAlert type="info" title={t("keyVault.localModel.title")}>
        {t("keyVault.localModel.description")}
      </InlineAlert>

      <SectionContainer>
        <SectionRow
          label={t("keyVault.localModel.runtimeLabel")}
          description={t("keyVault.localModel.runtimeDesc")}
          layout="vertical"
          required
        >
          <SelectionGrid
            options={runtimeOptions}
            selected={selectedRuntime}
            cardVariant="subtle"
            onSelect={applyPreset}
          />
        </SectionRow>

        <SectionRow
          label={t("keyVault.baseUrlLabel")}
          description={t("keyVault.localModel.baseUrlDesc")}
          layout="vertical"
          required
        >
          <Input
            value={
              data.extracted_base_url || LOCAL_PRESETS[selectedRuntime].baseUrl
            }
            onChange={(value) =>
              onChange({ extracted_base_url: value, validated: false })
            }
            placeholder={LOCAL_PRESETS[selectedRuntime].baseUrl}
            size="default"
            className="w-full"
          />
        </SectionRow>

        <SectionRow
          label={t("keyVault.apiKeyLabel")}
          description={t("keyVault.localModel.apiKeyDesc")}
          layout="vertical"
          required
        >
          <Input
            value={data.raw_key_input}
            onChange={(value) =>
              onChange({ raw_key_input: value, validated: false })
            }
            placeholder={LOCAL_PRESETS[selectedRuntime].apiKey}
            size="default"
            className="w-full"
          />
        </SectionRow>
      </SectionContainer>

      <SectionContainer>
        <SectionRow
          label={t("keyVault.localModel.quickModelsLabel")}
          description={t("keyVault.localModel.quickModelsDesc")}
          required
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Select
              value=""
              placeholder={t("keyVault.localModel.quickModelsPlaceholder")}
              options={modelQuickAddOptions}
              onChange={(value) => addModel(value as string)}
              size="default"
              className="min-w-0 flex-1"
            />
            <Button
              variant="secondary"
              appearance="outline"
              size="default"
              icon={<Check size={14} />}
              onClick={() => addModel(LOCAL_PRESETS[selectedRuntime].models[0])}
            >
              {t("keyVault.localModel.addSuggestedModel")}
            </Button>
          </div>
        </SectionRow>

        <SectionRow
          label={t("keyVault.validate", "Validate")}
          description={t("keyVault.localModel.validateDesc")}
          required
        >
          <Button
            variant={keyValidated ? "success" : "primary"}
            appearance={keyValidated ? "outline" : undefined}
            size="default"
            loading={validatingKey}
            disabled={
              validatingKey || !data.raw_key_input || !data.extracted_base_url
            }
            onClick={validateKey}
            className="h-8 min-h-8"
          >
            {keyValidated
              ? `✓ ${t("keyVault.validated", "Validated")}`
              : t("keyVault.validate", "Validate")}
          </Button>
        </SectionRow>
      </SectionContainer>
    </div>
  );
};

export { LocalModelSetup };
