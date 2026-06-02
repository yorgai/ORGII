import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  STORY_SYNC_ADAPTER,
  type SyncConnection,
} from "@src/api/http/integrations";
import IntegrationIcon from "@src/components/IntegrationIcon";
import SettingsTable, {
  SETTINGS_TABLE_CELL,
  SETTINGS_TABLE_COL,
  type SettingsTableColumn,
} from "@src/components/SettingsTable";
import TabPill from "@src/components/TabPill";
import {
  DETAIL_PANEL_TOKENS,
  DetailPanelContainer,
  InternalHeader,
  Placeholder,
  ScrollPreservation,
} from "@src/modules/shared/layouts/blocks";

import {
  InlineCardBody,
  InlineCardColumnStack,
  InlineCardShell,
  InlineCardSplit,
} from "../../KeyVault/shared/InlineCardPrimitives";
import { ThirdPartyDisclaimer } from "../../Tables/TrademarkDisclaimer";
import {
  RowChevron,
  StatusDot,
  selectedRowClassName,
} from "../../Tables/shared";
import { InfoRow } from "../../shared/InfoRow";
import type { DetailMode } from "../../types";
import { CHANNEL_TYPES, type ChannelInstance } from "../Channels";
import GatewayAgentCard from "../Channels/GatewayAgentCard";
import { STATUS_DOT_COLOR } from "../Channels/types";

interface ConnectionRow {
  id: string;
  name: string;
  typeName: string;
  typeIcon: string;
  statusColor: string;
  statusLabel: string;
  kind: "channel" | "project";
}

function getProjectConnectionTypeKey(connection: SyncConnection): string {
  switch (connection.adapter_id) {
    case STORY_SYNC_ADAPTER.LINEAR:
      return "projectConnections.linear";
    case STORY_SYNC_ADAPTER.GITHUB_ISSUES:
      return "projectConnections.githubIssues";
  }
}

function getProjectConnectionIcon(connection: SyncConnection): string {
  switch (connection.adapter_id) {
    case STORY_SYNC_ADAPTER.LINEAR:
      return "linear";
    case STORY_SYNC_ADAPTER.GITHUB_ISSUES:
      return "github";
  }
}

interface ConnectionsTableProps {
  groupedChannels: Map<string, ChannelInstance[]>;
  projectConnections: SyncConnection[];
  loading: boolean;
  selectedRowId?: string | null;
  onSelectChannel: (compositeId: string | null, mode?: DetailMode) => void;
  onAdd: () => void;
}

export const ConnectionsTable: React.FC<ConnectionsTableProps> = ({
  groupedChannels,
  projectConnections,
  loading,
  selectedRowId,
  onSelectChannel,
  onAdd,
}) => {
  const { t } = useTranslation("integrations");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);

  const rows = useMemo<ConnectionRow[]>(() => {
    const result: ConnectionRow[] = [];

    for (const channelType of CHANNEL_TYPES) {
      const instances = groupedChannels.get(channelType.type);
      if (!instances) continue;
      for (const instance of instances) {
        const statusColor =
          STATUS_DOT_COLOR[instance.connectionStatus] ?? "bg-fill-3";
        result.push({
          id: `${instance.type}:${instance.accountId}`,
          name: instance.accountId,
          typeName: t(channelType.labelKey),
          typeIcon: instance.type,
          statusColor,
          statusLabel: instance.connectionStatus,
          kind: "channel",
        });
      }
    }

    for (const connection of projectConnections) {
      result.push({
        id: `project:${connection.id}`,
        name: connection.label,
        typeName: t(getProjectConnectionTypeKey(connection)),
        typeIcon: getProjectConnectionIcon(connection),
        statusColor: "bg-success-6",
        statusLabel: t("status.connected"),
        kind: "project",
      });
    }

    if (!searchQuery) return result;
    const query = searchQuery.toLowerCase();
    return result.filter(
      (row) =>
        row.name.toLowerCase().includes(query) ||
        row.typeName.toLowerCase().includes(query)
    );
  }, [groupedChannels, searchQuery, projectConnections, t]);

  const handleRowClick = useCallback(
    (row: ConnectionRow, mode?: DetailMode) => {
      if (row.kind === "project") return;
      if (!mode && selectedRowId === row.id) {
        onSelectChannel(null);
        return;
      }
      onSelectChannel(row.id, mode);
    },
    [onSelectChannel, selectedRowId]
  );

  const connectionsTabs = useMemo(
    () => [
      {
        key: "connections",
        label: t("connectionsTabs.connections"),
      },
      {
        key: "gateway",
        label: t("connectionsTabs.gateway"),
      },
      { key: "discover", label: t("connectionsTabs.discover") },
    ],
    [t]
  );

  const [connectionsActiveTab, setConnectionsActiveTab] =
    useState("connections");

  const columns = useMemo<SettingsTableColumn<ConnectionRow>[]>(
    () => [
      {
        key: "name",
        label: t("common:labels.name"),
        width: SETTINGS_TABLE_COL.fill,
        sorter: (rowA, rowB) => rowA.name.localeCompare(rowB.name),
        renderCell: (row) => (
          <span
            className={`${SETTINGS_TABLE_CELL.primary} inline-flex items-center gap-2 font-bold`}
          >
            <IntegrationIcon type={row.typeIcon} size={16} />
            <span>{row.name}</span>
          </span>
        ),
      },
      {
        key: "type",
        label: t("tableHeaders.type"),
        width: SETTINGS_TABLE_COL.valueMd,
        sorter: (rowA, rowB) => rowA.typeName.localeCompare(rowB.typeName),
        renderCell: (row) => (
          <span className={SETTINGS_TABLE_CELL.value}>{row.typeName}</span>
        ),
      },
      {
        key: "status",
        label: t("common:labels.status"),
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
        renderCell: (row) =>
          row.kind === "project" ? null : (
            <RowChevron onClick={() => handleRowClick(row, "full")} />
          ),
      },
    ],
    [t, handleRowClick]
  );

  return (
    <DetailPanelContainer>
      <InternalHeader
        noPanelHeader
        contentPadding
        className={DETAIL_PANEL_TOKENS.headerWidth}
        tabs={
          <TabPill
            tabs={connectionsTabs}
            activeTab={connectionsActiveTab}
            onChange={setConnectionsActiveTab}
            variant="simple"
            fillWidth={false}
            size="large"
          />
        }
      />
      <ScrollPreservation className={DETAIL_PANEL_TOKENS.scrollContentNoTop}>
        <div className={DETAIL_PANEL_TOKENS.contentWidthWithPaddingNoTop}>
          <div className="flex flex-col gap-3">
            {connectionsActiveTab === "gateway" ? (
              <GatewayAgentCard />
            ) : connectionsActiveTab === "discover" ? (
              <Placeholder
                variant="empty"
                placement="detail-panel"
                title={t("connectionsTabs.comingSoon")}
              />
            ) : (
              <SettingsTable<ConnectionRow>
                hover
                loading={loading}
                columns={columns}
                rows={rows}
                getRowKey={(row) => row.id}
                onRowClick={(row) => handleRowClick(row)}
                rowClassName={selectedRowClassName(
                  (row: ConnectionRow) => row.id,
                  selectedRowId
                )}
                headerHeight="tall"
                searchBar={{
                  searchValue: searchQuery,
                  onSearchChange: setSearchQuery,
                  searchPlaceholder: t("integrations.searchPlaceholder"),
                }}
                emptyTitle={t("integrations.noConnections")}
                emptyAction={{
                  label: t("addOptions.addConnection"),
                  onClick: onAdd,
                }}
                expandable={{
                  expandedRowKeys: expandedKeys,
                  onExpandedRowsChange: (keys) =>
                    setExpandedKeys(keys.slice(-1)),
                  expandedRowRender: (row) => (
                    <div className="w-0 min-w-full overflow-hidden">
                      <InlineCardShell>
                        <InlineCardBody>
                          <InlineCardSplit
                            left={
                              <InlineCardColumnStack>
                                <InfoRow
                                  label={t("tableHeaders.type")}
                                  value={row.typeName}
                                />
                                <InfoRow label={t("common:labels.status")}>
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
                                {null}
                              </InlineCardColumnStack>
                            }
                          />
                        </InlineCardBody>
                      </InlineCardShell>
                    </div>
                  ),
                }}
              />
            )}
            {connectionsActiveTab === "connections" && <ThirdPartyDisclaimer />}
          </div>
        </div>
      </ScrollPreservation>
    </DetailPanelContainer>
  );
};
