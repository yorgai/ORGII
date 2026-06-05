import { open } from "@tauri-apps/plugin-dialog";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clipboard,
  FolderOpen,
  Search,
  TriangleAlert,
} from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  BENCHMARK_AGENT_BATCH_STATUS,
  BENCHMARK_EVALUATION_MODE,
  BENCHMARK_KIND,
  BENCHMARK_RUN_TYPE,
  type BenchmarkEvaluationMode,
} from "@src/api/tauri/benchmark";
import Button from "@src/components/Button";
import Checkbox from "@src/components/Checkbox";
import InlineAlert from "@src/components/InlineAlert";
import Input from "@src/components/Input";
import Select, { type SelectOption } from "@src/components/Select";
import { SURFACE_TOKENS } from "@src/config/surfaceTokens";
import { useBenchmarkAgentBatchRun } from "@src/hooks/benchmark/useBenchmarkAgentBatchRun";
import { useBenchmarkRun } from "@src/hooks/benchmark/useBenchmarkRun";
import { useBenchmarkTasks } from "@src/hooks/benchmark/useBenchmarkTasks";
import {
  benchmarkActiveBatchTaskIdAtom,
  benchmarkAgentBatchErrorAtom,
  benchmarkBatchConcurrencyAtom,
  benchmarkBatchSelectedTaskIdsAtom,
  benchmarkRunTypeAtom,
} from "@src/store/benchmark";

interface UseBenchmarkSessionCreatorSlotsOptions {
  enabled: boolean;
  onOpenBenchmarkTab: () => void;
}

interface BenchmarkSessionCreatorSlots {
  footerSlot: React.ReactNode;
}

export function useBenchmarkSessionCreatorSlots({
  enabled,
  onOpenBenchmarkTab,
}: UseBenchmarkSessionCreatorSlotsOptions): BenchmarkSessionCreatorSlots {
  const { t } = useTranslation(["sessions", "common"]);
  const [benchmarkRunType, setBenchmarkRunType] = useAtom(benchmarkRunTypeAtom);
  const [selectedBatchTaskIds, setSelectedBatchTaskIds] = useAtom(
    benchmarkBatchSelectedTaskIdsAtom
  );
  const [benchmarkBatchConcurrency, setBenchmarkBatchConcurrency] = useAtom(
    benchmarkBatchConcurrencyAtom
  );
  const benchmarkAgentBatchError = useAtomValue(benchmarkAgentBatchErrorAtom);
  const setActiveBatchTaskId = useSetAtom(benchmarkActiveBatchTaskIdAtom);
  const [benchmarkTaskSearch, setBenchmarkTaskSearch] = useState("");
  const [collapsedBenchmarkTaskGroups, setCollapsedBenchmarkTaskGroups] =
    useState<Set<string>>(() => new Set());
  const {
    error: benchmarkError,
    isLoadingTasks: isLoadingBenchmarkTasks,
    kind: benchmarkKind,
    loadTasks: loadBenchmarkTasks,
    selectedTaskId: selectedBenchmarkTaskId,
    setKind: setBenchmarkKind,
    setSelectedTaskId: setSelectedBenchmarkTaskId,
    setSourcePath: setBenchmarkSourcePath,
    sourcePath: benchmarkSourcePath,
    tasks: benchmarkTasks,
  } = useBenchmarkTasks({
    loadDetail: false,
    loadOnMount: enabled,
  });
  const {
    evaluationMode: benchmarkEvaluationMode,
    isRunLoading: isBenchmarkRunLoading,
    preflight: benchmarkPreflight,
    refreshPreflight: refreshBenchmarkPreflight,
    runError: benchmarkRunError,
    setEvaluationMode: setBenchmarkEvaluationMode,
    setTargetRepoPath: setBenchmarkTargetRepoPath,
    targetRepoPath: benchmarkTargetRepoPath,
  } = useBenchmarkRun();
  const {
    batchStatus: benchmarkAgentBatchStatus,
    cancelBatch: cancelBenchmarkAgentBatch,
    isBatchLoading: isBenchmarkAgentBatchLoading,
    startBatch: startBenchmarkAgentBatch,
    taskIdsForLaunch: benchmarkTaskIdsForLaunch,
  } = useBenchmarkAgentBatchRun();

  const benchmarkKindOptions = useMemo<SelectOption[]>(
    () => [
      {
        value: BENCHMARK_KIND.SWE_BENCH_PRO,
        label: t("creator.benchmark.kinds.sweBenchPro"),
      },
      {
        value: BENCHMARK_KIND.TERMINAL_BENCH,
        label: t("creator.benchmark.kinds.terminalBench"),
      },
    ],
    [t]
  );

  const benchmarkRunTypeOptions = useMemo<SelectOption[]>(
    () => [
      {
        value: BENCHMARK_RUN_TYPE.SINGLE,
        label: t("creator.benchmark.singleRun"),
      },
      {
        value: BENCHMARK_RUN_TYPE.BATCH,
        label: t("creator.benchmark.batchRun"),
      },
    ],
    [t]
  );

  const benchmarkEvaluationModeOptions = useMemo<SelectOption[]>(
    () => [
      {
        value: BENCHMARK_EVALUATION_MODE.LOCAL_DOCKER,
        label: t("creator.benchmark.localDocker"),
      },
      {
        value: BENCHMARK_EVALUATION_MODE.PATCH_ONLY,
        label: t("creator.benchmark.patchOnlyWorktree"),
      },
    ],
    [t]
  );

  const isBenchmarkPatchOnlyMode =
    benchmarkEvaluationMode === BENCHMARK_EVALUATION_MODE.PATCH_ONLY;
  const canLoadBenchmarkTasks = benchmarkKind === BENCHMARK_KIND.SWE_BENCH_PRO;
  const isBenchmarkAgentBatchRunning =
    benchmarkAgentBatchStatus?.status === BENCHMARK_AGENT_BATCH_STATUS.RUNNING;
  const benchmarkAgentBatchProgressText = benchmarkAgentBatchStatus
    ? t("creator.benchmark.batchProgress", {
        total: benchmarkAgentBatchStatus.totalTasks,
        queued: benchmarkAgentBatchStatus.queued,
        running: benchmarkAgentBatchStatus.running,
        launched: benchmarkAgentBatchStatus.launched,
        failed: benchmarkAgentBatchStatus.failed,
        cancelled: benchmarkAgentBatchStatus.cancelled,
      })
    : null;
  const benchmarkPreflightReadyCount =
    benchmarkPreflight?.checks.filter((check) => check.ok).length ?? 0;
  const benchmarkPreflightTotalCount = benchmarkPreflight?.checks.length ?? 0;
  const benchmarkPreflightChecks = benchmarkPreflight?.checks ?? [];
  const benchmarkPreflightReadyChecks = benchmarkPreflightChecks.filter(
    (check) => check.ok
  );
  const benchmarkPreflightNeedsSetupChecks = benchmarkPreflightChecks.filter(
    (check) => !check.ok
  );
  const benchmarkPreflightStatusClass = benchmarkPreflight?.ready
    ? "text-success-6"
    : "text-warning-6";
  const benchmarkPreflightSummary = benchmarkPreflight
    ? t("creator.benchmark.preflightSummary", {
        ready: benchmarkPreflightReadyCount,
        total: benchmarkPreflightTotalCount,
      })
    : t("creator.benchmark.preflightTitle");
  const benchmarkPreflightCopyText = useMemo(() => {
    const lines: string[] = [benchmarkPreflightSummary];
    if (benchmarkPreflightNeedsSetupChecks.length > 0) {
      lines.push("", t("creator.benchmark.needsSetup"));
      lines.push(
        ...benchmarkPreflightNeedsSetupChecks.map((check) =>
          check.detail ? `${check.label}: ${check.detail}` : check.label
        )
      );
    }
    if (benchmarkPreflightReadyChecks.length > 0) {
      lines.push("", t("creator.benchmark.ready"));
      lines.push(
        ...benchmarkPreflightReadyChecks.map((check) =>
          check.detail ? `${check.label}: ${check.detail}` : check.label
        )
      );
    }
    return lines.join("\n");
  }, [
    benchmarkPreflightNeedsSetupChecks,
    benchmarkPreflightReadyChecks,
    benchmarkPreflightSummary,
    t,
  ]);

  const normalizedBenchmarkTaskSearch = benchmarkTaskSearch
    .trim()
    .toLowerCase();
  const benchmarkTaskGroups = useMemo(() => {
    const groups = new Map<string, typeof benchmarkTasks>();
    for (const task of benchmarkTasks) {
      const groupKey = task.repo ?? t("creator.benchmark.unknownRepo");
      const searchableText =
        `${task.taskId} ${task.title} ${task.repo ?? ""}`.toLowerCase();
      if (
        normalizedBenchmarkTaskSearch &&
        !searchableText.includes(normalizedBenchmarkTaskSearch)
      ) {
        continue;
      }
      const existing = groups.get(groupKey) ?? [];
      existing.push(task);
      groups.set(groupKey, existing);
    }
    return Array.from(groups.entries()).map(([repo, tasks]) => ({
      repo,
      tasks,
    }));
  }, [benchmarkTasks, normalizedBenchmarkTaskSearch, t]);
  const visibleBenchmarkTaskIds = useMemo(
    () =>
      benchmarkTaskGroups.flatMap((group) =>
        group.tasks.map((task) => task.taskId)
      ),
    [benchmarkTaskGroups]
  );
  const allVisibleTasksSelected =
    visibleBenchmarkTaskIds.length > 0 &&
    visibleBenchmarkTaskIds.every((taskId) =>
      selectedBatchTaskIds.includes(taskId)
    );
  const someVisibleTasksSelected = visibleBenchmarkTaskIds.some((taskId) =>
    selectedBatchTaskIds.includes(taskId)
  );
  const allBenchmarkTaskGroupsCollapsed =
    benchmarkTaskGroups.length > 0 &&
    benchmarkTaskGroups.every((group) =>
      collapsedBenchmarkTaskGroups.has(group.repo)
    );

  const handleBenchmarkKindChange = useCallback(
    (value: string | number | (string | number)[]) => {
      if (typeof value !== "string") {
        return;
      }
      if (
        value !== BENCHMARK_KIND.SWE_BENCH_PRO &&
        value !== BENCHMARK_KIND.TERMINAL_BENCH
      ) {
        return;
      }
      setBenchmarkKind(value);
      setSelectedBenchmarkTaskId(null);
    },
    [setBenchmarkKind, setSelectedBenchmarkTaskId]
  );

  const handleBenchmarkRunTypeChange = useCallback(
    (value: string | number | (string | number)[]) => {
      if (typeof value !== "string") {
        return;
      }
      if (
        value === BENCHMARK_RUN_TYPE.SINGLE ||
        value === BENCHMARK_RUN_TYPE.BATCH
      ) {
        setBenchmarkRunType(value);
      }
    },
    [setBenchmarkRunType]
  );

  const handleBenchmarkTaskToggle = useCallback(
    (taskId: string, checked: boolean) => {
      setSelectedBatchTaskIds((currentTaskIds) => {
        const nextTaskIds = checked
          ? Array.from(new Set([...currentTaskIds, taskId]))
          : currentTaskIds.filter((currentTaskId) => currentTaskId !== taskId);
        setSelectedBenchmarkTaskId(checked ? taskId : (nextTaskIds[0] ?? null));
        setActiveBatchTaskId(checked ? taskId : (nextTaskIds[0] ?? null));
        return nextTaskIds;
      });
    },
    [setActiveBatchTaskId, setSelectedBatchTaskIds, setSelectedBenchmarkTaskId]
  );

  const handleBenchmarkSelectAllTasks = useCallback(
    (checked: boolean) => {
      setSelectedBatchTaskIds((currentTaskIds) => {
        const visibleTaskIdSet = new Set(visibleBenchmarkTaskIds);
        const nextTaskIds = checked
          ? Array.from(new Set([...currentTaskIds, ...visibleBenchmarkTaskIds]))
          : currentTaskIds.filter((taskId) => !visibleTaskIdSet.has(taskId));
        setSelectedBenchmarkTaskId(nextTaskIds[0] ?? null);
        setActiveBatchTaskId(nextTaskIds[0] ?? null);
        return nextTaskIds;
      });
    },
    [
      setActiveBatchTaskId,
      setSelectedBatchTaskIds,
      setSelectedBenchmarkTaskId,
      visibleBenchmarkTaskIds,
    ]
  );

  const handleBenchmarkSelectGroupTasks = useCallback(
    (taskIds: string[], checked: boolean) => {
      setSelectedBatchTaskIds((currentTaskIds) => {
        const groupTaskIdSet = new Set(taskIds);
        const nextTaskIds = checked
          ? Array.from(new Set([...currentTaskIds, ...taskIds]))
          : currentTaskIds.filter((taskId) => !groupTaskIdSet.has(taskId));
        setSelectedBenchmarkTaskId(nextTaskIds[0] ?? null);
        setActiveBatchTaskId(nextTaskIds[0] ?? null);
        return nextTaskIds;
      });
    },
    [setActiveBatchTaskId, setSelectedBatchTaskIds, setSelectedBenchmarkTaskId]
  );

  const handleBenchmarkToggleGroup = useCallback((repo: string) => {
    setCollapsedBenchmarkTaskGroups((currentGroups) => {
      const nextGroups = new Set(currentGroups);
      if (nextGroups.has(repo)) {
        nextGroups.delete(repo);
      } else {
        nextGroups.add(repo);
      }
      return nextGroups;
    });
  }, []);

  const handleBenchmarkToggleAllGroups = useCallback(() => {
    setCollapsedBenchmarkTaskGroups((currentGroups) => {
      if (
        benchmarkTaskGroups.length > 0 &&
        benchmarkTaskGroups.every((group) => currentGroups.has(group.repo))
      ) {
        return new Set();
      }
      return new Set(benchmarkTaskGroups.map((group) => group.repo));
    });
  }, [benchmarkTaskGroups]);

  const handleBenchmarkLoadTasks = useCallback(() => {
    void loadBenchmarkTasks();
  }, [loadBenchmarkTasks]);

  const handleBenchmarkPickSourceFolder = useCallback(async () => {
    const selected = await open({
      multiple: false,
      directory: true,
      title: t("creator.benchmark.sourcePath"),
    });
    if (typeof selected === "string") {
      setBenchmarkSourcePath(selected);
    }
  }, [setBenchmarkSourcePath, t]);

  const handleBenchmarkEvaluationModeChange = useCallback(
    (value: string | number | (string | number)[]) => {
      if (typeof value === "string") {
        setBenchmarkEvaluationMode(value as BenchmarkEvaluationMode);
      }
    },
    [setBenchmarkEvaluationMode]
  );

  const handleBenchmarkPreflight = useCallback(() => {
    void refreshBenchmarkPreflight();
  }, [refreshBenchmarkPreflight]);

  const handleBenchmarkConcurrencyChange = useCallback(
    (value: string) => {
      const nextValue = Number.parseInt(value, 10);
      if (Number.isNaN(nextValue)) {
        setBenchmarkBatchConcurrency(1);
        return;
      }
      setBenchmarkBatchConcurrency(Math.min(Math.max(nextValue, 1), 8));
    },
    [setBenchmarkBatchConcurrency]
  );

  const handleBenchmarkStartBatch = useCallback(() => {
    void startBenchmarkAgentBatch();
  }, [startBenchmarkAgentBatch]);

  const handleBenchmarkCancelBatch = useCallback(() => {
    void cancelBenchmarkAgentBatch();
  }, [cancelBenchmarkAgentBatch]);

  const handleCopyBenchmarkPreflight = useCallback(() => {
    void navigator.clipboard.writeText(benchmarkPreflightCopyText);
  }, [benchmarkPreflightCopyText]);

  const footerSlot = enabled ? (
    <div
      id="session-creator-benchmark-panel"
      className={`flex w-full flex-col gap-3 rounded-[12px] border border-solid border-border-2 p-3 ${SURFACE_TOKENS.surface}`}
    >
      <div className="grid grid-cols-2 gap-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="text-[13px] font-semibold text-text-1">
            {t("creator.benchmark.kindTitle")}
          </div>
          <Select
            value={benchmarkKind}
            options={benchmarkKindOptions}
            onChange={handleBenchmarkKindChange}
            size="small"
            radius="lg"
            className="w-full"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="text-[13px] font-semibold text-text-1">
            {t("creator.benchmark.runType")}
          </div>
          <Select
            value={benchmarkRunType}
            options={benchmarkRunTypeOptions}
            onChange={handleBenchmarkRunTypeChange}
            size="small"
            radius="lg"
            className="w-full"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-solid border-border-2 pt-3">
        <div className="text-[13px] font-semibold text-text-1">
          {t("creator.benchmark.sourcePath")} (
          {t("creator.benchmark.localPath")})
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={benchmarkSourcePath}
            onChange={setBenchmarkSourcePath}
            placeholder={t("creator.benchmark.sourcePathPlaceholder")}
            size="small"
            className="min-w-0 flex-1"
            allowClear
          />
          <Button
            htmlType="button"
            variant="secondary"
            size="small"
            iconOnly
            icon={<FolderOpen size={14} strokeWidth={1.75} />}
            title={t("common:actions.browse")}
            aria-label={t("common:actions.browse")}
            onClick={handleBenchmarkPickSourceFolder}
          />
          <Button
            htmlType="button"
            variant="secondary"
            size="small"
            onClick={handleBenchmarkLoadTasks}
            disabled={
              isLoadingBenchmarkTasks ||
              !benchmarkSourcePath.trim() ||
              !canLoadBenchmarkTasks
            }
          >
            {t("common:actions.load")}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-solid border-border-2 pt-3">
        <div className="flex items-center gap-2">
          <div className="shrink-0 text-[13px] font-semibold text-text-1">
            {t("creator.benchmark.taskSelectionTitle")}
          </div>
          <div className="text-[13px] text-text-2">
            {t("creator.benchmark.selectedTasks", {
              selected: selectedBatchTaskIds.length,
              total: benchmarkTasks.length,
            })}
          </div>
          <div className="flex flex-1 items-center justify-end">
            <button
              type="button"
              className="text-[12px] font-medium text-text-2 hover:text-text-1"
              onClick={handleBenchmarkToggleAllGroups}
              disabled={benchmarkTaskGroups.length === 0}
            >
              {allBenchmarkTaskGroupsCollapsed
                ? t("common:actions.expandAll")
                : t("common:actions.collapseAll")}
            </button>
            <div className="mx-2 h-4 w-px bg-border-2" />
            <Checkbox
              checked={allVisibleTasksSelected}
              indeterminate={
                !allVisibleTasksSelected && someVisibleTasksSelected
              }
              disabled={isLoadingBenchmarkTasks || benchmarkTasks.length === 0}
              size="small"
              onChange={handleBenchmarkSelectAllTasks}
            >
              {t("common:actions.selectAll")}
            </Checkbox>
          </div>
        </div>
        <Input
          value={benchmarkTaskSearch}
          onChange={setBenchmarkTaskSearch}
          placeholder={t("creator.benchmark.searchPlaceholder")}
          prefix={<Search size={14} />}
          allowClear
          size="small"
        />
        <div className="scrollbar-overlay flex max-h-64 flex-col gap-2 overflow-y-auto py-1">
          {benchmarkTaskGroups.map((group) => {
            const groupTaskIds = group.tasks.map((task) => task.taskId);
            const allGroupTasksSelected = groupTaskIds.every((taskId) =>
              selectedBatchTaskIds.includes(taskId)
            );
            const someGroupTasksSelected = groupTaskIds.some((taskId) =>
              selectedBatchTaskIds.includes(taskId)
            );
            const isCollapsed = collapsedBenchmarkTaskGroups.has(group.repo);
            return (
              <div key={group.repo} className="flex flex-col gap-1">
                <div className="flex items-center gap-2 rounded-md px-1 py-1">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    onClick={() => handleBenchmarkToggleGroup(group.repo)}
                  >
                    {isCollapsed ? (
                      <ChevronRight
                        size={14}
                        className="shrink-0 text-text-3"
                      />
                    ) : (
                      <ChevronDown size={14} className="shrink-0 text-text-3" />
                    )}
                    <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-text-3">
                      {group.repo}
                    </span>
                    <span className="shrink-0 text-[11px] text-text-3">
                      {group.tasks.length}
                    </span>
                  </button>
                  <Checkbox
                    checked={allGroupTasksSelected}
                    indeterminate={
                      !allGroupTasksSelected && someGroupTasksSelected
                    }
                    disabled={
                      isLoadingBenchmarkTasks || groupTaskIds.length === 0
                    }
                    size="small"
                    onChange={(checked) =>
                      handleBenchmarkSelectGroupTasks(groupTaskIds, checked)
                    }
                  >
                    {t("common:actions.selectAll")}
                  </Checkbox>
                </div>
                {!isCollapsed ? (
                  <div className="flex flex-col divide-y divide-border-2">
                    {group.tasks.map((task) => {
                      const checked = selectedBatchTaskIds.includes(
                        task.taskId
                      );
                      return (
                        <div
                          key={task.taskId}
                          className="flex cursor-pointer items-center gap-2 px-2 py-1.5"
                          onClick={() => {
                            if (
                              !isLoadingBenchmarkTasks &&
                              canLoadBenchmarkTasks
                            ) {
                              handleBenchmarkTaskToggle(task.taskId, !checked);
                            }
                          }}
                        >
                          <Checkbox
                            checked={checked}
                            disabled={
                              isLoadingBenchmarkTasks || !canLoadBenchmarkTasks
                            }
                            size="small"
                            onClick={(event) => event.stopPropagation()}
                            onChange={(nextChecked) =>
                              handleBenchmarkTaskToggle(
                                task.taskId,
                                nextChecked
                              )
                            }
                            ariaLabel={task.taskId}
                          />
                          <span className="min-w-0 flex-1 truncate text-left text-[12px] font-medium text-text-1">
                            {task.title || task.taskId}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        {!canLoadBenchmarkTasks ? (
          <p className="m-0 text-[12px] leading-5 text-text-3">
            {t("creator.benchmark.taskLoadingUnsupported")}
          </p>
        ) : benchmarkError ? (
          <InlineAlert
            type="danger"
            title={t("common:errors.failedToLoad")}
            className="!py-2"
          >
            <p className="m-0 break-words text-[12px] leading-5">
              {benchmarkError}
            </p>
          </InlineAlert>
        ) : !isLoadingBenchmarkTasks && benchmarkTasks.length === 0 ? (
          <p className="m-0 text-[12px] leading-5 text-text-3">
            {t("creator.benchmark.emptyTasks")}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 border-t border-solid border-border-2 pt-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="text-[13px] font-semibold text-text-1">
              {t("creator.benchmark.evaluationModeTitle")}
            </div>
            <Select
              value={benchmarkEvaluationMode}
              options={benchmarkEvaluationModeOptions}
              onChange={handleBenchmarkEvaluationModeChange}
              size="small"
              radius="lg"
              className="w-full"
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="text-[13px] font-semibold text-text-1">
              {t("creator.benchmark.concurrency")}
            </div>
            <Input
              value={String(benchmarkBatchConcurrency)}
              onChange={handleBenchmarkConcurrencyChange}
              size="small"
              className="w-full"
            />
          </div>
        </div>
        {isBenchmarkPatchOnlyMode && (
          <Input
            value={benchmarkTargetRepoPath}
            onChange={setBenchmarkTargetRepoPath}
            placeholder={t("creator.benchmark.targetRepoPathPlaceholder")}
            size="small"
            allowClear
          />
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-solid border-border-2 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            htmlType="button"
            variant="secondary"
            size="small"
            onClick={onOpenBenchmarkTab}
          >
            {t("creator.benchmark.openWorkstationTab")}
          </Button>
          <Button
            htmlType="button"
            variant="secondary"
            size="small"
            onClick={handleBenchmarkPreflight}
            disabled={
              isBenchmarkRunLoading ||
              (canLoadBenchmarkTasks && !selectedBenchmarkTaskId)
            }
          >
            {t("creator.benchmark.runPreflight")}
          </Button>
          {isBenchmarkAgentBatchRunning ? (
            <Button
              htmlType="button"
              variant="secondary"
              size="small"
              onClick={handleBenchmarkCancelBatch}
              disabled={isBenchmarkAgentBatchLoading}
            >
              {t("common:actions.cancel")}
            </Button>
          ) : (
            <Button
              htmlType="button"
              variant="primary"
              size="small"
              onClick={handleBenchmarkStartBatch}
              disabled={
                isBenchmarkAgentBatchLoading ||
                isLoadingBenchmarkTasks ||
                !canLoadBenchmarkTasks ||
                !benchmarkSourcePath.trim() ||
                benchmarkTaskIdsForLaunch.length === 0
              }
            >
              {t("creator.start")}
            </Button>
          )}
        </div>

        {benchmarkAgentBatchProgressText ? (
          <div className="rounded-lg border border-solid border-border-2 px-3 py-2 text-[12px] leading-5 text-text-2">
            {benchmarkAgentBatchProgressText}
          </div>
        ) : null}

        {benchmarkAgentBatchError ? (
          <div className="allow-select-deep scrollbar-overlay max-h-24 w-full overflow-y-auto break-words rounded-lg border border-solid border-danger-3 px-3 py-2 text-left text-[12px] leading-5 text-danger-6">
            {benchmarkAgentBatchError}
          </div>
        ) : benchmarkRunError ? (
          <div className="allow-select-deep scrollbar-overlay max-h-24 w-full overflow-y-auto break-words rounded-lg border border-solid border-danger-3 px-3 py-2 text-left text-[12px] leading-5 text-danger-6">
            {benchmarkRunError}
          </div>
        ) : benchmarkPreflightChecks.length > 0 ? (
          <div className="allow-select-deep flex max-h-40 w-full flex-col overflow-hidden rounded-lg border border-solid border-border-2 text-left text-[12px] leading-5">
            <div className="flex shrink-0 items-center gap-2 border-b border-solid border-border-2 px-3 py-2">
              <div
                className={`min-w-0 flex-1 font-medium ${benchmarkPreflightStatusClass}`}
              >
                {benchmarkPreflightSummary}
              </div>
              <Button
                htmlType="button"
                variant="tertiary"
                size="small"
                iconOnly
                icon={<Clipboard size={13} strokeWidth={1.8} />}
                title={t("common:actions.copy")}
                aria-label={t("common:actions.copy")}
                onClick={handleCopyBenchmarkPreflight}
              />
            </div>
            <div className="scrollbar-overlay flex min-h-0 flex-col gap-2 overflow-y-auto px-3 py-2">
              {benchmarkPreflightNeedsSetupChecks.length > 0 && (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1.5 font-medium text-warning-6">
                    <TriangleAlert size={13} strokeWidth={1.8} />
                    {t("creator.benchmark.needsSetup")}
                  </div>
                  <div className="flex flex-col gap-0.5 pl-[19px] text-warning-6">
                    {benchmarkPreflightNeedsSetupChecks.map((check) => (
                      <div key={check.id} className="break-words">
                        {check.detail
                          ? `${check.label}: ${check.detail}`
                          : check.label}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {benchmarkPreflightReadyChecks.length > 0 && (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1.5 font-medium text-success-6">
                    <CheckCircle2 size={13} strokeWidth={1.8} />
                    {t("creator.benchmark.ready")}
                  </div>
                  <div className="flex flex-col gap-0.5 pl-[19px] text-success-6">
                    {benchmarkPreflightReadyChecks.map((check) => (
                      <div key={check.id} className="break-words">
                        {check.detail
                          ? `${check.label}: ${check.detail}`
                          : check.label}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  ) : null;

  return { footerSlot };
}
