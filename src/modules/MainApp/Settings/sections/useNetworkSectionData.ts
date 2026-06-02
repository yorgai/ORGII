import { invoke } from "@tauri-apps/api/core";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import Message from "@src/components/Message";
import {
  getRestrictedProviders,
  getRestrictedServices,
  isRegionSanctioned,
} from "@src/config/providerRegions";
import { useNetworkMonitor } from "@src/hooks/perf";
import {
  monitorScanningAtom,
  networkRefreshTriggerAtom,
} from "@src/store/ui/settingsPanelAtoms";

export interface VpnInterface {
  name: string;
  kind: string;
  status: "active" | "idle" | "down";
}

export interface VpnStatus {
  detected: boolean;
  interfaces: VpnInterface[];
}

export function useNetworkSectionData() {
  const { t } = useTranslation("settings");

  const {
    connection,
    inflightCount,
    stats,
    geo,
    providerRegions,
    fetchGeo,
    refreshGeo,
    resetStats,
  } = useNetworkMonitor();

  const setScanning = useSetAtom(monitorScanningAtom);
  const networkRefreshTrigger = useAtomValue(networkRefreshTriggerAtom);

  const [vpnStatus, setVpnStatus] = useState<VpnStatus | null>(null);
  const vpnLoadingRef = useRef(false);

  const fetchVpn = useCallback(() => {
    if (vpnLoadingRef.current) return Promise.resolve();
    vpnLoadingRef.current = true;
    return invoke<VpnStatus | null>("detect_vpn")
      .then((status) => {
        if (status == null) {
          setVpnStatus(null);
          return;
        }
        setVpnStatus({
          detected: Boolean(status.detected),
          interfaces: Array.isArray(status.interfaces) ? status.interfaces : [],
        });
      })
      .catch((err) => {
        console.warn("[useNetworkSectionData] detect_vpn failed:", err);
      })
      .finally(() => {
        vpnLoadingRef.current = false;
      });
  }, []);

  const handleNetworkRefresh = useCallback(async () => {
    setScanning(true);
    try {
      resetStats();
      await Promise.all([refreshGeo(), fetchVpn()]);
      Message.success(
        t("common:refreshToast.successName", { name: t("common:tabs.network") })
      );
    } finally {
      setScanning(false);
    }
  }, [resetStats, refreshGeo, fetchVpn, setScanning, t]);

  useEffect(() => {
    if (networkRefreshTrigger > 0) {
      handleNetworkRefresh();
    }
  }, [networkRefreshTrigger, handleNetworkRefresh]);

  const mountFetchedRef = useRef(false);
  useEffect(() => {
    if (mountFetchedRef.current) return;
    mountFetchedRef.current = true;
    void Promise.all([fetchVpn(), fetchGeo()]);
  }, [fetchVpn, fetchGeo]);

  const connectionLabel =
    connection === "online"
      ? t("common:status.online")
      : t("common:status.offline");

  const summaryParts: string[] = [connectionLabel];
  if (stats.total > 0) {
    summaryParts.push(
      stats.total +
        " " +
        t("monitor.networkRequests") +
        " \u00b7 " +
        Math.round(stats.avgLatencyMs) +
        "ms " +
        t("monitor.networkAvg")
    );
  }
  if (inflightCount > 0) {
    summaryParts.push(inflightCount + " " + t("monitor.networkInflight"));
  }

  const sortedDomains = Object.entries(stats.byDomain).sort(
    ([, domainA], [, domainB]) => domainB.total - domainA.total
  );

  const successPercent =
    stats.total > 0 ? ((stats.total - stats.failed) / stats.total) * 100 : 100;

  const successColor =
    stats.failed === 0
      ? "bg-green-500"
      : stats.failed / stats.total > 0.1
        ? "bg-red-500"
        : "bg-yellow-500";

  const locationText = [geo.city, geo.region, geo.country]
    .filter(Boolean)
    .join(", ");

  const restrictedProviders = geo.country
    ? getRestrictedProviders(geo.country)
    : [];
  const sanctioned = geo.country ? isRegionSanctioned(geo.country) : false;
  const restrictedServices = geo.country
    ? getRestrictedServices(geo.country)
    : [];
  const hasAnyRestriction = restrictedProviders.length > 0 || sanctioned;

  return {
    // network monitor
    connection,
    stats,
    geo,
    providerRegions,
    summaryParts,
    sortedDomains,
    successPercent,
    successColor,
    locationText,
    // region restrictions
    restrictedProviders,
    sanctioned,
    restrictedServices,
    hasAnyRestriction,
    // vpn
    vpnStatus,
  };
}
