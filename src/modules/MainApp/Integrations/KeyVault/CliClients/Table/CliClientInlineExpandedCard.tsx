import { ExternalLink, Plus } from "lucide-react";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { formatAgentType } from "@src/assets/providers";
import Button from "@src/components/Button";
import StatusDot from "@src/components/StatusDot";
import {
  type AvailableAgent,
  METHOD_DISPLAY_LABELS,
} from "@src/config/cliAgents";
import type { KeyVaultAccount } from "@src/hooks/keyVault";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import { openExternalLink } from "@src/util/platform/ipcRenderer";

import { InfoRow } from "../../../shared/InfoRow";
import { AccountSourceBreadcrumb } from "../../Models/Table/AccountSourceBreadcrumb";
import {
  InlineCardBody,
  InlineCardColumnStack,
  InlineCardFooter,
  InlineCardShell,
  InlineCardSplit,
  InlineCardTabs,
} from "../../shared/InlineCardPrimitives";
import { CliClientSection } from "../Preview/CliClientSection";

export const CLI_CLIENT_INLINE_TAB = {
  STATUS: "status",
  SUBSCRIPTIONS: "subscriptions",
  CLIENT: "client",
} as const;

export type CliClientInlineTab =
  (typeof CLI_CLIENT_INLINE_TAB)[keyof typeof CLI_CLIENT_INLINE_TAB];

interface CliAgentsHandlers {
  actionMap: Record<string, "installing" | "detecting" | null>;
  handleInstall: (agentName: string, installCmd?: string) => Promise<void>;
  handleUninstall: (agentName: string, uninstallCmd?: string) => Promise<void>;
}

interface CliClientInlineExpandedCardProps {
  agent: AvailableAgent;
  accounts: KeyVaultAccount[];
  activeTab: CliClientInlineTab;
  onActiveTabChange: (tab: CliClientInlineTab) => void;
  onRefresh?: () => Promise<void>;
  onAdd?: () => void;
  cliAgents?: CliAgentsHandlers;
}

function StatusValue({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`text-[12px] font-medium ${active ? "text-success-6" : "text-text-3"}`}
    >
      {children}
    </span>
  );
}

const CliClientInlineExpandedCard: React.FC<
  CliClientInlineExpandedCardProps
> = ({ agent, accounts, activeTab, onActiveTabChange, onAdd, cliAgents }) => {
  const { t } = useTranslation("integrations");

  const subscriptionAccounts = useMemo(
    () => accounts.filter((account) => account.modelType === agent.name),
    [accounts, agent.name]
  );
  const hasClientActions =
    (!agent.installed && agent.installMethods.length > 0) ||
    (agent.installed && agent.uninstallMethods.length > 0);

  const tabs = useMemo(
    () => [
      {
        key: CLI_CLIENT_INLINE_TAB.STATUS,
        label: t("keyVault.inlineCard.tabStatus"),
      },
      {
        key: CLI_CLIENT_INLINE_TAB.SUBSCRIPTIONS,
        label: t("cliPreview.subscriptions"),
      },
      {
        key: CLI_CLIENT_INLINE_TAB.CLIENT,
        label: t("cliPreview.clientSection"),
        disabled: !hasClientActions,
      },
    ],
    [hasClientActions, t]
  );

  const effectiveActiveTab = useMemo(() => {
    const match = tabs.find((tab) => tab.key === activeTab && !tab.disabled);
    return match?.key ?? CLI_CLIENT_INLINE_TAB.STATUS;
  }, [activeTab, tabs]);

  const subscriptionsContent =
    subscriptionAccounts.length > 0 ? (
      <InlineCardColumnStack gap="compact">
        {subscriptionAccounts.map((account) => (
          <div
            key={account.id}
            className="flex h-9 min-h-9 items-center justify-between gap-3 rounded-md px-3 text-xs hover:bg-fill-1"
          >
            <div className="flex min-w-0 flex-1 items-center">
              <AccountSourceBreadcrumb
                modelType={account.modelType}
                accountName={account.name}
              />
            </div>
          </div>
        ))}
      </InlineCardColumnStack>
    ) : (
      <span className="px-1 text-xs text-text-3">
        {t("cliPreview.noSubscriptions")}
      </span>
    );

  const clientContent = hasClientActions ? (
    <CliClientSection
      agentName={agent.name}
      installMethods={agent.installMethods}
      uninstallMethods={agent.uninstallMethods}
      defaultMode={agent.installed ? "uninstall" : "install"}
      defaultMethodId={agent.installedVia}
      onInstall={
        cliAgents ? () => cliAgents.handleInstall(agent.name) : undefined
      }
      onUninstall={
        cliAgents ? () => cliAgents.handleUninstall(agent.name) : undefined
      }
      actionLoading={cliAgents?.actionMap[agent.name] === "installing"}
      actionDisabled={(cliAgents?.actionMap[agent.name] ?? null) !== null}
    />
  ) : (
    <Placeholder
      variant="empty"
      title={
        agent.installed
          ? t("cliPreview.noUninstallScript")
          : t("cliPreview.noInstallScript")
      }
    />
  );

  const tabContent = (() => {
    switch (effectiveActiveTab) {
      case CLI_CLIENT_INLINE_TAB.SUBSCRIPTIONS:
        return subscriptionsContent;
      case CLI_CLIENT_INLINE_TAB.CLIENT:
        return clientContent;
      case CLI_CLIENT_INLINE_TAB.STATUS:
      default:
        return (
          <InlineCardSplit
            equalColumns
            left={
              <InlineCardColumnStack>
                <InfoRow label={t("cliPreview.installed")}>
                  <StatusValue active={agent.installed}>
                    {agent.installed
                      ? t("common:status.yes")
                      : t("common:status.no")}
                  </StatusValue>
                </InfoRow>
                <InfoRow label={t("cliPreview.keys")}>
                  <StatusValue active={agent.hasKeys}>
                    {agent.hasKeys
                      ? t("cliPreview.configured")
                      : t("cliPreview.notConfigured")}
                  </StatusValue>
                </InfoRow>
                {agent.installed ? (
                  <InfoRow label={t("cliPreview.installedVia")}>
                    <span
                      className={`text-[12px] font-medium ${agent.installedVia ? "text-text-1" : "text-text-3"}`}
                    >
                      {agent.installedVia
                        ? (METHOD_DISPLAY_LABELS[agent.installedVia] ??
                          agent.installedVia)
                        : t("common:status.na")}
                    </span>
                  </InfoRow>
                ) : null}
              </InlineCardColumnStack>
            }
            right={
              <InlineCardColumnStack>
                <InfoRow label={t("keyVault.info.orgiiAgents")}>
                  <StatusDot
                    color={
                      agent.supportsRustAgents ? "bg-success-6" : "bg-text-4"
                    }
                    size="inline"
                    label={
                      agent.supportsRustAgents
                        ? t("common:status.supported")
                        : t("common:status.notSupported")
                    }
                  />
                </InfoRow>
                <InfoRow label={t("keyVault.info.compatibleApis")}>
                  <StatusDot
                    color={
                      agent.compatibleApiProviders.length > 0
                        ? "bg-success-6"
                        : "bg-text-4"
                    }
                    size="inline"
                    className="min-w-0"
                    labelClassName="min-w-0 truncate text-[12px] text-text-1"
                    label={
                      agent.compatibleApiProviders.length > 0
                        ? agent.compatibleApiProviders
                            .map((provider) => formatAgentType(provider))
                            .join(", ")
                        : t("common:status.na")
                    }
                  />
                </InfoRow>
              </InlineCardColumnStack>
            }
          />
        );
    }
  })();

  return (
    <InlineCardShell>
      <InlineCardTabs
        tabs={tabs}
        activeTab={effectiveActiveTab}
        onChange={onActiveTabChange}
      />
      <InlineCardBody>{tabContent}</InlineCardBody>
      {effectiveActiveTab !== CLI_CLIENT_INLINE_TAB.CLIENT &&
      (agent.docsUrl || onAdd) ? (
        <InlineCardFooter>
          {agent.docsUrl ? (
            <Button
              variant="secondary"
              size="small"
              icon={<ExternalLink size={14} />}
              iconPosition="right"
              onClick={() => openExternalLink(agent.docsUrl!)}
            >
              {t("cliPreview.docs")}
            </Button>
          ) : null}
          {onAdd ? (
            <Button
              variant="secondary"
              size="small"
              icon={<Plus size={14} />}
              onClick={onAdd}
            >
              {t("cliPreview.addKey")}
            </Button>
          ) : null}
        </InlineCardFooter>
      ) : null}
    </InlineCardShell>
  );
};

export default CliClientInlineExpandedCard;
