/**
 * DiffBlock — Chat-variant rendering for file-edit events
 * (`create`, `overwrite`, `edit`, `apply_patch`).
 *
 * Absorbs the prior `EditEvent` chat-variant logic. When the extracted data
 * contains multi-file `applyPatchSegments`, each segment is rendered as its
 * own `ChatCodeBlock` (deletion segments render with a "Deleted" trailing
 * tag and no body via `hasContent={false}`).
 * During streaming we show the raw `newContent` as code; once complete we
 * prefer a real unified diff, falling back to a synthetic full-write diff
 * when only the new content is available.
 */
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { getToolIcon } from "@src/config/toolIcons";
import { extractEditData } from "@src/engines/SessionCore/rendering/props/propsDataExtractors";
import type {
  ExtractedEditData,
  UniversalEventProps,
} from "@src/engines/SessionCore/rendering/types/universalProps";
import { getFileName } from "@src/util/file/pathUtils";
import { formatRepoPathForDisplay } from "@src/util/file/repoPathDisplay";

import ChatCodeBlock from "../CodeBlock";
import {
  EventBlockHeader,
  EventBlockHeaderIcon,
  EventBlockHeaderTitle,
  FailedEventRow,
  SESSION_UI_TOKENS,
} from "../primitives";

function hasStreamingContent(segments: ExtractedEditData[]): boolean {
  return segments.some((s) => s.newContent || s.diff);
}

const VISIBLE_LINES = 5;

// Decode escape sequences that arrive in streaming payloads before the
// backend has had a chance to deliver the real diff/content.
function decodeStreamContent(content: string): string {
  try {
    return content
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\t/g, "\t")
      .replace(/\\\\/g, "\\");
  } catch {
    return content;
  }
}

// Synthesize a unified-diff string that represents creating a brand new
// file: every line is an addition. This lets ChatCodeBlock render new-file
// writes (no real diff payload) with the same green-stripe diff styling
// and `+N` header badge as a real diff, instead of falling back to plain
// code without an add-count.
function synthesizeFullAddDiff(content: string): string {
  const lines = content.split("\n");
  const header = `@@ -0,0 +1,${lines.length} @@`;
  return [header, ...lines.map((line) => `+${line}`)].join("\n");
}

interface SegmentViewProps {
  segment: ExtractedEditData;
  isLoading: boolean;
  eventId: string;
  repoPath?: string;
}

const SegmentView: React.FC<SegmentViewProps> = ({
  segment,
  isLoading,
  eventId,
  repoPath,
}) => {
  const { t } = useTranslation("sessions");
  const {
    filePath,
    fileName,
    diff,
    newContent,
    language,
    linesAdded = 0,
    linesRemoved = 0,
  } = segment;

  const displayPath = formatRepoPathForDisplay({ path: filePath, repoPath });
  const displayTitle =
    displayPath.displayPath || fileName || getFileName(filePath) || "file";

  const displayDiff = diff ? decodeStreamContent(diff) : undefined;
  const displayContent = newContent
    ? decodeStreamContent(newContent)
    : undefined;

  // For completed new-file writes (no diff, only newContent), synthesize a
  // full-add unified diff so the body renders as a diff and the header
  // gets the +N badge. During streaming we still show raw content.
  const syntheticAddDiff =
    !isLoading && !displayDiff && displayContent
      ? synthesizeFullAddDiff(displayContent)
      : undefined;

  const resolvedDiff = displayDiff || syntheticAddDiff;
  const resolvedContent = isLoading
    ? displayContent
    : resolvedDiff || displayContent;
  const isDiff = !isLoading && Boolean(resolvedDiff);
  const resolvedLanguage = isDiff ? "diff" : language || "text";

  const resolvedLinesAdded =
    !isLoading && syntheticAddDiff && !linesAdded
      ? (displayContent ?? "").split("\n").length
      : linesAdded;

  // For new-file writes, append a muted "New" suffix next to the green `+N` count.
  const trailingTags = syntheticAddDiff
    ? ([{ tone: "secondary", text: t("tools.new") }] as const)
    : undefined;

  if (resolvedContent) {
    return (
      <div className="animate-fade-in">
        <ChatCodeBlock
          code={resolvedContent}
          language={resolvedLanguage}
          filePath={filePath}
          title={displayTitle}
          separateTitle={false}
          showLineNumbers
          defaultCollapsed={false}
          visibleLines={VISIBLE_LINES}
          linesAdded={resolvedLinesAdded}
          linesRemoved={linesRemoved}
          showLineCount={!isLoading}
          trailingTags={trailingTags}
          eventId={eventId}
          isLoading={isLoading}
        />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="animate-fade-in">
        <ChatCodeBlock
          code=""
          language={resolvedLanguage}
          filePath={filePath}
          title={displayTitle}
          separateTitle={false}
          defaultCollapsed
          eventId={eventId}
          isLoading
        />
      </div>
    );
  }

  return null;
};

export interface DiffBlockProps extends UniversalEventProps {
  /**
   * Pre-translated header title for the current lifecycle state.
   * Adapter resolves via `resolveLifecycleLabelKeys` + `t(key, { name })`
   * and picks running / done / failed. Block renders this verbatim.
   */
  title: string;
}

function isDeleteFileEvent(props: UniversalEventProps): boolean {
  if (props.rustExtracted?.kind === "deleteFile") return true;
  if (props.eventType === "delete_file") return true;
  if (props.args?.action === "delete") return true;
  return false;
}

const DeleteFileView: React.FC<DiffBlockProps> = (props) => {
  const { t } = useTranslation("sessions");
  const { status, title } = props;

  let filePath = "";
  let fileName = "";

  if (props.rustExtracted?.kind === "deleteFile") {
    filePath = props.rustExtracted.filePath;
    fileName = props.rustExtracted.fileName;
  } else {
    filePath =
      (props.args?.path as string) ||
      (props.args?.file_path as string) ||
      (props.args?.target_file as string) ||
      "";
    fileName = filePath ? getFileName(filePath) || "file" : "file";
  }

  const displayPath = formatRepoPathForDisplay({
    path: filePath,
    repoPath: props.repoPath,
  });
  const displayTitle =
    displayPath.displayPath || fileName || getFileName(filePath) || "file";

  if (status === "running") {
    const deleteIcon = getToolIcon("delete_file", {
      size: SESSION_UI_TOKENS.ICON.SIZE_SM,
    });
    const isLoading = props.showActiveEventPainting === true;
    return (
      <EventBlockHeader isCollapsed withHover={false}>
        <EventBlockHeaderIcon icon={deleteIcon} isLoading={isLoading} />
        <EventBlockHeaderTitle isLoading={isLoading}>
          {title}
        </EventBlockHeaderTitle>
      </EventBlockHeader>
    );
  }

  if (status === "failed") {
    return <FailedEventRow toolName="delete_file" label={title} />;
  }

  return (
    <ChatCodeBlock
      code=""
      filePath={filePath}
      title={displayTitle}
      hasContent={false}
      defaultCollapsed
      trailingTags={[{ tone: "danger", text: t("tools.deleted") }]}
    />
  );
};

interface EditViewProps extends UniversalEventProps {
  title: string;
}

const EditView: React.FC<EditViewProps> = (props) => {
  const { t } = useTranslation("sessions");
  const { eventId, status, title } = props;

  const editData = useMemo(() => extractEditData(props), [props]);

  const segments = useMemo<ExtractedEditData[]>(() => {
    if (editData.applyPatchSegments && editData.applyPatchSegments.length > 0) {
      return editData.applyPatchSegments;
    }
    return [editData];
  }, [editData]);

  const editIcon = useMemo(
    () =>
      getToolIcon("edit_file", {
        size: SESSION_UI_TOKENS.ICON.SIZE_SM,
        className: "text-text-2",
      }),
    []
  );

  if (status === "failed") {
    return (
      <div className={SESSION_UI_TOKENS.ROW.INLINE}>
        <EventBlockHeaderIcon icon={editIcon} isFailed />
        <span className={SESSION_UI_TOKENS.TEXT.TERTIARY}>
          {t("tools.editFileFailed", { name: editData.fileName })}
        </span>
      </div>
    );
  }

  const isLoading =
    status === "running" && props.showActiveEventPainting === true;

  if (status === "running" && !hasStreamingContent(segments)) {
    return (
      <EventBlockHeader isCollapsed withHover={false}>
        <EventBlockHeaderIcon icon={editIcon} isLoading={isLoading} />
        <EventBlockHeaderTitle isLoading={isLoading}>
          {title}
        </EventBlockHeaderTitle>
      </EventBlockHeader>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {segments.map((segment, segmentIndex) => {
        const segmentKey = `${segment.filePath}-${segmentIndex}`;
        if (segment.isDeleted) {
          const displayPath = formatRepoPathForDisplay({
            path: segment.filePath,
            repoPath: props.repoPath,
          });
          const displayTitle =
            displayPath.displayPath ||
            segment.fileName ||
            getFileName(segment.filePath) ||
            "file";
          return (
            <ChatCodeBlock
              key={segmentKey}
              code=""
              filePath={segment.filePath}
              title={displayTitle}
              hasContent={false}
              defaultCollapsed
              trailingTags={[{ tone: "danger", text: t("tools.deleted") }]}
            />
          );
        }
        return (
          <SegmentView
            key={segmentKey}
            segment={segment}
            isLoading={isLoading}
            eventId={eventId}
            repoPath={props.repoPath}
          />
        );
      })}
    </div>
  );
};

export const DiffBlock: React.FC<DiffBlockProps> = (props) => {
  if (isDeleteFileEvent(props)) return <DeleteFileView {...props} />;
  return <EditView {...props} title={props.title} />;
};

DiffBlock.displayName = "DiffBlock";

export default DiffBlock;
