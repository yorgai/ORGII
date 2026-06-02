/**
 * Network Monitor Section
 *
 * Displays connection status, request stats, IP/geo info, VPN status,
 * and LLM provider regions.
 * Each group is shown in its own SectionContainer (separate fill-2 containers, no collapse).
 */
import {
  SECTION_VALUE_SMALL_SECONDARY_CLASSES,
  SectionContainer,
  SectionRow,
} from "@/src/modules/shared/layouts/SectionLayout";
import React from "react";
import { useTranslation } from "react-i18next";

import InlineAlert from "@src/components/InlineAlert";
import { ProgressBar } from "@src/components/ProgressBar";
import SettingsTable, {
  SETTINGS_TABLE_CELL,
  SETTINGS_TABLE_COL,
} from "@src/components/SettingsTable";
import StatusDot from "@src/components/StatusDot";

import HttpVersionSettingsBlock from "./HttpVersionSettingsBlock";
import {
  type VpnInterface,
  useNetworkSectionData,
} from "./useNetworkSectionData";

const NetworkSection: React.FC = () => {
  const { t } = useTranslation("settings");
  const {
    stats,
    geo,
    providerRegions,
    summaryParts,
    sortedDomains,
    successPercent,
    successColor,
    locationText,
    restrictedProviders,
    sanctioned,
    restrictedServices,
    hasAnyRestriction,
    vpnStatus,
  } = useNetworkSectionData();

  const vpnInterfaces = vpnStatus?.interfaces ?? [];
  const hasVpnInterfaces = vpnInterfaces.length > 0;

  return (
    <>
      <HttpVersionSettingsBlock />

      {/* Region restriction warning */}
      {!geo.loading && hasAnyRestriction && (
        <InlineAlert
          type="warning"
          title={t("monitor.regionDetected", {
            region: locationText || geo.country,
          })}
        >
          {[
            restrictedProviders.length > 0 &&
              t("monitor.regionRestricted", {
                providers: restrictedProviders.join(", "),
              }),
            sanctioned &&
              t("monitor.regionServicesRestricted", {
                services: restrictedServices.join(", "),
              }),
          ]
            .filter(Boolean)
            .join(" ")}
        </InlineAlert>
      )}

      {/* Connection Status + Request Stats + Location */}
      <SectionContainer>
        <SectionRow
          label={t("monitor.networkTitle")}
          description={summaryParts.join(" \u00b7 ")}
        />

        <SectionRow label="" indent showHeader={false}>
          <div className="space-y-3">
            {stats.total > 0 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-2">
                    {t("monitor.networkSuccessRate")}{" "}
                    {successPercent.toFixed(1)}%
                  </span>
                  <span className="text-xs text-text-3">
                    {stats.failed > 0 &&
                      stats.failed + " " + t("monitor.networkFailed")}
                  </span>
                </div>
                <ProgressBar percent={successPercent} color={successColor} />
              </div>
            )}

            {sortedDomains.length > 0 && (
              <SettingsTable<{
                domain: string;
                total: number;
                failed: number;
                avgMs: number;
              }>
                columns={[
                  {
                    key: "domain",
                    label: t("monitor.networkByDomain"),
                    width: SETTINGS_TABLE_COL.fill,
                    renderCell: (row) => (
                      <span
                        className={`${SETTINGS_TABLE_CELL.muted} max-w-[200px] truncate`}
                      >
                        {row.domain}
                      </span>
                    ),
                  },
                  {
                    key: "total",
                    label: t("monitor.networkRequests"),
                    width: SETTINGS_TABLE_COL.valueSm,
                    align: "right",
                    renderCell: (row) => (
                      <span
                        className={`${SETTINGS_TABLE_CELL.muted} whitespace-nowrap`}
                      >
                        {row.total}
                      </span>
                    ),
                  },
                  {
                    key: "avgMs",
                    label: t("monitor.networkAvg"),
                    width: SETTINGS_TABLE_COL.valueMd,
                    align: "right",
                    renderCell: (row) => (
                      <span
                        className={`${SETTINGS_TABLE_CELL.value} whitespace-nowrap`}
                      >
                        {Math.round(row.avgMs)}ms
                      </span>
                    ),
                  },
                ]}
                rows={sortedDomains
                  .slice(0, 8)
                  .map(([domain, domainStats]) => ({
                    domain,
                    ...domainStats,
                  }))}
                getRowKey={(row) => row.domain}
                showHeader={false}
                noPx
              />
            )}
          </div>
        </SectionRow>
      </SectionContainer>

      {/* Location / IP */}
      {!geo.loading && !geo.error && geo.ip && (
        <SectionContainer>
          <SectionRow
            label={t("monitor.networkIpLocation")}
            description={
              [geo.ip, locationText].filter(Boolean).join(" \u00b7 ") ||
              "\u2014"
            }
          />
          <SectionRow label="" indent showHeader={false}>
            <SettingsTable<{ key: string; label: string; value: string }>
              columns={[
                {
                  key: "label",
                  label: t("common:common.name"),
                  width: SETTINGS_TABLE_COL.fill,
                  renderCell: (row) => (
                    <span className={SETTINGS_TABLE_CELL.muted}>
                      {row.label}
                    </span>
                  ),
                },
                {
                  key: "value",
                  label: t("common:common.details"),
                  width: SETTINGS_TABLE_COL.hug,
                  align: "right",
                  renderCell: (row) => (
                    <span
                      className={`${SETTINGS_TABLE_CELL.value} whitespace-nowrap`}
                    >
                      {row.value}
                    </span>
                  ),
                },
              ]}
              rows={[
                { key: "ip", label: "IP", value: geo.ip },
                {
                  key: "region",
                  label: t("monitor.networkRegion"),
                  value: locationText,
                },
                ...(geo.org
                  ? [
                      {
                        key: "org",
                        label: t("monitor.networkOrg"),
                        value: geo.org,
                      },
                    ]
                  : []),
              ]}
              getRowKey={(row) => row.key}
              showHeader={false}
              noPx
            />
          </SectionRow>
        </SectionContainer>
      )}

      {/* VPN */}
      {hasVpnInterfaces && (
        <SectionContainer>
          <SectionRow
            label={t("monitor.vpn")}
            description={[
              t("monitor.vpnDiscovered"),
              vpnStatus?.detected
                ? t("monitor.vpnInUse")
                : t("monitor.vpnNotInUse"),
            ].join(" \u00b7 ")}
          />
          <SectionRow label="" indent showHeader={false}>
            <SettingsTable<VpnInterface>
              columns={[
                {
                  key: "name",
                  label: t("common:common.name"),
                  width: SETTINGS_TABLE_COL.fill,
                  renderCell: (iface) => (
                    <span
                      className={
                        iface.status === "active"
                          ? SETTINGS_TABLE_CELL.primary
                          : SETTINGS_TABLE_CELL.muted
                      }
                    >
                      {iface.kind} ({iface.name})
                    </span>
                  ),
                },
                {
                  key: "status",
                  label: t("common:common.status"),
                  width: SETTINGS_TABLE_COL.hug,
                  align: "right" as const,
                  sorter: (ifaceA, ifaceB) => {
                    const order = { active: 0, idle: 1, down: 2 };
                    return (
                      (order[ifaceA.status as keyof typeof order] ?? 3) -
                      (order[ifaceB.status as keyof typeof order] ?? 3)
                    );
                  },
                  renderCell: (iface) => {
                    const isActive = iface.status === "active";
                    const color = isActive
                      ? "bg-success-6"
                      : iface.status === "idle"
                        ? "bg-warning-6"
                        : "bg-fill-3";
                    return (
                      <StatusDot
                        color={color}
                        label={t(`monitor.vpnStatus_${iface.status}`)}
                      />
                    );
                  },
                },
              ]}
              rows={[...vpnInterfaces].sort((ifaceA, ifaceB) => {
                const order = { active: 0, idle: 1, down: 2 };
                return (
                  (order[ifaceA.status] ?? 3) - (order[ifaceB.status] ?? 3)
                );
              })}
              getRowKey={(iface) => iface.name}
              showHeader={false}
              noPx
            />
          </SectionRow>
        </SectionContainer>
      )}

      {/* Provider Regions */}
      {providerRegions.length > 0 && (
        <SectionContainer>
          <SectionRow
            label={t("monitor.networkProviderRegions")}
            description={providerRegions
              .map((pr) => pr.provider + " \u2192 " + pr.region)
              .join(", ")}
          />

          <SectionRow label="" indent showHeader={false}>
            <div className="flex flex-col gap-1">
              {providerRegions.map((pr) => (
                <div
                  key={pr.provider}
                  className="flex items-center justify-between py-1.5"
                >
                  <span className={SECTION_VALUE_SMALL_SECONDARY_CLASSES}>
                    {pr.provider}
                  </span>
                  <span className={SECTION_VALUE_SMALL_SECONDARY_CLASSES}>
                    {pr.region}
                  </span>
                </div>
              ))}
            </div>
          </SectionRow>
        </SectionContainer>
      )}
    </>
  );
};

export default NetworkSection;
