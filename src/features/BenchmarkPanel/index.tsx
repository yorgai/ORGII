import { useAtom, useAtomValue, useSetAtom } from "jotai";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  BENCHMARK_AGENT_BATCH_STATUS,
  type BenchmarkAgentBatchItem,
} from "@src/api/tauri/benchmark";
import Markdown from "@src/components/MarkDown";
import ModelIcon from "@src/components/ModelIcon";
import TabPill from "@src/components/TabPill";
import { CodeMirrorEditor } from "@src/features/CodeMirror";
import { useBenchmarkAgentBatchRun } from "@src/hooks/benchmark/useBenchmarkAgentBatchRun";
import { useBenchmarkTasks } from "@src/hooks/benchmark/useBenchmarkTasks";
import { usePublishWorkstationTabHeader } from "@src/hooks/workStation";
import {
  Placeholder,
  SessionGroupPage,
  type SessionTableItem,
} from "@src/modules/shared/layouts/blocks";
import {
  benchmarkActiveBatchTaskIdAtom,
  benchmarkAgentBatchStatusAtom,
} from "@src/store/benchmark";
import {
  activeSessionIdAtom,
  loadSessions,
  sessionsAtom,
  workstationActiveSessionIdAtom,
} from "@src/store/session";
import {
  CHAT_PANEL_CONTENT_MODE,
  chatPanelContentModeAtom,
} from "@src/store/ui/chatPanelAtom";
import {
  formatReplayDateLabel,
  toIntlLocaleTag,
} from "@src/util/data/formatters/date";
import { formatModelNameFull } from "@src/util/formatModelName";

type BenchmarkPanelSurface = "taskInfo" | "runList";

interface BenchmarkPanelProps {
  className?: string;
  surface?: BenchmarkPanelSurface;
  publishHeader?: boolean;
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

function getDisplayItemStatus(
  status: BenchmarkAgentBatchItem["status"]
): BenchmarkAgentBatchItem["status"] {
  if (status === BENCHMARK_AGENT_BATCH_STATUS.LAUNCHED) {
    return BENCHMARK_AGENT_BATCH_STATUS.RUNNING;
  }
  return status;
}

function itemStatusColor(status: BenchmarkAgentBatchItem["status"]): string {
  if (status === BENCHMARK_AGENT_BATCH_STATUS.RUNNING) {
    return "var(--color-primary-6)";
  }
  if (status === BENCHMARK_AGENT_BATCH_STATUS.FAILED) {
    return "var(--color-danger-6)";
  }
  if (status === BENCHMARK_AGENT_BATCH_STATUS.CANCELLED) {
    return "var(--color-warning-6)";
  }
  return "var(--color-fill-4)";
}

export const BenchmarkPanel: React.FC<BenchmarkPanelProps> = ({
  className,
  surface = "taskInfo",
  publishHeader = true,
}) => {
  const { t, i18n } = useTranslation(["sessions", "common"]);
  const batchStatus = useAtomValue(benchmarkAgentBatchStatusAtom);
  const sessions = useAtomValue(sessionsAtom);
  const [activeTaskId, setActiveTaskId] = useAtom(
    benchmarkActiveBatchTaskIdAtom
  );
  const setBenchmarkBatchStatus = useSetAtom(benchmarkAgentBatchStatusAtom);
  const setActiveSessionId = useSetAtom(activeSessionIdAtom);
  const setWorkstationActiveSessionId = useSetAtom(
    workstationActiveSessionIdAtom
  );
  const setChatPanelContentMode = useSetAtom(chatPanelContentModeAtom);
  const { refreshBatchStatus } = useBenchmarkAgentBatchRun();
  const { error, isLoadingDetail, selectedTask, setSelectedTaskId } =
    useBenchmarkTasks({
      loadDetail: surface === "taskInfo",
      loadOnMount: false,
    });
  const [taskPreviewMode, setTaskPreviewMode] = useState(true);

  const activeItem = useMemo(
    () =>
      activeTaskId
        ? batchStatus?.items.find((item) => item.taskId === activeTaskId)
        : null,
    [activeTaskId, batchStatus?.items]
  );

  useEffect(() => {
    if (surface !== "runList" || activeTaskId || !batchStatus?.items.length) {
      return;
    }
    const firstTaskId = batchStatus.items[0]?.taskId;
    if (!firstTaskId) {
      return;
    }
    setActiveTaskId(firstTaskId);
    setSelectedTaskId(firstTaskId);
  }, [
    activeTaskId,
    batchStatus?.items,
    setActiveTaskId,
    setSelectedTaskId,
    surface,
  ]);

  const markdownContent = useMemo(() => {
    if (!selectedTask) return "";
    return formatTaskMarkdown(
      selectedTask.taskId,
      selectedTask.title,
      selectedTask.repo,
      selectedTask.instruction
    );
  }, [selectedTask]);
  const handleToggleTaskPreview = useCallback(() => {
    setTaskPreviewMode((currentMode) => !currentMode);
  }, []);
  const headerPreviewToggle = useMemo(
    () => (
      <div className="flex h-7 shrink-0 items-center">
        <TabPill
          activeTab={taskPreviewMode ? "preview" : "source"}
          tabs={[
            {
              key: "source",
              label: t("common:common.raw"),
            },
            {
              key: "preview",
              label: t("common:common.preview"),
            },
          ]}
          onChange={(key) => {
            if (key === "preview" && !taskPreviewMode)
              handleToggleTaskPreview();
            if (key === "source" && taskPreviewMode) handleToggleTaskPreview();
          }}
          variant="pill"
          color="fill"
          fillWidth={false}
          size="small"
        />
      </div>
    ),
    [handleToggleTaskPreview, t, taskPreviewMode]
  );

  usePublishWorkstationTabHeader({
    host: "code",
    content: {
      trailing: headerPreviewToggle,
    },
    enabled: surface === "taskInfo" && publishHeader,
  });

  const handleSelectTask = useCallback(
    (item: BenchmarkAgentBatchItem) => {
      setActiveTaskId(item.taskId);
      setSelectedTaskId(item.taskId);
      if (!item.sessionId) {
        return;
      }
      setActiveSessionId(item.sessionId);
      setWorkstationActiveSessionId(item.sessionId);
      setChatPanelContentMode(CHAT_PANEL_CONTENT_MODE.SESSION);
      void loadSessions({ forceRefresh: true });
    },
    [
      setActiveSessionId,
      setActiveTaskId,
      setChatPanelContentMode,
      setSelectedTaskId,
      setWorkstationActiveSessionId,
    ]
  );

  const handleRefresh = useCallback(() => {
    void refreshBatchStatus().then((status) => {
      if (status) {
        setBenchmarkBatchStatus(status);
      }
    });
  }, [refreshBatchStatus, setBenchmarkBatchStatus]);

  const displayedRunningCount = batchStatus
    ? batchStatus.running + batchStatus.launched
    : 0;

  const sessionsById = useMemo(
    () => new Map(sessions.map((session) => [session.session_id, session])),
    [sessions]
  );
  const dateTimeLabelOptions = useMemo(
    () => ({
      todayLabel: t("common:relativeDate.today"),
      yesterdayLabel: t("common:relativeDate.yesterday"),
      locale: toIntlLocaleTag(i18n.resolvedLanguage),
    }),
    [i18n.resolvedLanguage, t]
  );
  const benchmarkSessionListItems = useMemo<SessionTableItem[]>(
    () =>
      batchStatus?.items.map((item) => {
        const displayStatus = getDisplayItemStatus(item.status);
        const session = item.sessionId
          ? sessionsById.get(item.sessionId)
          : undefined;
        const workspacePath = session?.worktreePath ?? session?.repoPath;
        const workspaceLabel = workspacePath
          ? (workspacePath.split(/[\\/]/).filter(Boolean).pop() ??
            workspacePath)
          : session?.repo_name;
        const modelLabel = session?.model
          ? formatModelNameFull(session.model)
          : undefined;

        return {
          id: item.taskId,
          title: item.taskId,
          description: undefined,
          statusLabel: displayStatus,
          statusColor: itemStatusColor(displayStatus),
          agentIcon: session?.cliAgentType ? (
            <ModelIcon agentType={session.cliAgentType} size={14} />
          ) : undefined,
          agentLabel: session?.agentDisplayName ?? session?.cliAgentType,
          modelIcon: session?.model ? (
            <ModelIcon
              modelName={session.model}
              agentType={session.cliAgentType}
              size={14}
            />
          ) : undefined,
          modelLabel,
          workspaceLabel,
          workspaceTitle: workspacePath,
          startedLabel: formatReplayDateLabel(
            item.startedAt ?? session?.created_at,
            {
              ...dateTimeLabelOptions,
              withSeconds: false,
              monthStyle: "short",
            }
          ),
          lastUpdatedLabel: formatReplayDateLabel(
            item.finishedAt ?? session?.updated_at ?? item.startedAt,
            {
              ...dateTimeLabelOptions,
              withSeconds: false,
              monthStyle: "short",
            }
          ),
          active: activeTaskId === item.taskId,
          testId: "benchmark-run-task-row",
          dataAttributes: {
            "data-benchmark-task-id": item.taskId,
            "data-benchmark-task-status": displayStatus,
          },
        };
      }) ?? [],
    [activeTaskId, batchStatus?.items, dateTimeLabelOptions, sessionsById]
  );

  const handleSelectBenchmarkSessionListItem = useCallback(
    (listItem: SessionTableItem) => {
      const benchmarkItem = batchStatus?.items.find(
        (item) => item.taskId === listItem.id
      );
      if (!benchmarkItem) return;
      handleSelectTask(benchmarkItem);
    },
    [batchStatus?.items, handleSelectTask]
  );

  const taskDetailContent = useMemo(() => {
    if (error) {
      return (
        <Placeholder
          variant="error"
          placement="detail-panel"
          title={t("common:errors.failedToLoad")}
          subtitle={error}
          fillParentHeight
        />
      );
    }

    if (isLoadingDetail) {
      return (
        <Placeholder
          variant="loading"
          placement="detail-panel"
          title={t("creator.benchmark.loading")}
          fillParentHeight
        />
      );
    }

    if (!selectedTask) {
      return (
        <Placeholder
          variant="empty"
          placement="detail-panel"
          title={t("creator.benchmark.selectTaskHint")}
          fillParentHeight
        />
      );
    }

    return (
      <div
        className="relative h-full min-h-0"
        data-testid="benchmark-run-task-detail"
      >
        {activeItem?.error ? (
          <div className="bg-fill-0 absolute left-4 right-4 top-3 z-10 rounded-lg border border-solid border-border-2 px-3 py-2 text-[12px] leading-5 text-danger-6 shadow-sm">
            {activeItem.error}
          </div>
        ) : null}
        {taskPreviewMode ? (
          <div className="markdown-preview-container scrollbar-overlay h-full min-h-0 overflow-y-auto p-6">
            <div className="allow-select-deep mx-auto max-w-[920px] select-text text-[13px] leading-6 text-text-2">
              <Markdown
                textContent={markdownContent}
                useChatCodeBlock
                skipPreprocess
              />
            </div>
          </div>
        ) : (
          <CodeMirrorEditor
            value={markdownContent}
            filePath="benchmark-task.md"
            height="100%"
            readOnly
            enableLinting={false}
            registerWithService={false}
          />
        )}
      </div>
    );
  }, [
    activeItem,
    error,
    isLoadingDetail,
    markdownContent,
    selectedTask,
    t,
    taskPreviewMode,
  ]);

  if (surface === "taskInfo") {
    return (
      <div
        className={`${className ?? ""} flex h-full min-h-0 flex-col overflow-hidden`}
      >
        {taskDetailContent}
      </div>
    );
  }

  if (!batchStatus) {
    return (
      <div
        className={`${className ?? ""} flex h-full min-h-0 flex-col overflow-hidden`}
        data-testid="benchmark-run-page"
      >
        <Placeholder
          variant="empty"
          placement="detail-panel"
          title={t("creator.benchmark.noSessionYet")}
          fillParentHeight
        />
      </div>
    );
  }

  return (
    <SessionGroupPage
      className={className}
      testId="benchmark-run-page"
      headerTestId="benchmark-run-header"
      listTestId="benchmark-run-task-list"
      dataAttributes={{
        "data-benchmark-batch-id": batchStatus.batchId,
        "data-benchmark-status": batchStatus.status,
      }}
      title={t("creator.benchmark.sessionGroupTitle")}
      subtitle={t("creator.benchmark.sessionGroupProgress", {
        total: batchStatus.totalTasks,
        queued: batchStatus.queued,
        running: displayedRunningCount,
        launched: 0,
        failed: batchStatus.failed,
        cancelled: batchStatus.cancelled,
      })}
      items={benchmarkSessionListItems}
      onSelectItem={handleSelectBenchmarkSessionListItem}
      actions={[
        {
          label: t("common:actions.refresh"),
          onClick: handleRefresh,
        },
      ]}
    />
  );
};
