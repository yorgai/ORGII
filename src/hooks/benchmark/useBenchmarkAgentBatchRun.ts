import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo } from "react";

import {
  BENCHMARK_AGENT_BATCH_STATUS,
  type BenchmarkAgentLaunchSelection,
  benchmarkApi,
} from "@src/api/tauri/benchmark";
import { DISPATCH_CATEGORY } from "@src/api/tauri/session";
import { useAdvancedConfig } from "@src/engines/SessionCore/hooks/session/useSessionCreator/useAdvancedConfig";
import { resolveKeys } from "@src/engines/SessionCore/hooks/session/useSessionCreator/useSessionLaunch/resolveKeys";
import {
  benchmarkActiveBatchIdAtom,
  benchmarkActiveBatchTaskIdAtom,
  benchmarkAgentBatchErrorAtom,
  benchmarkAgentBatchLoadingAtom,
  benchmarkAgentBatchStatusAtom,
  benchmarkBatchConcurrencyAtom,
  benchmarkBatchSelectedTaskIdsAtom,
  benchmarkKindAtom,
  benchmarkRunTypeAtom,
  benchmarkSelectedTaskIdAtom,
  benchmarkSourcePathAtom,
} from "@src/store/benchmark";
import {
  SESSION_TARGET_KIND,
  creatorDefaultExecModeAtom,
  sessionCreatorStateAtom,
} from "@src/store/session";
import {
  createBenchmarkTab,
  openTab,
  workstationLayoutAtom,
} from "@src/store/workstation/tabs";

const AGENT_BATCH_STATUS_POLL_INTERVAL_MS = 2_000;

export function useBenchmarkAgentBatchRun() {
  const kind = useAtomValue(benchmarkKindAtom);
  const sourcePath = useAtomValue(benchmarkSourcePathAtom);
  const selectedTaskId = useAtomValue(benchmarkSelectedTaskIdAtom);
  const runType = useAtomValue(benchmarkRunTypeAtom);
  const selectedBatchTaskIds = useAtomValue(benchmarkBatchSelectedTaskIdsAtom);
  const concurrency = useAtomValue(benchmarkBatchConcurrencyAtom);
  const creatorState = useAtomValue(sessionCreatorStateAtom);
  const agentExecMode = useAtomValue(creatorDefaultExecModeAtom);
  const { advancedConfig } = useAdvancedConfig();
  const [batchStatus, setBatchStatus] = useAtom(benchmarkAgentBatchStatusAtom);
  const [isBatchLoading, setIsBatchLoading] = useAtom(
    benchmarkAgentBatchLoadingAtom
  );
  const setActiveBatchId = useSetAtom(benchmarkActiveBatchIdAtom);
  const setActiveBatchTaskId = useSetAtom(benchmarkActiveBatchTaskIdAtom);
  const setBatchError = useSetAtom(benchmarkAgentBatchErrorAtom);
  const setWorkstationLayout = useSetAtom(workstationLayoutAtom);

  const taskIdsForLaunch = useMemo(() => {
    if (runType === "single") {
      return selectedTaskId ? [selectedTaskId] : [];
    }
    return selectedBatchTaskIds;
  }, [runType, selectedBatchTaskIds, selectedTaskId]);

  const buildLaunchSelection = useCallback(async () => {
    const keySource = advancedConfig.keySource ?? "own_key";
    const resolvedKeys = await resolveKeys(keySource, advancedConfig, {
      onAuthError: () => {
        setBatchError("Please sign in before launching hosted-key benchmarks.");
      },
    });
    if (!resolvedKeys) {
      return null;
    }

    const isRustAgent =
      creatorState.dispatchCategory === DISPATCH_CATEGORY.RUST_AGENT;
    const launch: BenchmarkAgentLaunchSelection = {
      category: creatorState.dispatchCategory,
      workspacePath: creatorState.source?.repoPath || undefined,
      keySource: resolvedKeys.keySource,
      accountId: resolvedKeys.accountId,
      model: resolvedKeys.model,
      nativeHarnessType: isRustAgent
        ? resolvedKeys.nativeHarnessType
        : undefined,
      platform: resolvedKeys.cliAgentType,
      branch: resolvedKeys.branch ?? creatorState.source?.branch,
      hostedToken: resolvedKeys.hostedToken,
      tier: resolvedKeys.tier,
      agentDefinitionId:
        isRustAgent && creatorState.targetKind === SESSION_TARGET_KIND.AGENT
          ? (creatorState.selectedAgentDefinitionId ?? undefined)
          : undefined,
      agentOrgId:
        isRustAgent && creatorState.targetKind === SESSION_TARGET_KIND.AGENT_ORG
          ? (creatorState.selectedAgentOrgId ?? undefined)
          : undefined,
      agentOrgMemberOverrides: creatorState.selectedAgentOrgId
        ? advancedConfig.agentOrgMemberOverrides
        : undefined,
      applyAgentOrgMemberOverridesForFuture:
        creatorState.selectedAgentOrgId &&
        advancedConfig.applyAgentOrgMemberOverridesForFuture !== false
          ? true
          : undefined,
      mode: agentExecMode,
    };
    return launch;
  }, [advancedConfig, agentExecMode, creatorState, setBatchError]);

  const refreshBatchStatus = useCallback(async () => {
    if (!batchStatus?.batchId) {
      return null;
    }
    const nextStatus = await benchmarkApi.getAgentBatchStatus({
      batchId: batchStatus.batchId,
    });
    setBatchStatus(nextStatus);
    return nextStatus;
  }, [batchStatus?.batchId, setBatchStatus]);

  const startBatch = useCallback(async () => {
    const trimmedSourcePath = sourcePath.trim();
    if (!trimmedSourcePath) {
      setBatchError("Select a benchmark source folder before launching.");
      return null;
    }
    if (taskIdsForLaunch.length === 0) {
      setBatchError("Select at least one benchmark task before launching.");
      return null;
    }

    setIsBatchLoading(true);
    setBatchError(null);
    try {
      const launch = await buildLaunchSelection();
      if (!launch) {
        return null;
      }
      const status = await benchmarkApi.startAgentBatch({
        kind,
        sourcePath: trimmedSourcePath,
        taskIds: taskIdsForLaunch,
        launch,
        concurrency,
      });
      setBatchStatus(status);
      setActiveBatchId(status.batchId);
      setActiveBatchTaskId(null);
      const tab = createBenchmarkTab({ batchId: status.batchId });
      setWorkstationLayout((previous) => ({
        ...previous,
        mainPane: openTab(previous.mainPane, tab),
      }));
      return status;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBatchError(message);
      return null;
    } finally {
      setIsBatchLoading(false);
    }
  }, [
    buildLaunchSelection,
    concurrency,
    kind,
    setActiveBatchId,
    setActiveBatchTaskId,
    setBatchError,
    setBatchStatus,
    setIsBatchLoading,
    setWorkstationLayout,
    sourcePath,
    taskIdsForLaunch,
  ]);

  const cancelBatch = useCallback(async () => {
    if (!batchStatus?.batchId) {
      return null;
    }
    setIsBatchLoading(true);
    setBatchError(null);
    try {
      const status = await benchmarkApi.cancelAgentBatch({
        batchId: batchStatus.batchId,
      });
      setBatchStatus(status);
      return status;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBatchError(message);
      return null;
    } finally {
      setIsBatchLoading(false);
    }
  }, [batchStatus?.batchId, setBatchError, setBatchStatus, setIsBatchLoading]);

  useEffect(() => {
    if (
      !batchStatus?.batchId ||
      batchStatus.status !== BENCHMARK_AGENT_BATCH_STATUS.RUNNING
    ) {
      return undefined;
    }

    let cancelled = false;
    const intervalId = window.setInterval(() => {
      benchmarkApi
        .getAgentBatchStatus({ batchId: batchStatus.batchId })
        .then((status) => {
          if (!cancelled) {
            setBatchStatus(status);
          }
        })
        .catch((error) => {
          if (!cancelled) {
            const message =
              error instanceof Error ? error.message : String(error);
            setBatchError(message);
          }
        });
    }, AGENT_BATCH_STATUS_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    batchStatus?.batchId,
    batchStatus?.status,
    setBatchError,
    setBatchStatus,
  ]);

  return {
    batchStatus,
    cancelBatch,
    isBatchLoading,
    refreshBatchStatus,
    startBatch,
    taskIdsForLaunch,
  };
}
