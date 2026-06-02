import { invoke } from "@tauri-apps/api/core";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import Message from "@src/components/Message";
import { currentRepoAtom } from "@src/store/repo/derived";

export interface GitProxyInfo {
  http_proxy: string | null;
  https_proxy: string | null;
  source: string | null;
}

export function useGitProxySettings() {
  const { t } = useTranslation("settings");
  const currentRepo = useAtomValue(currentRepoAtom);
  const proxyLoadingRef = useRef(false);
  const [proxyInfo, setProxyInfo] = useState<GitProxyInfo | null>(null);
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
        if (!cancelled?.current) {
          setProxyInfo(info);
          syncProxyDrafts(info);
        }
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

  useEffect(() => {
    const cancelled = { current: false };
    void fetchProxy(cancelled);
    return () => {
      cancelled.current = true;
    };
  }, [fetchProxy]);

  const proxyDirty =
    proxyHttpDraft.trim() !== (proxyInfo?.http_proxy ?? "").trim() ||
    proxyHttpsDraft.trim() !== (proxyInfo?.https_proxy ?? "").trim();

  return {
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
