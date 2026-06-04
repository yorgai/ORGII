import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Markdown from "@src/components/MarkDown";
import { CodeMirrorEditor } from "@src/features/CodeMirror";
import { useBenchmarkTasks } from "@src/hooks/benchmark/useBenchmarkTasks";
import { FileHeader } from "@src/modules/WorkStation/shared";
import { Placeholder } from "@src/modules/shared/layouts/blocks";

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

function getBenchmarkHeaderPath(
  taskId: string | null | undefined,
  repo: string | null | undefined
): string {
  if (!taskId) return "Benchmark";
  const taskFileName = `${taskId}.md`;
  return repo?.trim()
    ? `Benchmark/${repo.trim()}/${taskFileName}`
    : `Benchmark/${taskFileName}`;
}

export const BenchmarkPanel: React.FC<BenchmarkPanelProps> = ({
  className,
}) => {
  const { t } = useTranslation("sessions");
  const { error, isLoadingDetail, selectedTask } = useBenchmarkTasks({
    loadOnMount: false,
  });
  const [isPreviewMode, setIsPreviewMode] = useState(true);

  const markdownContent = useMemo(() => {
    if (!selectedTask) return "";
    return formatTaskMarkdown(
      selectedTask.taskId,
      selectedTask.title,
      selectedTask.repo,
      selectedTask.instruction
    );
  }, [selectedTask]);

  const headerPath = useMemo(
    () => getBenchmarkHeaderPath(selectedTask?.taskId, selectedTask?.repo),
    [selectedTask?.repo, selectedTask?.taskId]
  );

  return (
    <div
      className={`${className ?? ""} flex h-full min-h-0 flex-col overflow-hidden`}
    >
      <FileHeader
        publishToHost="code"
        filePath={headerPath}
        disableNavigation
        isMarkdownFile={!!selectedTask}
        isPreviewMode={isPreviewMode}
        onTogglePreview={() => setIsPreviewMode((current) => !current)}
        previewLabel={t("common:common.preview")}
      />

      <div className="min-h-0 flex-1 overflow-hidden">
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
          isPreviewMode ? (
            <div className="scrollbar-overlay h-full overflow-y-auto p-5">
              <div className="allow-select-deep max-w-[920px] select-text text-[13px] leading-6 text-text-2">
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
              filePath={headerPath}
              language="markdown"
              readOnly
              registerWithService={false}
              enableLinting={false}
              enableMinimap={false}
              enableDirtyDiff={false}
            />
          )
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
  );
};
