/**
 * Cursor CLI Configuration Section
 *
 * Reads and writes `~/.cursor/cli-config.json` and `~/.cursor/sandbox.json`
 * via Tauri IPC commands. Surfaces the most common configuration options
 * from the Cursor CLI config reference:
 *   - Vim mode, permissions, sandbox, network, attribution
 *
 * @see https://cursor.com/docs/cli/reference/configuration
 * @see https://cursor.com/docs/reference/sandbox
 */
import { Plus, Trash2 } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { rpc } from "@src/api/tauri/rpc";
import Button from "@src/components/Button";
import Input from "@src/components/Input";
import Select from "@src/components/Select";
import Switch from "@src/components/Switch";
import {
  SECTION_CONTROL_STYLE,
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";
import { Placeholder } from "@src/modules/shared/layouts/blocks";

// ── Cursor CLI config types ──

const SANDBOX_TYPES = [
  "workspace_readwrite",
  "workspace_readonly",
  "insecure_none",
] as const;
type SandboxType = (typeof SANDBOX_TYPES)[number];

const NETWORK_DEFAULTS = ["allow", "deny"] as const;
type NetworkDefault = (typeof NETWORK_DEFAULTS)[number];

interface CursorCliConfig {
  version?: number;
  editor?: { vimMode?: boolean };
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
  model?: Record<string, unknown>;
  hasChangedDefaultModel?: boolean;
  network?: { useHttp1ForAgent?: boolean };
  attribution?: {
    attributeCommitsToAgent?: boolean;
    attributePRsToAgent?: boolean;
  };
}

interface CursorSandboxConfig {
  type?: SandboxType;
  additionalReadwritePaths?: string[];
  additionalReadonlyPaths?: string[];
  disableTmpWrite?: boolean;
  enableSharedBuildCache?: boolean;
  networkPolicy?: {
    default?: NetworkDefault;
    allow?: string[];
    deny?: string[];
  };
}

// ── Permission list editor ──

interface PermissionListProps {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
}

const PermissionList: React.FC<PermissionListProps> = ({
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
          {t("agentOrgs.cursorConfig.noPermissions")}
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

const CursorCliConfigSection: React.FC = () => {
  const { t } = useTranslation("integrations");

  const [config, setConfig] = useState<CursorCliConfig>({});
  const [sandbox, setSandbox] = useState<CursorSandboxConfig>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      rpc.agentOrgs.cursor.readConfig(),
      rpc.agentOrgs.cursor.readSandbox(),
    ])
      .then(([cliRaw, sandboxRaw]) => {
        if (cancelled) return;
        setConfig(cliRaw as CursorCliConfig);
        setSandbox(sandboxRaw as CursorSandboxConfig);
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
    await rpc.agentOrgs.cursor.writeConfigPartial({ partial });
  }, []);

  const updateSandbox = useCallback(
    async (partial: Record<string, unknown>) => {
      setSandbox((prev) => ({ ...prev, ...partial }));
      await rpc.agentOrgs.cursor.writeSandboxPartial({ partial });
    },
    []
  );

  const sandboxTypeOptions = useMemo(
    () =>
      SANDBOX_TYPES.map((val) => ({
        label: t(`agentOrgs.cursorConfig.sandboxType.${val}`),
        value: val,
      })),
    [t]
  );

  const networkDefaultOptions = useMemo(
    () =>
      NETWORK_DEFAULTS.map((val) => ({
        label: t(`agentOrgs.cursorConfig.networkDefault.${val}`),
        value: val,
      })),
    [t]
  );

  if (loading) return <Placeholder variant="loading" />;

  const permissions = config.permissions ?? { allow: [], deny: [] };
  const networkPolicy = sandbox.networkPolicy ?? {};

  return (
    <div className="flex flex-col gap-3">
      {/* Editor & General */}
      <SectionContainer>
        <SectionRow
          label={t("agentOrgs.cursorConfig.vimMode")}
          description={t("agentOrgs.cursorConfig.vimModeDesc")}
        >
          <Switch
            checked={config.editor?.vimMode ?? false}
            onChange={(checked) =>
              updateConfig({ editor: { vimMode: checked } })
            }
          />
        </SectionRow>
        <SectionRow
          label={t("agentOrgs.cursorConfig.http1Fallback")}
          description={t("agentOrgs.cursorConfig.http1FallbackDesc")}
        >
          <Switch
            checked={config.network?.useHttp1ForAgent ?? false}
            onChange={(checked) =>
              updateConfig({ network: { useHttp1ForAgent: checked } })
            }
          />
        </SectionRow>
      </SectionContainer>

      {/* Attribution */}
      <SectionContainer title={t("agentOrgs.cursorConfig.attributionTitle")}>
        <SectionRow
          label={t("agentOrgs.cursorConfig.attributeCommits")}
          description={t("agentOrgs.cursorConfig.attributeCommitsDesc")}
        >
          <Switch
            checked={config.attribution?.attributeCommitsToAgent ?? true}
            onChange={(checked) =>
              updateConfig({
                attribution: { attributeCommitsToAgent: checked },
              })
            }
          />
        </SectionRow>
        <SectionRow
          label={t("agentOrgs.cursorConfig.attributePRs")}
          description={t("agentOrgs.cursorConfig.attributePRsDesc")}
        >
          <Switch
            checked={config.attribution?.attributePRsToAgent ?? true}
            onChange={(checked) =>
              updateConfig({ attribution: { attributePRsToAgent: checked } })
            }
          />
        </SectionRow>
      </SectionContainer>

      {/* Permissions */}
      <SectionContainer title={t("agentOrgs.cursorConfig.permissionsTitle")}>
        <SectionRow
          label={t("agentOrgs.cursorConfig.permissionsAllow")}
          layout="vertical"
        >
          <PermissionList
            label={t("agentOrgs.cursorConfig.permissionsAllow")}
            items={permissions.allow ?? []}
            onChange={(allow) =>
              updateConfig({ permissions: { ...permissions, allow } })
            }
            placeholder="Shell(git), Read(src/**), Write(src/**)"
          />
        </SectionRow>
        <SectionRow
          label={t("agentOrgs.cursorConfig.permissionsDeny")}
          layout="vertical"
        >
          <PermissionList
            label={t("agentOrgs.cursorConfig.permissionsDeny")}
            items={permissions.deny ?? []}
            onChange={(deny) =>
              updateConfig({ permissions: { ...permissions, deny } })
            }
            placeholder="Shell(rm), Read(.env*), Write(**/*.key)"
          />
        </SectionRow>
      </SectionContainer>

      {/* Sandbox */}
      <SectionContainer title={t("agentOrgs.cursorConfig.sandboxTitle")}>
        <SectionRow
          label={t("agentOrgs.cursorConfig.sandboxTypeLabel")}
          description={t("agentOrgs.cursorConfig.sandboxTypeDesc")}
        >
          <Select
            value={sandbox.type ?? "workspace_readwrite"}
            options={sandboxTypeOptions}
            onChange={(val) => updateSandbox({ type: val as SandboxType })}
            style={SECTION_CONTROL_STYLE}
          />
        </SectionRow>
        <SectionRow
          label={t("agentOrgs.cursorConfig.disableTmpWrite")}
          description={t("agentOrgs.cursorConfig.disableTmpWriteDesc")}
        >
          <Switch
            checked={sandbox.disableTmpWrite ?? false}
            onChange={(checked) => updateSandbox({ disableTmpWrite: checked })}
          />
        </SectionRow>
        <SectionRow
          label={t("agentOrgs.cursorConfig.sharedBuildCache")}
          description={t("agentOrgs.cursorConfig.sharedBuildCacheDesc")}
        >
          <Switch
            checked={sandbox.enableSharedBuildCache ?? false}
            onChange={(checked) =>
              updateSandbox({ enableSharedBuildCache: checked })
            }
          />
        </SectionRow>
      </SectionContainer>

      {/* Network Policy */}
      <SectionContainer title={t("agentOrgs.cursorConfig.networkPolicyTitle")}>
        <SectionRow
          label={t("agentOrgs.cursorConfig.networkDefaultPolicy")}
          description={t("agentOrgs.cursorConfig.networkDefaultPolicyDesc")}
        >
          <Select
            value={networkPolicy.default ?? "deny"}
            options={networkDefaultOptions}
            onChange={(val) =>
              updateSandbox({
                networkPolicy: {
                  ...networkPolicy,
                  default: val as NetworkDefault,
                },
              })
            }
            style={SECTION_CONTROL_STYLE}
          />
        </SectionRow>
        <SectionRow
          label={t("agentOrgs.cursorConfig.networkAllow")}
          layout="vertical"
        >
          <PermissionList
            label={t("agentOrgs.cursorConfig.networkAllow")}
            items={networkPolicy.allow ?? []}
            onChange={(allow) =>
              updateSandbox({
                networkPolicy: { ...networkPolicy, allow },
              })
            }
            placeholder="registry.npmjs.org, *.github.com"
          />
        </SectionRow>
        <SectionRow
          label={t("agentOrgs.cursorConfig.networkDeny")}
          layout="vertical"
        >
          <PermissionList
            label={t("agentOrgs.cursorConfig.networkDeny")}
            items={networkPolicy.deny ?? []}
            onChange={(deny) =>
              updateSandbox({
                networkPolicy: { ...networkPolicy, deny },
              })
            }
            placeholder="*.internal.corp.example.com"
          />
        </SectionRow>
      </SectionContainer>
    </div>
  );
};

export default CursorCliConfigSection;
