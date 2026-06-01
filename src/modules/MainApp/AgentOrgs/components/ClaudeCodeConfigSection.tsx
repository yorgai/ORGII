/**
 * Claude Code Configuration Section
 *
 * Reads and writes `~/.claude/settings.json` via Tauri IPC commands.
 * Surfaces the most common user-level configuration options:
 *   - Permissions (allow / deny / ask)
 *   - Model selection
 *   - Sandbox (enabled, auto-allow, excluded commands, filesystem, network)
 *   - Attribution (commit / PR messages)
 *   - General (thinking mode, git instructions, cleanup, language)
 *
 * @see https://code.claude.com/docs/en/settings
 */
import { Plus, Trash2 } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { rpc } from "@src/api/tauri/rpc";
import Button from "@src/components/Button";
import Input from "@src/components/Input";
import NumberInput from "@src/components/NumberInput";
import Select from "@src/components/Select";
import Switch from "@src/components/Switch";
import {
  SECTION_CONTROL_STYLE,
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";
import { Placeholder } from "@src/modules/shared/layouts/blocks";

// ── Claude Code config types ──

const PERMISSION_MODES = [
  "default",
  "plan",
  "acceptEdits",
  "bypassPermissions",
] as const;
type PermissionMode = (typeof PERMISSION_MODES)[number];

interface ClaudeCodeConfig {
  model?: string;
  permissions?: {
    allow?: string[];
    deny?: string[];
    ask?: string[];
    defaultMode?: PermissionMode;
  };
  sandbox?: {
    enabled?: boolean;
    autoAllowBashIfSandboxed?: boolean;
    excludedCommands?: string[];
    filesystem?: {
      allowWrite?: string[];
      denyWrite?: string[];
      denyRead?: string[];
    };
    network?: {
      allowedDomains?: string[];
      allowLocalBinding?: boolean;
      allowAllUnixSockets?: boolean;
    };
  };
  attribution?: {
    commit?: string;
    pr?: string;
  };
  includeCoAuthoredBy?: boolean;
  includeGitInstructions?: boolean;
  alwaysThinkingEnabled?: boolean;
  cleanupPeriodDays?: number;
  language?: string;
  env?: Record<string, string>;
}

// ── String list editor (permissions, domains, commands, paths) ──

interface StringListProps {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
}

const StringList: React.FC<StringListProps> = ({
  label,
  items,
  onChange,
  placeholder,
}) => {
  const { t } = useTranslation("integrations");

  const handleAdd = useCallback(() => {
    onChange([...items, ""]);
  }, [items, onChange]);

  const handleRemove = useCallback(
    (index: number) => {
      onChange(items.filter((_, idx) => idx !== index));
    },
    [items, onChange]
  );

  const handleUpdate = useCallback(
    (index: number, value: string) => {
      onChange(items.map((item, idx) => (idx === index ? value : item)));
    },
    [items, onChange]
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-text-1">{label}</span>
        <Button size="small" icon={<Plus size={12} />} onClick={handleAdd}>
          {t("common:actions.add")}
        </Button>
      </div>
      {items.length === 0 ? (
        <span className="text-xs text-text-3">
          {t("agentOrgs.claudeCodeConfig.noItems")}
        </span>
      ) : (
        <div className="flex flex-col gap-1.5">
          {items.map((item, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                value={item}
                onChange={(val: string) => handleUpdate(index, val)}
                placeholder={placeholder}
                className="flex-1"
                size="small"
              />
              <Button
                size="small"
                icon={<Trash2 size={12} className="text-danger-6" />}
                iconOnly
                onClick={() => handleRemove(index)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Main component ──

const ClaudeCodeConfigSection: React.FC = () => {
  const { t } = useTranslation("integrations");

  const [config, setConfig] = useState<ClaudeCodeConfig>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    rpc.agentOrgs.claudeCode
      .readConfig()
      .then((raw) => {
        if (cancelled) return;
        setConfig(raw as ClaudeCodeConfig);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const updateConfig = useCallback(async (partial: Record<string, unknown>) => {
    setConfig((prev) => ({ ...prev, ...partial }));
    await rpc.agentOrgs.claudeCode.writeConfigPartial({ partial });
  }, []);

  const permissionModeOptions = useMemo(
    () =>
      PERMISSION_MODES.map((val) => ({
        label: t(`agentOrgs.claudeCodeConfig.permissionMode.${val}`),
        value: val,
      })),
    [t]
  );

  if (loading) return <Placeholder variant="loading" />;

  const permissions = config.permissions ?? {};
  const sandbox = config.sandbox ?? {};
  const sandboxFs = sandbox.filesystem ?? {};
  const sandboxNet = sandbox.network ?? {};
  const attribution = config.attribution ?? {};

  return (
    <div className="flex flex-col gap-3">
      {/* General */}
      <SectionContainer>
        <SectionRow
          label={t("agentOrgs.claudeCodeConfig.model")}
          description={t("agentOrgs.claudeCodeConfig.modelDesc")}
        >
          <Input
            value={config.model ?? ""}
            onChange={(val: string) =>
              updateConfig({ model: val || undefined })
            }
            placeholder="claude-sonnet-4-6"
            style={SECTION_CONTROL_STYLE}
          />
        </SectionRow>
        <SectionRow
          label={t("agentOrgs.claudeCodeConfig.thinkingMode")}
          description={t("agentOrgs.claudeCodeConfig.thinkingModeDesc")}
        >
          <Switch
            checked={config.alwaysThinkingEnabled ?? false}
            onChange={(checked) =>
              updateConfig({ alwaysThinkingEnabled: checked })
            }
          />
        </SectionRow>
        <SectionRow
          label={t("agentOrgs.claudeCodeConfig.gitInstructions")}
          description={t("agentOrgs.claudeCodeConfig.gitInstructionsDesc")}
        >
          <Switch
            checked={config.includeGitInstructions ?? true}
            onChange={(checked) =>
              updateConfig({ includeGitInstructions: checked })
            }
          />
        </SectionRow>
        <SectionRow
          label={t("agentOrgs.claudeCodeConfig.cleanupPeriod")}
          description={t("agentOrgs.claudeCodeConfig.cleanupPeriodDesc")}
        >
          <NumberInput
            value={config.cleanupPeriodDays ?? 30}
            onChange={(val) => {
              if (val !== undefined) updateConfig({ cleanupPeriodDays: val });
            }}
            min={0}
            max={365}
            step={1}
            suffix={t("agentOrgs.claudeCodeConfig.days")}
            controlsPosition="sides"
            style={SECTION_CONTROL_STYLE}
          />
        </SectionRow>
        <SectionRow
          label={t("agentOrgs.claudeCodeConfig.language")}
          description={t("agentOrgs.claudeCodeConfig.languageDesc")}
        >
          <Input
            value={config.language ?? ""}
            onChange={(val: string) =>
              updateConfig({ language: val || undefined })
            }
            placeholder="english"
            style={SECTION_CONTROL_STYLE}
          />
        </SectionRow>
      </SectionContainer>

      {/* Attribution */}
      <SectionContainer
        title={t("agentOrgs.claudeCodeConfig.attributionTitle")}
      >
        <SectionRow
          label={t("agentOrgs.claudeCodeConfig.commitAttribution")}
          description={t("agentOrgs.claudeCodeConfig.commitAttributionDesc")}
        >
          <Input
            value={attribution.commit ?? ""}
            onChange={(val: string) =>
              updateConfig({
                attribution: { ...attribution, commit: val },
              })
            }
            placeholder="🤖 Generated with Claude Code"
            style={SECTION_CONTROL_STYLE}
          />
        </SectionRow>
        <SectionRow
          label={t("agentOrgs.claudeCodeConfig.prAttribution")}
          description={t("agentOrgs.claudeCodeConfig.prAttributionDesc")}
        >
          <Input
            value={attribution.pr ?? ""}
            onChange={(val: string) =>
              updateConfig({
                attribution: { ...attribution, pr: val },
              })
            }
            placeholder=""
            style={SECTION_CONTROL_STYLE}
          />
        </SectionRow>
        <SectionRow
          label={t("agentOrgs.claudeCodeConfig.coAuthoredBy")}
          description={t("agentOrgs.claudeCodeConfig.coAuthoredByDesc")}
        >
          <Switch
            checked={config.includeCoAuthoredBy ?? true}
            onChange={(checked) =>
              updateConfig({ includeCoAuthoredBy: checked })
            }
          />
        </SectionRow>
      </SectionContainer>

      {/* Permissions */}
      <SectionContainer
        title={t("agentOrgs.claudeCodeConfig.permissionsTitle")}
      >
        <SectionRow
          label={t("agentOrgs.claudeCodeConfig.defaultMode")}
          description={t("agentOrgs.claudeCodeConfig.defaultModeDesc")}
        >
          <Select
            value={permissions.defaultMode ?? "default"}
            options={permissionModeOptions}
            onChange={(val) =>
              updateConfig({
                permissions: {
                  ...permissions,
                  defaultMode: val as PermissionMode,
                },
              })
            }
            style={SECTION_CONTROL_STYLE}
          />
        </SectionRow>
        <SectionRow layout="vertical">
          <StringList
            label={t("agentOrgs.claudeCodeConfig.permAllow")}
            items={permissions.allow ?? []}
            onChange={(allow) =>
              updateConfig({ permissions: { ...permissions, allow } })
            }
            placeholder="Bash(npm run lint), Read(src/**)"
          />
        </SectionRow>
        <SectionRow layout="vertical">
          <StringList
            label={t("agentOrgs.claudeCodeConfig.permAsk")}
            items={permissions.ask ?? []}
            onChange={(ask) =>
              updateConfig({ permissions: { ...permissions, ask } })
            }
            placeholder="Bash(git push *)"
          />
        </SectionRow>
        <SectionRow layout="vertical">
          <StringList
            label={t("agentOrgs.claudeCodeConfig.permDeny")}
            items={permissions.deny ?? []}
            onChange={(deny) =>
              updateConfig({ permissions: { ...permissions, deny } })
            }
            placeholder="Bash(curl *), Read(.env), Read(./secrets/**)"
          />
        </SectionRow>
      </SectionContainer>

      {/* Sandbox */}
      <SectionContainer title={t("agentOrgs.claudeCodeConfig.sandboxTitle")}>
        <SectionRow
          label={t("agentOrgs.claudeCodeConfig.sandboxEnabled")}
          description={t("agentOrgs.claudeCodeConfig.sandboxEnabledDesc")}
        >
          <Switch
            checked={sandbox.enabled ?? false}
            onChange={(checked) =>
              updateConfig({ sandbox: { ...sandbox, enabled: checked } })
            }
          />
        </SectionRow>
        {sandbox.enabled && (
          <>
            <SectionRow
              label={t("agentOrgs.claudeCodeConfig.autoAllowBash")}
              description={t("agentOrgs.claudeCodeConfig.autoAllowBashDesc")}
              indent
            >
              <Switch
                checked={sandbox.autoAllowBashIfSandboxed ?? true}
                onChange={(checked) =>
                  updateConfig({
                    sandbox: {
                      ...sandbox,
                      autoAllowBashIfSandboxed: checked,
                    },
                  })
                }
              />
            </SectionRow>
            <SectionRow
              label={t("agentOrgs.claudeCodeConfig.allowLocalBinding")}
              description={t(
                "agentOrgs.claudeCodeConfig.allowLocalBindingDesc"
              )}
              indent
            >
              <Switch
                checked={sandboxNet.allowLocalBinding ?? false}
                onChange={(checked) =>
                  updateConfig({
                    sandbox: {
                      ...sandbox,
                      network: {
                        ...sandboxNet,
                        allowLocalBinding: checked,
                      },
                    },
                  })
                }
              />
            </SectionRow>
            <SectionRow layout="vertical" indent>
              <StringList
                label={t("agentOrgs.claudeCodeConfig.excludedCommands")}
                items={sandbox.excludedCommands ?? []}
                onChange={(excludedCommands) =>
                  updateConfig({
                    sandbox: { ...sandbox, excludedCommands },
                  })
                }
                placeholder="git, docker"
              />
            </SectionRow>
            <SectionRow layout="vertical" indent>
              <StringList
                label={t("agentOrgs.claudeCodeConfig.allowedDomains")}
                items={sandboxNet.allowedDomains ?? []}
                onChange={(allowedDomains) =>
                  updateConfig({
                    sandbox: {
                      ...sandbox,
                      network: { ...sandboxNet, allowedDomains },
                    },
                  })
                }
                placeholder="github.com, *.npmjs.org"
              />
            </SectionRow>
            <SectionRow layout="vertical" indent>
              <StringList
                label={t("agentOrgs.claudeCodeConfig.fsAllowWrite")}
                items={sandboxFs.allowWrite ?? []}
                onChange={(allowWrite) =>
                  updateConfig({
                    sandbox: {
                      ...sandbox,
                      filesystem: { ...sandboxFs, allowWrite },
                    },
                  })
                }
                placeholder="//tmp/build, ~/.kube"
              />
            </SectionRow>
            <SectionRow layout="vertical" indent>
              <StringList
                label={t("agentOrgs.claudeCodeConfig.fsDenyWrite")}
                items={sandboxFs.denyWrite ?? []}
                onChange={(denyWrite) =>
                  updateConfig({
                    sandbox: {
                      ...sandbox,
                      filesystem: { ...sandboxFs, denyWrite },
                    },
                  })
                }
                placeholder="//etc, //usr/local/bin"
              />
            </SectionRow>
            <SectionRow layout="vertical" indent>
              <StringList
                label={t("agentOrgs.claudeCodeConfig.fsDenyRead")}
                items={sandboxFs.denyRead ?? []}
                onChange={(denyRead) =>
                  updateConfig({
                    sandbox: {
                      ...sandbox,
                      filesystem: { ...sandboxFs, denyRead },
                    },
                  })
                }
                placeholder="~/.aws/credentials"
              />
            </SectionRow>
          </>
        )}
      </SectionContainer>
    </div>
  );
};

export default ClaudeCodeConfigSection;
