/**
 * Codex CLI Configuration Section
 *
 * Reads and writes `~/.codex/config.toml` via Tauri IPC commands.
 * Surfaces the most common configuration options from the Codex config
 * reference: model, approval policy, sandbox mode, web search, reasoning
 * effort, personality, and feature flags.
 */
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { rpc } from "@src/api/tauri/rpc";
import Input from "@src/components/Input";
import Select from "@src/components/Select";
import Switch from "@src/components/Switch";
import {
  SECTION_CONTROL_STYLE,
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";
import { Placeholder } from "@src/modules/shared/layouts/blocks";

// ── Codex config option values ──

const APPROVAL_POLICIES = ["untrusted", "on-request", "never"] as const;
type ApprovalPolicy = (typeof APPROVAL_POLICIES)[number];

const SANDBOX_MODES = [
  "read-only",
  "workspace-write",
  "danger-full-access",
] as const;
type SandboxMode = (typeof SANDBOX_MODES)[number];

const WEB_SEARCH_MODES = ["disabled", "cached", "live"] as const;
type WebSearchMode = (typeof WEB_SEARCH_MODES)[number];

const REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;
type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

const PERSONALITIES = ["friendly", "pragmatic", "none"] as const;
type Personality = (typeof PERSONALITIES)[number];

const FEATURE_FLAG_KEYS = [
  "shell_snapshot",
  "multi_agent",
  "collaboration_modes",
  "undo",
  "shell_tool",
  "personality",
] as const;

// ── Parsed config shape ──

interface CodexConfig {
  model?: string;
  approval_policy?: ApprovalPolicy;
  sandbox_mode?: SandboxMode;
  web_search?: WebSearchMode;
  model_reasoning_effort?: ReasoningEffort;
  personality?: Personality;
  features?: Record<string, boolean>;
}

// ── Component ──

const CodexConfigSection: React.FC = () => {
  const { t } = useTranslation("integrations");

  const [config, setConfig] = useState<CodexConfig>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    rpc.agentOrgs.codex
      .readConfig()
      .then((raw) => {
        if (!cancelled) {
          setConfig(raw as CodexConfig);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback(async (partial: Record<string, unknown>) => {
    setConfig((prev) => ({ ...prev, ...partial }));
    await rpc.agentOrgs.codex.writeConfigPartial({ partial });
  }, []);

  const updateFeature = useCallback(async (key: string, value: boolean) => {
    setConfig((prev) => ({
      ...prev,
      features: { ...prev.features, [key]: value },
    }));
    await rpc.agentOrgs.codex.writeConfigPartial({
      partial: { features: { [key]: value } },
    });
  }, []);

  if (loading) return <Placeholder variant="loading" />;

  const approvalOptions = APPROVAL_POLICIES.map((val) => ({
    label: t(`agentOrgs.codexConfig.approvalPolicy.${val}`),
    value: val,
  }));

  const sandboxOptions = SANDBOX_MODES.map((val) => ({
    label: t(`agentOrgs.codexConfig.sandboxMode.${val}`),
    value: val,
  }));

  const webSearchOptions = WEB_SEARCH_MODES.map((val) => ({
    label: t(`agentOrgs.codexConfig.webSearch.${val}`),
    value: val,
  }));

  const reasoningOptions = REASONING_EFFORTS.map((val) => ({
    label: t(`agentOrgs.codexConfig.reasoningEffort.${val}`),
    value: val,
  }));

  const personalityOptions = PERSONALITIES.map((val) => ({
    label: t(`agentOrgs.codexConfig.personality.${val}`),
    value: val,
  }));

  const features = config.features ?? {};

  return (
    <div className="flex flex-col gap-3">
      <SectionContainer>
        <SectionRow
          label={t("agentOrgs.codexConfig.model")}
          description={t("agentOrgs.codexConfig.modelDesc")}
        >
          <Input
            value={config.model ?? ""}
            onChange={(val: string) => update({ model: val || undefined })}
            placeholder="o4-mini"
            style={SECTION_CONTROL_STYLE}
          />
        </SectionRow>
        <SectionRow
          label={t("agentOrgs.codexConfig.approvalPolicyLabel")}
          description={t("agentOrgs.codexConfig.approvalPolicyDesc")}
        >
          <Select
            value={config.approval_policy ?? "on-request"}
            options={approvalOptions}
            onChange={(val) =>
              update({ approval_policy: val as ApprovalPolicy })
            }
            style={SECTION_CONTROL_STYLE}
          />
        </SectionRow>
        <SectionRow
          label={t("agentOrgs.codexConfig.sandboxModeLabel")}
          description={t("agentOrgs.codexConfig.sandboxModeDesc")}
        >
          <Select
            value={config.sandbox_mode ?? "workspace-write"}
            options={sandboxOptions}
            onChange={(val) => update({ sandbox_mode: val as SandboxMode })}
            style={SECTION_CONTROL_STYLE}
          />
        </SectionRow>
        <SectionRow
          label={t("agentOrgs.codexConfig.webSearchLabel")}
          description={t("agentOrgs.codexConfig.webSearchDesc")}
        >
          <Select
            value={config.web_search ?? "cached"}
            options={webSearchOptions}
            onChange={(val) => update({ web_search: val as WebSearchMode })}
            style={SECTION_CONTROL_STYLE}
          />
        </SectionRow>
      </SectionContainer>

      <SectionContainer title={t("agentOrgs.codexConfig.reasoningTitle")}>
        <SectionRow
          label={t("agentOrgs.codexConfig.reasoningEffortLabel")}
          description={t("agentOrgs.codexConfig.reasoningEffortDesc")}
        >
          <Select
            value={config.model_reasoning_effort ?? ""}
            options={[
              { label: t("agentOrgs.codexConfig.unset"), value: "" },
              ...reasoningOptions,
            ]}
            onChange={(val) =>
              update({
                model_reasoning_effort: (val as ReasoningEffort) || undefined,
              })
            }
            style={SECTION_CONTROL_STYLE}
          />
        </SectionRow>
        <SectionRow
          label={t("agentOrgs.codexConfig.personalityLabel")}
          description={t("agentOrgs.codexConfig.personalityDesc")}
        >
          <Select
            value={config.personality ?? ""}
            options={[
              { label: t("agentOrgs.codexConfig.unset"), value: "" },
              ...personalityOptions,
            ]}
            onChange={(val) =>
              update({ personality: (val as Personality) || undefined })
            }
            style={SECTION_CONTROL_STYLE}
          />
        </SectionRow>
      </SectionContainer>

      <SectionContainer title={t("agentOrgs.codexConfig.featuresTitle")}>
        {FEATURE_FLAG_KEYS.map((key) => (
          <SectionRow
            key={key}
            label={t(`agentOrgs.codexConfig.features.${key}`)}
            description={t(`agentOrgs.codexConfig.features.${key}Desc`)}
          >
            <Switch
              checked={features[key] ?? false}
              onChange={(checked) => updateFeature(key, checked)}
            />
          </SectionRow>
        ))}
      </SectionContainer>
    </div>
  );
};

export default CodexConfigSection;
