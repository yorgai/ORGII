import { Trash2 } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { gitApi } from "@src/api/http/git";
import { deleteGitHubConnection } from "@src/api/http/github";
import type { GitHubConnection } from "@src/api/http/github/types";
import {
  LOCAL_GITHUB_TOKEN_USER_ID,
  clearTokenLocal,
  getGitHubGitCredentialForRemote,
} from "@src/api/tauri/github";
import Button from "@src/components/Button";
import IntegrationIcon from "@src/components/IntegrationIcon";
import SettingsTable, {
  SETTINGS_TABLE_CELL,
  SETTINGS_TABLE_COL,
  type SettingsTableColumn,
} from "@src/components/SettingsTable";
import TabPill from "@src/components/TabPill";
import { createLogger } from "@src/hooks/logger";
import {
  DETAIL_PANEL_TOKENS,
  DetailPanelContainer,
  InlineInfoCard,
  InternalHeader,
  ScrollPreservation,
} from "@src/modules/shared/layouts/blocks";
import { getRepoContext } from "@src/services/git/operations/types";
import { confirmDestructiveAction } from "@src/util/dialogs/confirmDestructiveAction";

import {
  InlineCardColumnStack,
  InlineCardSplit,
} from "../../KeyVault/shared/InlineCardPrimitives";
import { ThirdPartyDisclaimer } from "../../Tables/TrademarkDisclaimer";
import { StatusDot } from "../../Tables/shared";
import { InfoRow } from "../../shared";
import type { DetailMode } from "../../types";
import GitPreferencesSection from "./GitPreferencesSection";
import InlineGitConnectionAdd, {
  LOCAL_GIT_AUTH_KIND_STORAGE_KEY,
  LOCAL_GIT_AUTH_VALUE_STORAGE_KEY,
  LOCAL_GIT_HIDDEN_SSH_STORAGE_KEY,
  type LocalGitAuthKind,
  maskGitHubToken,
} from "./InlineGitConnectionAdd";

const logger = createLogger("GitTable");

interface GitRow {
  id: string;
  account: string;
  provider: string;
  access: string;
  repositories: number;
  statusColor: string;
  statusLabel: string;
  kind: "hosted" | "local";
  localAuthKind?: LocalGitAuthKind;
  localAuthValue?: string;
  connectionId?: string;
}

interface GitTableProps {
  connections: GitHubConnection[];
  loading: boolean;
  selectedRowId?: string | null;
  onSelectProvider: (id: string | null, mode?: DetailMode) => void;
  onAfterAddOpen?: () => void | Promise<void>;
}

function isLocalGitAuthKind(value: string | null): value is LocalGitAuthKind {
  return value === "token" || value === "ssh";
}

function isGithubSshRemote(remoteUrl: string): boolean {
  return /^git@github\.com:[^/]+\/[^/]+(?:\.git)?$/i.test(remoteUrl.trim());
}

export const GitTable: React.FC<GitTableProps> = ({
  connections,
  loading,
  selectedRowId: _selectedRowId,
  onSelectProvider: _onSelectProvider,
  onAfterAddOpen,
}) => {
  const { t } = useTranslation("integrations");
  const { t: tCommon } = useTranslation("common");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [removingRowId, setRemovingRowId] = useState<string | null>(null);
  const [localAuthKind, setLocalAuthKind] = useState<LocalGitAuthKind | null>(
    () => {
      const storedKind = localStorage.getItem(LOCAL_GIT_AUTH_KIND_STORAGE_KEY);
      if (isLocalGitAuthKind(storedKind)) return storedKind;
      if (storedKind !== null) {
        localStorage.removeItem(LOCAL_GIT_AUTH_KIND_STORAGE_KEY);
      }
      return null;
    }
  );
  const [localAuthValue, setLocalAuthValue] = useState<string | null>(() => {
    const storedValue = localStorage.getItem(LOCAL_GIT_AUTH_VALUE_STORAGE_KEY);
    return storedValue?.trim() || null;
  });

  useEffect(() => {
    let cancelled = false;

    async function restoreSshRemoteState() {
      const repo = getRepoContext();
      if (!repo) return;

      const remotesData = await gitApi.getGitRemotes({
        repo_id: repo.repoId,
        repo_path: repo.repoPath,
      });
      const remote = remotesData?.remotes.find(
        (candidateRemote) => candidateRemote.name === "origin"
      );
      const remoteUrl = remote?.push_url ?? remote?.fetch_url ?? remote?.url;
      if (!remoteUrl || cancelled) return;

      const localCredential = await getGitHubGitCredentialForRemote(
        LOCAL_GITHUB_TOKEN_USER_ID,
        remoteUrl
      );
      if (localCredential && !cancelled) {
        const maskedToken = maskGitHubToken(localCredential.token);
        localStorage.setItem(LOCAL_GIT_AUTH_KIND_STORAGE_KEY, "token");
        localStorage.setItem(LOCAL_GIT_AUTH_VALUE_STORAGE_KEY, maskedToken);
        setLocalAuthKind("token");
        setLocalAuthValue(maskedToken);
        return;
      }

      if (!isGithubSshRemote(remoteUrl) || cancelled) return;
      if (localStorage.getItem(LOCAL_GIT_HIDDEN_SSH_STORAGE_KEY) === "true") {
        return;
      }

      localStorage.setItem(LOCAL_GIT_AUTH_KIND_STORAGE_KEY, "ssh");
      localStorage.setItem(LOCAL_GIT_AUTH_VALUE_STORAGE_KEY, remoteUrl);
      setLocalAuthKind("ssh");
      setLocalAuthValue(remoteUrl);
    }

    void restoreSshRemoteState().catch((error: unknown) => {
      logger.warn("Failed to restore local Git auth row:", error);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo<GitRow[]>(() => {
    const allRows: GitRow[] = connections.map((connection) => ({
      id: `hosted:${connection.id}`,
      account: connection.account || "GitHub",
      provider: "GitHub",
      access: t("git.githubApp"),
      repositories: connection.repos_count ?? 0,
      statusColor: connection.is_active ? "bg-success-6" : "bg-text-4",
      statusLabel: connection.is_active
        ? t("status.connected")
        : t("status.disconnected"),
      kind: "hosted",
      connectionId: connection.id,
    }));

    if (localAuthKind) {
      allRows.push({
        id: `local:${localAuthKind}`,
        account: "GitHub",
        provider: t("git.localProvider"),
        access:
          localAuthKind === "ssh"
            ? t("git.localAuthSsh")
            : t("git.localAuthToken"),
        repositories: 0,
        statusColor: "bg-success-6",
        statusLabel: t("status.connected"),
        kind: "local",
        localAuthKind,
        localAuthValue: localAuthValue ?? undefined,
      });
    }

    const query = searchQuery.trim().toLowerCase();
    if (!query) return allRows;
    return allRows.filter(
      (row) =>
        row.account.toLowerCase().includes(query) ||
        row.provider.toLowerCase().includes(query)
    );
  }, [connections, localAuthKind, localAuthValue, searchQuery, t]);

  const refreshGitConnections = useCallback(async () => {
    await onAfterAddOpen?.();
  }, [onAfterAddOpen]);

  const handleRemoveRow = useCallback(
    async (row: GitRow) => {
      const confirmed = await confirmDestructiveAction({
        title: t("git.disconnectTitle"),
        message: t("git.disconnectMsg"),
        okLabel: tCommon("actions.delete"),
        cancelLabel: tCommon("actions.cancel"),
      });
      if (!confirmed) return;

      setRemovingRowId(row.id);
      try {
        if (row.kind === "hosted" && row.connectionId) {
          await deleteGitHubConnection(row.connectionId);
        } else if (row.localAuthKind === "token") {
          await clearTokenLocal(LOCAL_GITHUB_TOKEN_USER_ID);
          localStorage.removeItem(LOCAL_GIT_AUTH_KIND_STORAGE_KEY);
          localStorage.removeItem(LOCAL_GIT_AUTH_VALUE_STORAGE_KEY);
          setLocalAuthKind(null);
          setLocalAuthValue(null);
        } else if (row.localAuthKind === "ssh") {
          localStorage.setItem(LOCAL_GIT_HIDDEN_SSH_STORAGE_KEY, "true");
          localStorage.removeItem(LOCAL_GIT_AUTH_KIND_STORAGE_KEY);
          localStorage.removeItem(LOCAL_GIT_AUTH_VALUE_STORAGE_KEY);
          setLocalAuthKind(null);
          setLocalAuthValue(null);
        }
        await refreshGitConnections();
        setExpandedKeys((current) => current.filter((key) => key !== row.id));
      } finally {
        setRemovingRowId(null);
      }
    },
    [refreshGitConnections, t, tCommon]
  );

  const columns = useMemo<SettingsTableColumn<GitRow>[]>(
    () => [
      {
        key: "account",
        label: tCommon("labels.name"),
        width: SETTINGS_TABLE_COL.fill,
        sorter: (rowA, rowB) => rowA.account.localeCompare(rowB.account),
        renderCell: (row) => (
          <span
            className={`${SETTINGS_TABLE_CELL.primary} inline-flex items-center gap-2 font-bold`}
          >
            <IntegrationIcon type="github" size={16} />
            <span>{row.account}</span>
          </span>
        ),
      },
      {
        key: "provider",
        label: t("gitPreview.provider"),
        width: SETTINGS_TABLE_COL.valueMd,
        sorter: (rowA, rowB) => rowA.provider.localeCompare(rowB.provider),
        renderCell: (row) => (
          <span className={SETTINGS_TABLE_CELL.value}>{row.provider}</span>
        ),
      },
      {
        key: "access",
        label: t("gitPreview.connections"),
        width: SETTINGS_TABLE_COL.valueMd,
        sorter: (rowA, rowB) => rowA.access.localeCompare(rowB.access),
        renderCell: (row) => (
          <span className={SETTINGS_TABLE_CELL.value}>{row.access}</span>
        ),
      },
      {
        key: "status",
        label: tCommon("labels.status"),
        width: SETTINGS_TABLE_COL.valueSm,
        sorter: (rowA, rowB) =>
          rowA.statusLabel.localeCompare(rowB.statusLabel),
        renderCell: (row) => (
          <StatusDot color={row.statusColor} label={row.statusLabel} />
        ),
      },
      {
        key: "actions",
        label: "",
        width: SETTINGS_TABLE_COL.hug,
        align: "right",
        renderCell: (row) => (
          <div className="flex h-full items-center justify-end gap-2">
            <Button
              variant="secondary"
              size="small"
              icon={<Trash2 size={14} className="text-danger-6" />}
              iconOnly
              loading={removingRowId === row.id}
              disabled={removingRowId === row.id}
              aria-label={tCommon("actions.remove")}
              title={tCommon("actions.remove")}
              onClick={(event) => {
                event.stopPropagation();
                void handleRemoveRow(row);
              }}
            />
          </div>
        ),
      },
    ],
    [handleRemoveRow, removingRowId, t, tCommon]
  );

  const tabs = useMemo(
    () => [{ key: "connections", label: t("git.connections") }],
    [t]
  );

  return (
    <DetailPanelContainer>
      <InternalHeader
        noPanelHeader
        contentPadding
        className={DETAIL_PANEL_TOKENS.headerWidth}
        tabs={
          <TabPill
            tabs={tabs}
            activeTab="connections"
            onChange={() => undefined}
            variant="simple"
            fillWidth={false}
            size="large"
          />
        }
      />
      <ScrollPreservation className={DETAIL_PANEL_TOKENS.scrollContentNoTop}>
        <div className={DETAIL_PANEL_TOKENS.contentWidthWithPaddingNoTop}>
          <div className="flex flex-col gap-3">
            <SettingsTable<GitRow>
              hover
              loading={loading}
              columns={columns}
              rows={rows}
              getRowKey={(row) => row.id}
              headerHeight="tall"
              searchBar={{
                searchValue: searchQuery,
                onSearchChange: setSearchQuery,
                searchPlaceholder: t("git.searchPlaceholder"),
              }}
              emptyTitle={t("git.noProvidersFound")}
              expandable={{
                expandedRowKeys: expandedKeys,
                onExpandedRowsChange: (keys) => setExpandedKeys(keys.slice(-1)),
                expandedRowRender: (row) => (
                  <InlineInfoCard>
                    <div className="flex min-w-0 flex-col gap-3">
                      <InlineCardSplit
                        equalColumns
                        left={
                          <InlineCardColumnStack>
                            <InfoRow
                              label={t("gitPreview.provider")}
                              value={row.provider}
                            />
                            <InfoRow
                              label={t("gitPreview.connections")}
                              value={row.access}
                            />
                            {row.kind === "local" && row.localAuthValue && (
                              <InfoRow
                                label={t("git.credentialValue")}
                                value={row.localAuthValue}
                              />
                            )}
                            <InfoRow label={tCommon("labels.status")}>
                              <StatusDot
                                size="inline"
                                color={row.statusColor}
                                label={row.statusLabel}
                              />
                            </InfoRow>
                          </InlineCardColumnStack>
                        }
                        right={
                          <InlineCardColumnStack>
                            {row.kind === "hosted" && (
                              <InfoRow
                                label={t("gitPreview.repositories")}
                                value={String(row.repositories)}
                              />
                            )}
                          </InlineCardColumnStack>
                        }
                      />
                    </div>
                  </InlineInfoCard>
                ),
              }}
            />

            <InlineGitConnectionAdd
              onAfterOpen={refreshGitConnections}
              onConfigured={(kind, value) => {
                setLocalAuthKind(kind);
                setLocalAuthValue(value ?? null);
              }}
            />
            <GitPreferencesSection />
            <ThirdPartyDisclaimer />
          </div>
        </div>
      </ScrollPreservation>
    </DetailPanelContainer>
  );
};
