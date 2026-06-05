import { open } from "@tauri-apps/plugin-dialog";
import {
  CheckCircle2,
  FlaskConical,
  FolderOpen,
  TriangleAlert,
} from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  BENCHMARK_EVALUATION_MODE,
  type BenchmarkEvaluationMode,
} from "@src/api/tauri/benchmark";
import Button from "@src/components/Button";
import InlineAlert from "@src/components/InlineAlert";
import Input from "@src/components/Input";
import Select, { type SelectOption } from "@src/components/Select";
import TabPill from "@src/components/TabPill";
import type { TabPillItem } from "@src/components/TabPill";
import { SURFACE_TOKENS } from "@src/config/surfaceTokens";
import { useBenchmarkRun } from "@src/hooks/benchmark/useBenchmarkRun";
import { useBenchmarkTasks } from "@src/hooks/benchmark/useBenchmarkTasks";

const BENCHMARK_RUN_TYPE = {
  SINGLE: "single",
  BATCH: "batch",
} as const;

type BenchmarkRunType =
  (typeof BENCHMARK_RUN_TYPE)[keyof typeof BENCHMARK_RUN_TYPE];

interface UseBenchmarkSessionCreatorSlotsOptions {
  enabled: boolean;
  onOpenBenchmarkTab: () => void;
}

interface BenchmarkSessionCreatorSlots {
  footerSlot: React.ReactNode;
  leadingActionSlot: React.ReactNode;
}

export function useBenchmarkSessionCreatorSlots({
  enabled,
  onOpenBenchmarkTab,
}: UseBenchmarkSessionCreatorSlotsOptions): BenchmarkSessionCreatorSlots {
  const { t } = useTranslation(["sessions", "common"]);
  const [isBenchmarkPanelOpen, setIsBenchmarkPanelOpen] = useState(true);
  const [benchmarkRunType, setBenchmarkRunType] = useState<BenchmarkRunType>(
    BENCHMARK_RUN_TYPE.SINGLE
  );
  const {
    error: benchmarkError,
    isLoadingTasks: isLoadingBenchmarkTasks,
    loadTasks: loadBenchmarkTasks,
    selectedTaskId: selectedBenchmarkTaskId,
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

  const benchmarkRunTypeOptions = useMemo<TabPillItem[]>(
    () => [
      {
        key: BENCHMARK_RUN_TYPE.SINGLE,
        label: t("creator.benchmark.singleRun"),
      },
      {
        key: BENCHMARK_RUN_TYPE.BATCH,
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

  const benchmarkTaskOptions = useMemo<SelectOption[]>(
    () =>
      benchmarkTasks.map((task) => ({
        value: task.taskId,
        triggerLabel: task.taskId,
        label: (
          <span className="flex min-w-0 flex-col gap-0.5 py-0.5">
            <span className="truncate text-[12px] font-medium text-text-1">
              {task.taskId}
            </span>
            <span className="truncate text-[11px] text-text-3">
              {task.repo ? `${task.repo} · ` : ""}
              {task.title}
            </span>
          </span>
        ),
      })),
    [benchmarkTasks]
  );

  const handleBenchmarkRunTypeChange = useCallback((value: string) => {
    if (
      value === BENCHMARK_RUN_TYPE.SINGLE ||
      value === BENCHMARK_RUN_TYPE.BATCH
    ) {
      setBenchmarkRunType(value);
    }
  }, []);

  const handleBenchmarkTaskChange = useCallback(
    (value: string | number | (string | number)[]) => {
      if (Array.isArray(value)) return;
      setSelectedBenchmarkTaskId(String(value));
    },
    [setSelectedBenchmarkTaskId]
  );

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

  const handleToggleBenchmarkPanel = useCallback(() => {
    setIsBenchmarkPanelOpen((currentOpen) => !currentOpen);
  }, []);

  const leadingActionSlot = enabled ? (
    <Button
      variant="secondary"
      appearance="outline"
      size="small"
      shape="round"
      iconOnly
      icon={<FlaskConical size={14} strokeWidth={1.75} />}
      title={t("creator.benchmark.title")}
      aria-label={t("creator.benchmark.title")}
      aria-expanded={isBenchmarkPanelOpen}
      aria-controls="session-creator-benchmark-panel"
      onClick={handleToggleBenchmarkPanel}
      className={
        isBenchmarkPanelOpen
          ? "mr-1 shrink-0 !bg-fill-1 !text-primary-6"
          : "mr-1 shrink-0"
      }
    />
  ) : null;

  const footerSlot =
    enabled && isBenchmarkPanelOpen ? (
      <div
        id="session-creator-benchmark-panel"
        className={`flex w-full flex-col gap-3 rounded-[12px] border border-solid border-border-2 p-3 ${SURFACE_TOKENS.surface}`}
      >
        <div className="flex flex-col gap-2">
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
              disabled={isLoadingBenchmarkTasks || !benchmarkSourcePath.trim()}
            >
              {t("common:actions.load")}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-solid border-border-2 pt-3">
          <div className="text-[13px] font-semibold text-text-1">
            {t("creator.benchmark.runType")}
          </div>
          <TabPill
            tabs={benchmarkRunTypeOptions}
            activeTab={benchmarkRunType}
            onChange={handleBenchmarkRunTypeChange}
            variant="pill"
            size="small"
            className="w-fit"
          />
        </div>

        <div className="flex flex-col gap-2 border-t border-solid border-border-2 pt-3">
          <div className="text-[13px] font-semibold text-text-1">
            {t("creator.benchmark.taskSelectionTitle")}
          </div>
          <Select
            value={selectedBenchmarkTaskId ?? undefined}
            options={benchmarkTaskOptions}
            onChange={handleBenchmarkTaskChange}
            placeholder={t("creator.benchmark.taskSelectStubOption")}
            loading={isLoadingBenchmarkTasks}
            disabled={isLoadingBenchmarkTasks || benchmarkTasks.length === 0}
            showSearch
            size="small"
            radius="lg"
            dropdownMinWidth={280}
            className="w-full"
          />
          {benchmarkError ? (
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
          <p className="m-0 text-[12px] leading-5 text-text-3">
            {isBenchmarkPatchOnlyMode
              ? t("creator.benchmark.patchOnlyWorktreeDescription")
              : t("creator.benchmark.localDockerDescription")}
          </p>
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
              disabled={isBenchmarkRunLoading || !selectedBenchmarkTaskId}
            >
              {t("creator.benchmark.runPreflight")}
            </Button>
            <div
              className={`ml-auto text-[12px] font-medium leading-5 ${benchmarkPreflightStatusClass}`}
            >
              {benchmarkPreflight
                ? t("creator.benchmark.preflightSummary", {
                    ready: benchmarkPreflightReadyCount,
                    total: benchmarkPreflightTotalCount,
                  })
                : t("creator.benchmark.preflightTitle")}
            </div>
          </div>

          {benchmarkRunError ? (
            <div className="allow-select-deep scrollbar-overlay max-h-24 w-full overflow-y-auto break-words rounded-lg border border-solid border-danger-3 px-3 py-2 text-left text-[12px] leading-5 text-danger-6">
              {benchmarkRunError}
            </div>
          ) : benchmarkPreflightChecks.length > 0 ? (
            <div className="allow-select-deep scrollbar-overlay flex max-h-40 w-full flex-col gap-2 overflow-y-auto rounded-lg border border-solid border-border-2 px-3 py-2 text-left text-[12px] leading-5">
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
          ) : null}
        </div>
      </div>
    ) : null;

  return { footerSlot, leadingActionSlot };
}
