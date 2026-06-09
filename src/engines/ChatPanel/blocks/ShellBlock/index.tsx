/**
 * ShellBlock Component
 *
 * Chat-variant renderer for `run_shell` events. Branches on `action`:
 *   - `"kill"` → compact header-only card (KillVariant)
 *   - default (`"run"`) → full TerminalBlock with command + output
 *
 * All user-visible lifecycle strings (`title`, `killTitle`,
 * `failedLabel`) are supplied pre-translated by the `ShellAdapter` in
 * `rendering/adapters/ShellAdapter.tsx` — the block resolves no i18n
 * keys of its own. That keeps the adapter as the single point where the
 * registry is consulted and avoids a circular import between ShellBlock
 * and the adapters module.
 */
import React, { useCallback } from "react";

import { getToolIcon } from "@src/config/toolIcons";
import { extractShellData } from "@src/engines/SessionCore/rendering/props/propsDataExtractors";
import type { UniversalEventProps } from "@src/engines/SessionCore/rendering/types/universalProps";
import { killAgentShellProcess } from "@src/services/terminal";

import TerminalBlock from "../TerminalBlock";
import {
  EventBlockHeader,
  EventBlockHeaderIcon,
  EventBlockHeaderInfo,
  EventBlockHeaderSubtitle,
  EventBlockHeaderTitle,
  FailedEventRow,
  getEventBlockContainerClasses,
} from "../primitives";

const SHELL_ACTION_KILL = "kill";

/** Unescape common backslash sequences produced by the wire payload. */
function unescapeShellString(input: string | undefined): string {
  if (!input) return "";
  try {
    return input
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\r/g, "\r")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  } catch {
    return input;
  }
}

/** Pull an optional `message` field out of a result object (kill action). */
function extractResultMessage(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const message = (result as Record<string, unknown>).message;
  return typeof message === "string" ? message : undefined;
}

export type ShellBlockProps = UniversalEventProps & {
  /**
   * Pre-translated header title for the `run` action. Adapter resolves
   * via `useLifecycleLabels("run_shell", "run")` (falling back to the
   * tool-level labels) and passes the final string.
   */
  title: string;
  /**
   * Pre-translated header title for the `kill` action. Adapter resolves
   * via `useLifecycleLabels("run_shell", "kill")`.
   */
  killTitle: string;
  /**
   * Pre-translated label for the failed-without-command fallback row.
   * Same triple as `title` — the adapter passes `labels.failed`.
   */
  failedLabel: string;
};

interface KillVariantProps {
  killHandle?: string;
  isLoading: boolean;
  resultMessage?: string;
  title: string;
}

const KillVariant: React.FC<KillVariantProps> = ({
  killHandle,
  isLoading,
  resultMessage,
  title,
}) => {
  const toolIcon = getToolIcon("run_shell", {
    size: 14,
    className: "text-text-2",
  });

  return (
    <div className={`animate-fade-in ${getEventBlockContainerClasses(false)}`}>
      <EventBlockHeader isCollapsed withHover={false}>
        <EventBlockHeaderIcon
          icon={toolIcon}
          isCollapsed
          isHeaderHovered={false}
          hasContent={false}
          isLoading={isLoading}
        />
        <EventBlockHeaderTitle isLoading={isLoading}>
          {title}
        </EventBlockHeaderTitle>
        {killHandle && (
          <EventBlockHeaderSubtitle isLoading={isLoading} title={killHandle}>
            {killHandle}
          </EventBlockHeaderSubtitle>
        )}
        {resultMessage && !isLoading && (
          <EventBlockHeaderInfo>{resultMessage}</EventBlockHeaderInfo>
        )}
      </EventBlockHeader>
    </div>
  );
};

KillVariant.displayName = "ShellBlock.KillVariant";

const RunShellView: React.FC<ShellBlockProps> = (props) => {
  const shellData = extractShellData(props);
  const {
    command,
    description,
    output,
    streamOutput,
    exitCode,
    isFailure,
    action,
    killHandle,
    shellPid,
    shellProcessStatus,
  } = shellData;

  const outputPayloadRef = props.payloadRefs?.find(
    (ref) =>
      ref.fieldPath === "extracted.shell.output" ||
      ref.fieldPath === "result.output" ||
      ref.fieldPath === "result.content" ||
      ref.fieldPath === "result.observation"
  );
  const streamPayloadRef = props.payloadRefs?.find(
    (ref) =>
      ref.fieldPath === "extracted.shell.streamOutput" ||
      ref.fieldPath === "args.streamOutput"
  );

  const isLoading =
    props.status === "running" && props.showActiveEventPainting === true;
  const isFailed = props.status === "failed";
  const isErrorExit = Boolean(isFailure) || isFailed;

  // `unescapeShellString` is a pure regex replace over short strings;
  // the React Compiler handles memoization automatically, so the
  // explicit `useMemo` wrappers that used to surround these calls are
  // unnecessary.
  const unescapedOutput = unescapeShellString(output);
  const unescapedStreamOutput = unescapeShellString(streamOutput);

  const handleStop = useCallback(
    async (pid: number) => {
      try {
        await killAgentShellProcess({ pid, sessionId: props.sessionId });
      } catch (err: unknown) {
        console.error("[ShellBlock] Failed to kill process:", err);
      }
    },
    [props.sessionId]
  );

  if (isFailed && !command && action !== SHELL_ACTION_KILL) {
    return <FailedEventRow toolName="run_shell" label={props.failedLabel} />;
  }

  if (action === SHELL_ACTION_KILL) {
    const resultMessage = extractResultMessage(props.result);
    return (
      <KillVariant
        killHandle={killHandle}
        isLoading={isLoading}
        resultMessage={resultMessage}
        title={props.killTitle}
      />
    );
  }

  // Prefer the agent-provided description (a human summary of the
  // command) over the canonical lifecycle label when present — the
  // lifecycle label (`props.title`) is the fallback header when there
  // is no description to show. Both strings are already translated so
  // this is domain logic, not an i18n fallback.
  const trimmedDescription = description?.trim();
  const headerTitle =
    trimmedDescription && trimmedDescription.length > 0
      ? trimmedDescription
      : props.title;
  return (
    <TerminalBlock
      command={command}
      title={headerTitle}
      output={isLoading ? undefined : unescapedOutput}
      streamOutput={
        isLoading ? unescapedStreamOutput || unescapedOutput : undefined
      }
      exitCode={exitCode}
      isError={isErrorExit}
      isLoading={isLoading}
      eventId={props.eventId}
      sessionId={props.sessionId}
      payloadRef={isLoading ? streamPayloadRef : outputPayloadRef}
      pid={shellPid}
      processStatus={shellProcessStatus}
      onStop={handleStop}
    />
  );
};

export const ShellBlock: React.FC<ShellBlockProps> = (props) => {
  return <RunShellView {...props} />;
};

ShellBlock.displayName = "ShellBlock";

export default ShellBlock;
