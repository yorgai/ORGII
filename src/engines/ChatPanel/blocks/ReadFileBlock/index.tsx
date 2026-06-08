/**
 * ReadFileBlock — header-only chat rendering for `read_file` events.
 *
 * The file contents are available in the simulator; the chat timeline only
 * shows the read action and target file name. The one exception is the
 * `failed` state, which routes through `FailedEventRow` so the underlying
 * error detail (e.g. "ENOENT: no such file") stays visible — silently
 * hiding read failures behind a generic header was the bug that
 * `fix(cursor): keep native sessions continuous` set out to fix.
 */
import React, { useMemo } from "react";

import FileTypeIcon from "@src/components/FileTypeIcon";
import { getToolIcon } from "@src/config/toolIcons";
import { extractFileData } from "@src/engines/SessionCore/rendering/props/propsDataExtractors";
import type { UniversalEventProps } from "@src/engines/SessionCore/rendering/types/universalProps";
import { getFileName } from "@src/util/file/pathUtils";
import { formatRepoPathForDisplay } from "@src/util/file/repoPathDisplay";

import { extractResultText } from "../ToolCallBlock/helpers";
import {
  EventBlockHeader,
  EventBlockHeaderIcon,
  EventBlockHeaderSubtitle,
  EventBlockHeaderTitle,
  FailedEventRow,
  SESSION_UI_TOKENS,
  getEventBlockContainerClasses,
} from "../primitives";
import { useBlockHeader } from "../useBlockLocate";

export type ReadFileBlockProps = UniversalEventProps & {
  title?: string;
};

export const ReadFileBlock: React.FC<ReadFileBlockProps> = (props) => {
  const { eventId, status } = props;

  const { filePath, fileName } = useMemo(() => extractFileData(props), [props]);

  const displayPath = formatRepoPathForDisplay({
    path: filePath,
    repoPath: props.repoPath,
  });
  const displayName =
    displayPath.displayPath || fileName || getFileName(filePath) || "file";
  const fullPathTitle = displayPath.title || filePath || fileName || "file";
  const iconName = fileName || getFileName(filePath) || displayName;
  const isLoading =
    status === "running" && props.showActiveEventPainting === true;
  const isFailed = status === "failed";
  const title = props.title || "Read";

  const {
    isHeaderHovered,
    handleHeaderMouseEnter,
    handleHeaderMouseLeave,
    handleLocate,
  } = useBlockHeader({ eventId });

  const toolIcon = useMemo(
    () =>
      getToolIcon("read_file", {
        size: SESSION_UI_TOKENS.ICON.SIZE_SM,
        className: "text-text-2",
      }),
    []
  );

  if (isFailed) {
    return (
      <FailedEventRow
        toolName="read_file"
        label={`${title} ${displayName}`}
        detail={extractResultText(props.result)}
        eventId={eventId}
      />
    );
  }

  return (
    <div
      className={`${getEventBlockContainerClasses(false)} animate-fade-in`}
      title={fullPathTitle}
    >
      <EventBlockHeader
        isCollapsed
        withHover={false}
        onNavigate={handleLocate}
        onMouseEnter={handleHeaderMouseEnter}
        onMouseLeave={handleHeaderMouseLeave}
      >
        <EventBlockHeaderIcon
          icon={toolIcon}
          isCollapsed
          isHeaderHovered={isHeaderHovered}
          hasContent={false}
          revealChevronOnIconHoverOnly={Boolean(eventId)}
          isLoading={isLoading}
        />
        <EventBlockHeaderTitle isLoading={isLoading}>
          {title}
        </EventBlockHeaderTitle>
        <EventBlockHeaderSubtitle
          isLoading={isLoading}
          title={displayName}
          className="text-text-1"
        >
          <FileTypeIcon
            fileName={iconName}
            size="small"
            className="mr-1.5 shrink-0"
          />
          <span data-testid="read-file-path" className="min-w-0 truncate">
            {displayName}
          </span>
        </EventBlockHeaderSubtitle>
      </EventBlockHeader>
    </div>
  );
};

ReadFileBlock.displayName = "ReadFileBlock";

export default ReadFileBlock;
