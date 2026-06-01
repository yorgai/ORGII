/**
 * useSyncSection
 *
 * All state, async handlers, and derived values for SyncSection.
 * Extracted to keep SyncSection.tsx under 600 lines.
 */
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  type SyncConnection,
  syncConnectionsApi,
} from "@src/api/http/integrations";
import {
  type AdapterDescriptor,
  type ConflictRow,
  type OutboxProblemRow,
  type SyncStatusReport,
  projectSyncApi,
} from "@src/api/http/project/sync";
import { Message } from "@src/components/Message";
import { projectSyncStatusAtom } from "@src/store/sync";
import { formatRelativeTime } from "@src/util/time/formatRelativeTime";

import { formatErrorMessage } from "./shared";

export interface UseSyncSectionReturn {
  status: SyncStatusReport | null;
  adapters: AdapterDescriptor[];
  pickerSelection: string | null;
  setPickerSelection: (v: string | null) => void;
  selectedAdapter: AdapterDescriptor | null;
  adapterOptions: { value: string; label: string }[];
  accountOptions: { value: string; label: string }[];
  selectedAccountId: string | null;
  setSelectedAccountId: (v: string | null) => void;
  attachedAdapterId: string | null;
  isAttached: boolean;
  pickerMatchesAttached: boolean;
  attaching: boolean;
  detaching: boolean;
  forcePushing: boolean;
  forcePulling: boolean;
  lastForcePullError: string | null;
  problems: OutboxProblemRow[];
  pendingRowAction: { id: number; kind: "retry" | "discard" } | null;
  conflicts: ConflictRow[];
  pendingConflictAction: {
    id: number;
    kind: "useLocal" | "useRemote" | "dismiss";
  } | null;
  lastPullLabel: string;
  pendingCount: number;
  failedCount: number;
  abandonedCount: number;
  lastError: string | null;
  handleAttach: () => Promise<void>;
  handleDetach: () => Promise<void>;
  handleForcePush: () => Promise<void>;
  handleForcePull: () => Promise<void>;
  handleRetryEntry: (entryId: number) => Promise<void>;
  handleDiscardEntry: (entryId: number) => Promise<void>;
  handleUseLocal: (conflictId: number) => Promise<void>;
  handleUseRemote: (conflictId: number) => Promise<void>;
  handleDismissConflict: (conflictId: number) => Promise<void>;
}

export function useSyncSection(slug: string): UseSyncSectionReturn {
  const { t } = useTranslation("projects");

  const liveStatusMap = useAtomValue(projectSyncStatusAtom);

  const [adapters, setAdapters] = useState<AdapterDescriptor[]>([]);
  const [syncConnections, setSyncConnections] = useState<SyncConnection[]>([]);
  const [initialStatus, setInitialStatus] = useState<SyncStatusReport | null>(
    null
  );
  const [pickerSelection, setPickerSelection] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    null
  );

  // Live event-driven status takes precedence; fall back to the one-shot fetch
  const status: SyncStatusReport | null =
    liveStatusMap.get(slug) ?? initialStatus;

  const [attaching, setAttaching] = useState(false);
  const [detaching, setDetaching] = useState(false);
  const [forcePushing, setForcePushing] = useState(false);
  const [forcePulling, setForcePulling] = useState(false);
  const [lastForcePullError, setLastForcePullError] = useState<string | null>(
    null
  );
  const [problems, setProblems] = useState<OutboxProblemRow[]>([]);
  const [pendingRowAction, setPendingRowAction] = useState<{
    id: number;
    kind: "retry" | "discard";
  } | null>(null);
  const [conflicts, setConflicts] = useState<ConflictRow[]>([]);
  const [pendingConflictAction, setPendingConflictAction] = useState<{
    id: number;
    kind: "useLocal" | "useRemote" | "dismiss";
  } | null>(null);

  const failedAbandonedKey = `${status?.failed_count ?? 0}:${status?.abandoned_count ?? 0}`;

  // ── Load adapters once ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    projectSyncApi
      .listAdapters()
      .then((descriptors) => {
        if (!cancelled) setAdapters(descriptors);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          Message.error(
            t("settings.sync.errors.attachFailed", {
              error: formatErrorMessage(error),
            })
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    syncConnectionsApi
      .list()
      .then((connections) => {
        if (!cancelled) setSyncConnections(connections);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          Message.error(
            t("settings.sync.errors.attachFailed", {
              error: formatErrorMessage(error),
            })
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  // ── One-shot status fetch on mount / slug change ──────────────────────────
  useEffect(() => {
    let cancelled = false;
    projectSyncApi
      .status(slug)
      .then((report) => {
        if (!cancelled) setInitialStatus(report);
      })
      .catch((_err) => {
        /* silent — live events correct stale data */
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // ── Sync picker with attached adapter ────────────────────────────────────
  const attachedAdapterId = status?.adapter_id ?? null;
  const attachedConnectionId = status?.sync_connection_id ?? null;
  useEffect(() => {
    if (attachedAdapterId) {
      setPickerSelection(attachedAdapterId);
      return;
    }
    if (adapters.length > 0)
      setPickerSelection((prev) => prev ?? adapters[0].id);
  }, [attachedAdapterId, adapters]);

  useEffect(() => {
    if (attachedConnectionId) {
      setSelectedAccountId(attachedConnectionId);
    }
  }, [attachedConnectionId]);

  const selectedAdapter = useMemo(
    () => adapters.find((entry) => entry.id === pickerSelection) ?? null,
    [adapters, pickerSelection]
  );

  const adapterOptions = useMemo(
    () => adapters.map((entry) => ({ value: entry.id, label: entry.label })),
    [adapters]
  );

  const accountOptions = useMemo(
    () =>
      syncConnections
        .filter((connection) => connection.adapter_id === pickerSelection)
        .map((connection) => ({
          value: connection.id,
          label: connection.account_email
            ? `${connection.label} (${connection.account_email})`
            : connection.label,
        })),
    [pickerSelection, syncConnections]
  );

  useEffect(() => {
    setSelectedAccountId((previous) =>
      previous && accountOptions.some((option) => option.value === previous)
        ? previous
        : (accountOptions[0]?.value ?? null)
    );
  }, [accountOptions]);

  const isAttached = attachedAdapterId !== null;
  const pickerMatchesAttached = pickerSelection === attachedAdapterId;

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const refreshStatus = useCallback(async () => {
    try {
      const report = await projectSyncApi.status(slug);
      setInitialStatus(report);
    } catch (_err) {
      // Silent — same rationale as the mount fetch
    }
  }, [slug]);

  const refreshProblems = useCallback(async () => {
    try {
      const rows = await projectSyncApi.listProblems(slug);
      setProblems(rows);
    } catch (error) {
      Message.error(
        t("settings.sync.errors.listFailed", {
          error: formatErrorMessage(error),
        })
      );
    }
  }, [slug, t]);

  const refreshConflicts = useCallback(async () => {
    try {
      const rows = await projectSyncApi.conflictsList(slug);
      setConflicts(rows);
    } catch (error) {
      Message.error(
        t("settings.sync.conflicts.errors.listFailed", {
          error: formatErrorMessage(error),
        })
      );
    }
  }, [slug, t]);

  // ── Problems/conflicts effects ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await projectSyncApi.listProblems(slug);
        if (!cancelled) setProblems(rows);
      } catch (error) {
        if (!cancelled)
          Message.error(
            t("settings.sync.errors.listFailed", {
              error: formatErrorMessage(error),
            })
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, failedAbandonedKey, t]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await projectSyncApi.conflictsList(slug);
        if (!cancelled) setConflicts(rows);
      } catch (_err) {
        // Silent on mount — panel falls back to hidden
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, failedAbandonedKey]);

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handleAttach = useCallback(async () => {
    if (!pickerSelection || !selectedAccountId) return;
    setAttaching(true);
    try {
      await projectSyncApi.attachAdapter(
        slug,
        pickerSelection,
        selectedAccountId
      );
      await refreshStatus();
    } catch (error) {
      Message.error(
        t("settings.sync.errors.attachFailed", {
          error: formatErrorMessage(error),
        })
      );
    } finally {
      setAttaching(false);
    }
  }, [pickerSelection, refreshStatus, selectedAccountId, slug, t]);

  const handleDetach = useCallback(async () => {
    setDetaching(true);
    try {
      await projectSyncApi.detachAdapter(slug);
      await refreshStatus();
    } catch (error) {
      Message.error(
        t("settings.sync.errors.detachFailed", {
          error: formatErrorMessage(error),
        })
      );
    } finally {
      setDetaching(false);
    }
  }, [refreshStatus, slug, t]);

  const handleForcePush = useCallback(async () => {
    setForcePushing(true);
    try {
      const requeued = await projectSyncApi.forcePush(slug);
      Message.success(
        t("settings.sync.status.forcePushResult", { count: requeued })
      );
      await refreshStatus();
    } catch (error) {
      Message.error(
        t("settings.sync.errors.forcePushFailed", {
          error: formatErrorMessage(error),
        })
      );
    } finally {
      setForcePushing(false);
    }
  }, [refreshStatus, slug, t]);

  const handleForcePull = useCallback(async () => {
    setForcePulling(true);
    setLastForcePullError(null);
    try {
      await projectSyncApi.forcePull(slug);
      Message.success(t("settings.sync.status.forcePullSuccess"));
      await refreshStatus();
    } catch (error) {
      const formatted = formatErrorMessage(error);
      setLastForcePullError(formatted);
      Message.error(
        t("settings.sync.errors.forcePullFailed", { error: formatted })
      );
    } finally {
      setForcePulling(false);
    }
  }, [refreshStatus, slug, t]);

  const handleRetryEntry = useCallback(
    async (entryId: number) => {
      setPendingRowAction({ id: entryId, kind: "retry" });
      try {
        await projectSyncApi.retryEntry(entryId);
        await refreshProblems();
        await refreshStatus();
      } catch (error) {
        Message.error(
          t("settings.sync.errors.retryFailed", {
            error: formatErrorMessage(error),
          })
        );
      } finally {
        setPendingRowAction(null);
      }
    },
    [refreshProblems, refreshStatus, t]
  );

  const handleDiscardEntry = useCallback(
    async (entryId: number) => {
      setPendingRowAction({ id: entryId, kind: "discard" });
      try {
        await projectSyncApi.discardEntry(entryId);
        await refreshProblems();
        await refreshStatus();
      } catch (error) {
        Message.error(
          t("settings.sync.errors.discardFailed", {
            error: formatErrorMessage(error),
          })
        );
      } finally {
        setPendingRowAction(null);
      }
    },
    [refreshProblems, refreshStatus, t]
  );

  const handleUseLocal = useCallback(
    async (conflictId: number) => {
      setPendingConflictAction({ id: conflictId, kind: "useLocal" });
      try {
        await projectSyncApi.conflictUseLocal(conflictId);
        await refreshConflicts();
        await refreshStatus();
      } catch (error) {
        Message.error(
          t("settings.sync.conflicts.errors.useLocalFailed", {
            error: formatErrorMessage(error),
          })
        );
      } finally {
        setPendingConflictAction(null);
      }
    },
    [refreshConflicts, refreshStatus, t]
  );

  const handleUseRemote = useCallback(
    async (conflictId: number) => {
      setPendingConflictAction({ id: conflictId, kind: "useRemote" });
      try {
        await projectSyncApi.conflictUseRemote(conflictId);
        await refreshConflicts();
        await refreshStatus();
      } catch (error) {
        Message.error(
          t("settings.sync.conflicts.errors.useRemoteFailed", {
            error: formatErrorMessage(error),
          })
        );
      } finally {
        setPendingConflictAction(null);
      }
    },
    [refreshConflicts, refreshStatus, t]
  );

  const handleDismissConflict = useCallback(
    async (conflictId: number) => {
      setPendingConflictAction({ id: conflictId, kind: "dismiss" });
      try {
        await projectSyncApi.conflictDismiss(conflictId);
        await refreshConflicts();
      } catch (error) {
        Message.error(
          t("settings.sync.conflicts.errors.dismissFailed", {
            error: formatErrorMessage(error),
          })
        );
      } finally {
        setPendingConflictAction(null);
      }
    },
    [refreshConflicts, t]
  );

  // ── Derived display ───────────────────────────────────────────────────────
  const lastPullLabel = useMemo(() => {
    const lastPullAt = status?.last_pull_at ?? null;
    if (lastPullAt === null) return t("settings.sync.status.lastPullNever");
    const relative = formatRelativeTime(lastPullAt * 1000, "long");
    return t("settings.sync.status.lastPullAgo", { time: relative });
  }, [status?.last_pull_at, t]);

  return {
    status,
    adapters,
    pickerSelection,
    setPickerSelection,
    selectedAdapter,
    adapterOptions,
    accountOptions,
    selectedAccountId,
    setSelectedAccountId,
    attachedAdapterId,
    isAttached,
    pickerMatchesAttached,
    attaching,
    detaching,
    forcePushing,
    forcePulling,
    lastForcePullError,
    problems,
    pendingRowAction,
    conflicts,
    pendingConflictAction,
    lastPullLabel,
    pendingCount: status?.pending_count ?? 0,
    failedCount: status?.failed_count ?? 0,
    abandonedCount: status?.abandoned_count ?? 0,
    lastError: status?.last_error ?? null,
    handleAttach,
    handleDetach,
    handleForcePush,
    handleForcePull,
    handleRetryEntry,
    handleDiscardEntry,
    handleUseLocal,
    handleUseRemote,
    handleDismissConflict,
  };
}
