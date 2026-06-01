/**
 * Git Provider Detail Panel
 *
 * Right-side detail panel for Git integrations (GitHub, etc.).
 * Uses an inline Tauri webview for the GitHub App installation flow.
 */
import { GitBranch, Github, RefreshCw, Settings, Trash2 } from "lucide-react";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import type { GitHubConnection } from "@src/api/http/github/types";
import Button from "@src/components/Button";
import { useGitHubConnections } from "@src/hooks/git";
import {
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";
import {
  CollapsibleSection,
  DETAIL_PANEL_TOKENS,
  DetailPanelContainer,
  PLACEHOLDER_TOKENS,
  PanelHeader,
  Placeholder,
} from "@src/modules/shared/layouts/blocks";
import { WizardShell } from "@src/scaffold/WizardSystem/primitives";
import { showGitActionDialogSafely } from "@src/util/dialogs/gitActionDialog";

import { DetailHeaderClose } from "../../shared/DetailHeaderClose";
import GitHubConnectWebview from "./GitHubConnectWebview";
import { getGitHubManageUrl } from "./utils";

// ============================================
// Props
// ============================================

interface GitProviderDetailPanelProps {
  selectedProvider: string | null;
  onBack?: () => void;
  onExpand?: () => void;
}

// ============================================
// Component
// ============================================

const GitProviderDetailPanel: React.FC<GitProviderDetailPanelProps> = ({
  selectedProvider,
  onBack,
  onExpand,
}) => {
  const { t: tIntegrations } = useTranslation("integrations");

  if (!selectedProvider) {
    return (
      <Placeholder
        variant="empty"
        placement="detail-panel"
        icon={<GitBranch size={PLACEHOLDER_TOKENS.iconSize} />}
        title={tIntegrations("common:placeholders.selectToViewConfig", {
          type: tIntegrations("common:placeholderTypes.gitProvider"),
        })}
        subtitle={tIntegrations(
          "common:placeholders.selectToViewConfigSubtitle"
        )}
      />
    );
  }

  if (selectedProvider === "github") {
    return <GitHubDetail onBack={onBack} onExpand={onExpand} />;
  }

  return (
    <Placeholder
      variant="empty"
      placement="detail-panel"
      icon={<GitBranch size={PLACEHOLDER_TOKENS.iconSize} />}
      title={tIntegrations("common:placeholders.selectToViewConfig", {
        type: tIntegrations("common:placeholderTypes.gitProvider"),
      })}
      subtitle={tIntegrations("common:placeholders.selectToViewConfigSubtitle")}
    />
  );
};

// ============================================
// GitHub Detail (manage existing connections)
// ============================================

const GitHubDetail: React.FC<{
  onBack?: () => void;
  onExpand?: () => void;
}> = ({ onBack, onExpand }) => {
  const { t: tIntegrations } = useTranslation("integrations");
  const { t: tCommon } = useTranslation();
  const github = useGitHubConnections({ autoFetch: true });
  const [showWebview, setShowWebview] = useState(false);
  const [manageUrl, setManageUrl] = useState<string | null>(null);

  const handleConnect = useCallback(() => {
    setManageUrl(null);
    setShowWebview(true);
  }, []);

  const handleManage = useCallback((connection: GitHubConnection) => {
    setManageUrl(getGitHubManageUrl(connection));
    setShowWebview(true);
  }, []);

  const handleConnected = useCallback(() => {
    setShowWebview(false);
    setManageUrl(null);
    github.refresh();
    showGitActionDialogSafely(tIntegrations("git.accountConnected"), "info");
  }, [github, tIntegrations]);

  const handleWebviewClose = useCallback(() => {
    setShowWebview(false);
    setManageUrl(null);
    github.refresh();
  }, [github]);

  const handleDisconnect = useCallback(
    async (connectionId: string, accountName: string) => {
      try {
        const { ask } = await import("@tauri-apps/plugin-dialog");
        const confirmed = await ask(tIntegrations("git.disconnectMsg"), {
          title: tIntegrations("git.disconnectTitle"),
          kind: "warning",
          okLabel: tCommon("actions.confirm"),
          cancelLabel: tCommon("actions.cancel"),
        });
        if (!confirmed) return;

        const { deleteGitHubConnection } = await import("@src/api/http/github");
        await deleteGitHubConnection(connectionId);
        await github.refresh();
        showGitActionDialogSafely(
          tIntegrations("git.accountDisconnected", {
            name: accountName,
          }),
          "info"
        );
      } catch (err) {
        showGitActionDialogSafely(
          tIntegrations("git.accountDisconnectFailed"),
          "error"
        );
        console.error(err);
      }
    },
    [github, tIntegrations, tCommon]
  );

  const webviewTitle = manageUrl
    ? tIntegrations("git.manageGithub")
    : tIntegrations("git.connectGithub");

  if (showWebview) {
    return (
      <WizardShell title={webviewTitle} onCancel={handleWebviewClose}>
        <GitHubConnectWebview
          embedded
          onConnected={handleConnected}
          onClose={handleWebviewClose}
          initialUrl={manageUrl ?? undefined}
        />
      </WizardShell>
    );
  }

  return (
    <DetailPanelContainer>
      <PanelHeader
        iconElement={<Github size={14} />}
        title={tIntegrations("channels.github")}
        actions={
          <DetailHeaderClose
            onClick={onBack ?? (() => {})}
            onExpand={onExpand}
          />
        }
      />

      <div className={DETAIL_PANEL_TOKENS.scrollContent}>
        <div className={DETAIL_PANEL_TOKENS.contentWidthWithPadding}>
          {/* Connections */}
          <CollapsibleSection title={tIntegrations("git.connections")}>
            {github.isLoading ? (
              <div className="rounded-lg bg-fill-2">
                <Placeholder
                  variant="loading"
                  subtitle={tIntegrations("channels.fetchingConnections")}
                />
              </div>
            ) : github.connections.length === 0 ? (
              <SectionContainer>
                <SectionRow
                  label={tIntegrations("channels.github")}
                  description={tIntegrations("git.connectRepoDesc")}
                >
                  <Button
                    variant="primary"
                    size="default"
                    onClick={handleConnect}
                  >
                    {tCommon("actions.connect")}
                  </Button>
                </SectionRow>
              </SectionContainer>
            ) : (
              <SectionContainer>
                {github.connections.map((connection) => {
                  const repoCount = connection.repos_count || 0;
                  const repoText =
                    repoCount === 1
                      ? tIntegrations("channels.repo")
                      : tIntegrations("channels.repos");
                  const description = `${connection.account_type} · ${repoCount} ${repoText}`;

                  return (
                    <SectionRow
                      key={connection.id}
                      label={connection.account}
                      description={description}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-success-6">
                          {tIntegrations("channels.connected")}
                        </span>
                        <Button
                          size="default"
                          icon={<Settings size={14} />}
                          onClick={() => handleManage(connection)}
                          iconOnly
                          title={tCommon("actions.manage")}
                        />
                        <Button
                          size="default"
                          icon={<Trash2 size={14} />}
                          onClick={() =>
                            handleDisconnect(connection.id, connection.account)
                          }
                          iconOnly
                        />
                      </div>
                    </SectionRow>
                  );
                })}
                <SectionRow label={tIntegrations("channels.addAnotherAccount")}>
                  <div className="flex items-center gap-2">
                    <Button size="default" onClick={handleConnect}>
                      {tCommon("actions.connect")}
                    </Button>
                    <Button
                      size="default"
                      onClick={() => github.refresh()}
                      loading={github.isLoading}
                      loadingSpinIcon
                      icon={<RefreshCw size={14} />}
                      iconOnly
                    />
                  </div>
                </SectionRow>
              </SectionContainer>
            )}
          </CollapsibleSection>
        </div>
      </div>
    </DetailPanelContainer>
  );
};

export default GitProviderDetailPanel;
