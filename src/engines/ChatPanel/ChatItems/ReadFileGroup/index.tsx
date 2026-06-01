/**
 * ReadFileGroup Component
 *
 * Displays a collapsible group of read file events using StackedBlock.
 * Single file with content: renders standalone ChatCodeBlock.
 * Multiple files: renders StackedBlock with ChatCodeBlocks inside.
 */
import { FileText } from "lucide-react";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { ChatCodeBlock, StackedBlock } from "@src/engines/ChatPanel/blocks";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { getFileName as getFileNameFromPath } from "@src/util/file/pathUtils";

// ============================================
// Types
// ============================================

export interface ReadFileGroupProps {
  events: SessionEvent[];
}

// ============================================
// Helpers
// ============================================

function hasFileContent(event: SessionEvent): boolean {
  const result = event.result;
  if (!result || Object.keys(result).length === 0) return false;

  const output = result.output as Record<string, unknown> | undefined;
  const outputSuccess = (output?.success as Record<string, unknown>) || {};
  const directSuccess = (result.success as Record<string, unknown>) || {};

  return !!(
    outputSuccess?.content ||
    directSuccess?.content ||
    result?.content ||
    result?.file_content ||
    result?.observation
  );
}

function getFileContent(event: SessionEvent): string | null {
  const result = event.result;
  if (!result) return null;

  const output = result.output as Record<string, unknown> | undefined;
  const outputSuccess = output?.success as Record<string, unknown> | undefined;
  if (typeof outputSuccess?.content === "string")
    return outputSuccess.content as string;

  const directSuccess = result.success as Record<string, unknown> | undefined;
  if (typeof directSuccess?.content === "string")
    return directSuccess.content as string;

  if (typeof result.content === "string") return result.content as string;
  if (typeof result.file_content === "string")
    return result.file_content as string;
  if (typeof result.observation === "string")
    return result.observation as string;

  return null;
}

function getFilePath(event: SessionEvent): string {
  const argsPath =
    (event.args?.file_path as string) ||
    (event.args?.path as string) ||
    (event.args?.target_file as string) ||
    (event.args?.file_name as string) ||
    "";
  if (argsPath) return argsPath;

  const result = event.result;
  if (result) {
    const successData = result.success as Record<string, unknown> | undefined;
    const outputSuccess = (result.output as Record<string, unknown> | undefined)
      ?.success as Record<string, unknown> | undefined;

    return (
      (result.file_path as string) ||
      (result.path as string) ||
      (successData?.file_path as string) ||
      (successData?.path as string) ||
      (outputSuccess?.file_path as string) ||
      (outputSuccess?.path as string) ||
      ""
    );
  }

  return "";
}

function getFileName(event: SessionEvent): string {
  const filePath = getFilePath(event);
  if (filePath) return getFileNameFromPath(filePath);
  return "unknown";
}

// Matches the right-aligned line-number prefix emitted by
// `foundation/tool_infra/file.rs::format_text_result`.
// Current separator: `│` (U+2502). Legacy: `→` (U+2192) for older sessions.
function stripLineNumbers(content: string): string {
  return content.replace(/^ *\d+[│→]/gm, "");
}

// `read_file` (Rust) prepends a `[action: read_text|read_image|read_pdf]`
// marker line as an LLM hint. Strip it before display.
function stripActionMarker(content: string): string {
  return content.replace(/^\[action:[^\]]*\]\n?/, "");
}

function cleanFileContent(rawContent: string): string {
  let content = rawContent.replace(
    /<system-reminder>[\s\S]*?<\/system-reminder>\s*/g,
    ""
  );
  content = stripActionMarker(content);
  content = stripLineNumbers(content);
  return content.trimEnd();
}

// ============================================
// Component
// ============================================

const ReadFileGroup: React.FC<ReadFileGroupProps> = ({ events }) => {
  const { t } = useTranslation("sessions");

  const withContent = useMemo(
    () => events.filter((ev) => hasFileContent(ev)),
    [events]
  );

  if (events.length === 0) return null;

  if (events.length === 1 && withContent.length === 1) {
    const event = events[0];
    const content = getFileContent(event);
    const filePath = getFilePath(event);

    if (content) {
      return (
        <ChatCodeBlock
          code={cleanFileContent(content)}
          filePath={filePath}
          title={getFileName(event)}
          defaultCollapsed={false}
          showLineCount={false}
        />
      );
    }
  }

  const groupLabel = t("tools.nFiles", { count: events.length });

  return (
    <StackedBlock
      items={events}
      icon={<FileText size={14} className="text-text-2" />}
      label={`Read ${groupLabel}`}
      renderItem={(event) => {
        const content = getFileContent(event);
        const filePath = getFilePath(event);

        if (!content) {
          return (
            <ChatCodeBlock
              code={getFileName(event)}
              language="text"
              title={getFileName(event)}
              defaultCollapsed
              showLineCount={false}
              eventId={event.id}
            />
          );
        }

        return (
          <ChatCodeBlock
            code={cleanFileContent(content)}
            filePath={filePath}
            title={getFileName(event)}
            defaultCollapsed
            showLineCount={false}
            eventId={event.id}
          />
        );
      }}
    />
  );
};

export default ReadFileGroup;
