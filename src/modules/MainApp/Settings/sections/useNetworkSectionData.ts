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
import { currentRepoAtom } from "@src/store/repo/derived";
import {
  monitorScanningAtom,
  networkRefreshTriggerAtom,
} from "@src/store/ui/settingsPanelAtoms";

export interface GitProxyInfo {
  http_proxy: string | null;
  https_proxy: string | null;
  source: string | null;
}

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
  const currentRepo = useAtomValue(currentRepoAtom);

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

  const [proxyInfo, setProxyInfo] = useState<GitProxyInfo | null>(null);
  const proxyLoadingRef = useRef(false);
  const [proxyHttpDraft, setProxyHttpDraft] = useState("");
  const [proxyHttpsDraft, setProxyHttpsDraft] = useState("");
  const [proxySaving, setProxySaving] = useState(false);

  const syncProxyDrafts = useCallback((info: GitProxyInfo | null) => {
    setProxyHttpDraft(info?.http_proxy ?? "");
    setProxyHttpsDraft(info?.https_proxy ?? "");
  }, []);

  const fetchProxy = useCallback(
    async (cancelled?: { current: boolean }) => {
      if (proxyLoadingRef.current) return;
      proxyLoadingRef.current = true;
      try {
        const info = await invoke<GitProxyInfo>("get_git_proxy_config", {
          repoPath: currentRepo?.path ?? null,
        });
        if (!cancelled?.current) setProxyInfo(info);
        if (!cancelled?.current) syncProxyDrafts(info);
      } catch {
        if (!cancelled?.current) setProxyInfo(null);
      } finally {
        proxyLoadingRef.current = false;
      }
    },
    [currentRepo?.path, syncProxyDrafts]
  );

  const handleProxyCancel = useCallback(() => {
    syncProxyDrafts(proxyInfo);
  }, [proxyInfo, syncProxyDrafts]);

  const handleProxySave = useCallback(async () => {
    setProxySaving(true);
    try {
      await invoke("set_git_proxy_config", {
        httpProxy: proxyHttpDraft.trim(),
        httpsProxy: proxyHttpsDraft.trim(),
        repoPath: null,
        global: true,
      });
      await fetchProxy();
      Message.success(t("monitor.gitProxySaved"));
    } catch (err) {
      Message.error(
        err instanceof Error ? err.message : t("monitor.gitProxySaveFailed")
      );
    } finally {
      setProxySaving(false);
    }
  }, [proxyHttpDraft, proxyHttpsDraft, fetchProxy, t]);

  const handleProxyClear = useCallback(async () => {
    setProxySaving(true);
    try {
      await invoke("unset_git_proxy_config", {
        repoPath: null,
        global: true,
      });
      syncProxyDrafts(null);
      await fetchProxy();
      Message.success(t("monitor.gitProxyCleared"));
    } catch (err) {
      Message.error(
        err instanceof Error ? err.message : t("monitor.gitProxyClearFailed")
      );
    } finally {
      setProxySaving(false);
    }
  }, [fetchProxy, syncProxyDrafts, t]);

  const proxyDirty =
    proxyHttpDraft.trim() !== (proxyInfo?.http_proxy ?? "").trim() ||
    proxyHttpsDraft.trim() !== (proxyInfo?.https_proxy ?? "").trim();

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
      await Promise.all([refreshGeo(), fetchVpn(), fetchProxy()]);
      Message.success(
        t("common:refreshToast.successName", { name: t("common:tabs.network") })
      );
    } finally {
      setScanning(false);
    }
  }, [resetStats, refreshGeo, fetchVpn, fetchProxy, setScanning, t]);

  useEffect(() => {
    if (networkRefreshTrigger > 0) {
      handleNetworkRefresh();
    }
  }, [networkRefreshTrigger, handleNetworkRefresh]);

  const mountFetchedRef = useRef(false);
  useEffect(() => {
    if (mountFetchedRef.current) return;
    mountFetchedRef.current = true;
    const cancelled = { current: false };
    void Promise.all([fetchProxy(cancelled), fetchVpn(), fetchGeo()]);
    return () => {
      cancelled.current = true;
    };
  }, [fetchProxy, fetchVpn, fetchGeo]);

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
    // proxy
    proxyInfo,
    proxyHttpDraft,
    setProxyHttpDraft,
    proxyHttpsDraft,
    setProxyHttpsDraft,
    proxySaving,
    proxyDirty,
    handleProxyCancel,
    handleProxySave,
    handleProxyClear,
  };
}
