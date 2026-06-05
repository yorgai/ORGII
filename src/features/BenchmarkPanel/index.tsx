import { useAtom, useAtomValue, useSetAtom } from "jotai";
import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import {
  BENCHMARK_AGENT_BATCH_STATUS,
  type BenchmarkAgentBatchItem,
} from "@src/api/tauri/benchmark";
import Button from "@src/components/Button";
import Markdown from "@src/components/MarkDown";
import { useBenchmarkAgentBatchRun } from "@src/hooks/benchmark/useBenchmarkAgentBatchRun";
import { useBenchmarkTasks } from "@src/hooks/benchmark/useBenchmarkTasks";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import {
  benchmarkActiveBatchTaskIdAtom,
  benchmarkAgentBatchStatusAtom,
} from "@src/store/benchmark";

interface BenchmarkPanelProps {
  className?: string;
}

function formatTaskMarkdown(
  taskId: string,
  title: string,
  repo: string | null | undefined,
  instruction: string
): string {
  const metadata = [repo ? `Repo: ${repo}` : null, `Task: ${taskId}`]
    .filter(Boolean)
    .join(" · ");

  return `# ${title || taskId}\n\n${metadata}\n\n---\n\n${instruction}`;
}

function itemStatusClass(status: BenchmarkAgentBatchItem["status"]): string {
  if (status === BENCHMARK_AGENT_BATCH_STATUS.LAUNCHED) {
    return "border-success-3 bg-success-1 text-success-7";
  }
  if (status === BENCHMARK_AGENT_BATCH_STATUS.FAILED) {
    return "border-danger-3 bg-danger-1 text-danger-7";
  }
  if (status === BENCHMARK_AGENT_BATCH_STATUS.CANCELLED) {
    return "border-warning-3 bg-warning-1 text-warning-7";
  }
  return "border-border-2 bg-fill-1 text-text-2";
}

export const BenchmarkPanel: React.FC<BenchmarkPanelProps> = ({
  className,
}) => {
  const { t } = useTranslation(["sessions", "common"]);
  const batchStatus = useAtomValue(benchmarkAgentBatchStatusAtom);
  const [activeTaskId, setActiveTaskId] = useAtom(
    benchmarkActiveBatchTaskIdAtom
  );
  const setBenchmarkBatchStatus = useSetAtom(benchmarkAgentBatchStatusAtom);
  const { refreshBatchStatus } = useBenchmarkAgentBatchRun();
  const { error, isLoadingDetail, selectedTask, setSelectedTaskId } =
    useBenchmarkTasks({
      loadOnMount: false,
    });

  const activeItem = useMemo(
    () =>
      activeTaskId
        ? batchStatus?.items.find((item) => item.taskId === activeTaskId)
        : null,
    [activeTaskId, batchStatus?.items]
  );

  const markdownContent = useMemo(() => {
    if (!selectedTask) return "";
    return formatTaskMarkdown(
      selectedTask.taskId,
      selectedTask.title,
      selectedTask.repo,
      selectedTask.instruction
    );
  }, [selectedTask]);

  const handleSelectTask = useCallback(
    (item: BenchmarkAgentBatchItem) => {
      setActiveTaskId(item.taskId);
      setSelectedTaskId(item.taskId);
    },
    [setActiveTaskId, setSelectedTaskId]
  );

  const handleRefresh = useCallback(() => {
    void refreshBatchStatus().then((status) => {
      if (status) {
        setBenchmarkBatchStatus(status);
      }
    });
  }, [refreshBatchStatus, setBenchmarkBatchStatus]);

  if (!batchStatus) {
    return (
      <div
        className={`${className ?? ""} flex h-full min-h-0 flex-col overflow-hidden`}
      >
        <Placeholder
          variant="empty"
          placement="detail-panel"
          title={t("creator.benchmark.selectTaskHint")}
          fillParentHeight
        />
      </div>
    );
  }

  return (
    <div
      className={`${className ?? ""} flex h-full min-h-0 flex-col overflow-hidden`}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-solid border-border-2 px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-text-1">
            {t("creator.benchmark.attemptTitle")}
          </div>
          <div className="truncate text-[12px] text-text-3">
            {t("creator.benchmark.batchProgress", {
              total: batchStatus.totalTasks,
              queued: batchStatus.queued,
              running: batchStatus.running,
              launched: batchStatus.launched,
              failed: batchStatus.failed,
              cancelled: batchStatus.cancelled,
            })}
          </div>
        </div>
        <Button
          htmlType="button"
          variant="secondary"
          size="small"
          onClick={handleRefresh}
        >
          {t("common:actions.refresh")}
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(260px,340px)_1fr] overflow-hidden">
        <div className="scrollbar-overlay min-h-0 overflow-y-auto border-r border-solid border-border-2 p-3">
          <div className="flex flex-col gap-2">
            {batchStatus.items.map((item) => (
              <button
                key={item.taskId}
                type="button"
                className={`flex w-full flex-col gap-1 rounded-lg border border-solid px-3 py-2 text-left transition-colors hover:bg-fill-1 ${
                  activeTaskId === item.taskId
                    ? "border-primary-4 bg-primary-1"
                    : "bg-fill-0 border-border-2"
                }`}
                onClick={() => handleSelectTask(item)}
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-text-1">
                    {item.taskId}
                  </span>
                  <span
                    className={`shrink-0 rounded-full border border-solid px-2 py-0.5 text-[10px] font-medium ${itemStatusClass(item.status)}`}
                  >
                    {item.status}
                  </span>
                </div>
                <div className="truncate text-[11px] text-text-3">
                  {item.sessionId
                    ? t("creator.benchmark.sessionLabel", {
                        sessionId: item.sessionId,
                      })
                    : t("creator.benchmark.noSessionYet")}
                </div>
                <div className="truncate text-[11px] text-text-3">
                  {t("creator.benchmark.testResultPending")}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 overflow-hidden">
          {error ? (
            <Placeholder
              variant="error"
              placement="detail-panel"
              title={t("common:errors.failedToLoad")}
              subtitle={error}
              fillParentHeight
            />
          ) : isLoadingDetail ? (
            <Placeholder
              variant="loading"
              placement="detail-panel"
              title={t("creator.benchmark.loading")}
              fillParentHeight
            />
          ) : selectedTask ? (
            <div className="scrollbar-overlay h-full min-h-0 overflow-y-auto px-4 py-4">
              <div className="bg-fill-0 mb-3 rounded-lg border border-solid border-border-2 px-3 py-2 text-[12px] leading-5 text-text-2">
                <div>
                  {t("creator.benchmark.taskBreadcrumb", {
                    attempt: t("creator.benchmark.attemptTitle"),
                    task: selectedTask.taskId,
                  })}
                </div>
                {activeItem?.error ? (
                  <div className="mt-1 break-words text-danger-6">
                    {activeItem.error}
                  </div>
                ) : null}
              </div>
              <div className="allow-select-deep mx-auto max-w-[920px] select-text text-[13px] leading-6 text-text-2">
                <Markdown
                  textContent={markdownContent}
                  useChatCodeBlock
                  skipPreprocess
                />
              </div>
            </div>
          ) : (
            <Placeholder
              variant="empty"
              placement="detail-panel"
              title={t("creator.benchmark.selectTaskHint")}
              fillParentHeight
            />
          )}
        </div>
      </div>
    </div>
  );
};
