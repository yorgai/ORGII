import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import Input from "@src/components/Input";
import Markdown from "@src/components/MarkDown";
import { useBenchmarkTasks } from "@src/hooks/benchmark/useBenchmarkTasks";
import WorkItemContentStack from "@src/modules/ProjectManager/WorkItems/components/WorkItemContentStack";
import { PROJECT_MANAGER_TEXT_PLACEHOLDER_CLASS } from "@src/modules/ProjectManager/shared/placeholderTokens";
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

export const BenchmarkPanel: React.FC<BenchmarkPanelProps> = ({
  className,
}) => {
  const { t } = useTranslation("sessions");
  const { error, isLoadingDetail, selectedTask } = useBenchmarkTasks({
    loadOnMount: false,
  });

  const markdownContent = useMemo(() => {
    if (!selectedTask) return "";
    return formatTaskMarkdown(
      selectedTask.taskId,
      selectedTask.title,
      selectedTask.repo,
      selectedTask.instruction
    );
  }, [selectedTask]);

  const metadataItems = useMemo(() => {
    if (!selectedTask) return [];
    return [
      selectedTask.repo?.trim() || null,
      selectedTask.taskId,
      selectedTask.difficulty,
      selectedTask.wordCount ? `${selectedTask.wordCount} words` : null,
    ].filter(Boolean);
  }, [selectedTask]);

  return (
    <div
      className={`${className ?? ""} flex h-full min-h-0 flex-col overflow-hidden`}
    >
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
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <div className="mx-auto h-full w-full max-w-[932px] px-4">
            <WorkItemContentStack
              className="h-full w-full"
              titleContent={
                <Input
                  type="text"
                  value="Load benchmark"
                  onChange={() => undefined}
                  readOnly
                  borderless
                  bgless
                  size="small"
                  className="h-7 min-w-0 max-w-full flex-1 cursor-default rounded-lg transition-colors hover:bg-surface-hover [&_.input-inner]:!px-1.5"
                  inputClassName={`-translate-y-px truncate text-[13px] font-medium text-text-1 ${PROJECT_MANAGER_TEXT_PLACEHOLDER_CLASS}`}
                  data-testid="load-benchmark-title-input"
                />
              }
              pathContent={
                <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-text-2">
                  {metadataItems.map((item, index) => (
                    <React.Fragment key={`${item}-${index}`}>
                      {index > 0 ? (
                        <span className="text-text-4" aria-hidden>
                          ·
                        </span>
                      ) : null}
                      <span className="max-w-[220px] truncate">{item}</span>
                    </React.Fragment>
                  ))}
                </div>
              }
              descriptionContent={
                <div className="scrollbar-overlay h-full overflow-y-auto">
                  <div className="allow-select-deep max-w-[920px] select-text text-[13px] leading-6 text-text-2">
                    <Markdown
                      textContent={markdownContent}
                      useChatCodeBlock
                      skipPreprocess
                    />
                  </div>
                </div>
              }
              descriptionFlexible
              metaClassName="py-2"
              titleClassName="flex h-10 items-center py-0"
              descriptionClassName="min-h-0 overflow-hidden py-4"
              separatorClassName=""
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
  );
};
