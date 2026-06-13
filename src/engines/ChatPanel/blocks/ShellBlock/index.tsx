/**
 * ShellBlock Component
 *
 * Chat-variant renderer for `run_shell` events. Branches on `action`:
 *   - `"kill"` → compact header-only card (KillVariant)
 *   - default (`"run"`) → full TerminalBlock with command + output
 *
 * Lifecycle strings (`title`, `killTitle`, `failedLabel`) are supplied
 * pre-translated by the `ShellAdapter` in `rendering/adapters/ShellAdapter.tsx`.
 * The block only resolves the foreground terminal long-wait label because that
 * display state is derived from runtime process metadata local to this block.
 */
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { getEventIcon, getToolIcon } from "@src/config/toolIcons";
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
import {
  TERMINAL_FOREGROUND_WAIT_THRESHOLD_MS,
  resolveShellRuntimeDisplayState,
} from "./shellRuntimeState";

const SHELL_ACTION_KILL = "kill";

function getTimestampAgeMs(
  timestamp: string | undefined,
  nowMs: number
): number | null {
  if (!timestamp) return null;
  const timestampMs = new Date(timestamp).getTime();
  if (Number.isNaN(timestampMs)) return null;
  return Math.max(0, nowMs - timestampMs);
}

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
  const { t } = useTranslation("sessions");
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

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const ageMs = getTimestampAgeMs(props.timestamp, Date.now());
    if (
      ageMs === null ||
      ageMs >= TERMINAL_FOREGROUND_WAIT_THRESHOLD_MS ||
      (props.status !== "running" && props.status !== "pending")
    ) {
      return undefined;
    }
    const timeout = window.setTimeout(() => {
      setNowMs(Date.now());
    }, TERMINAL_FOREGROUND_WAIT_THRESHOLD_MS - ageMs);
    return () => window.clearTimeout(timeout);
  }, [props.status, props.timestamp]);

  const runtimeDisplayState = resolveShellRuntimeDisplayState({
    status: props.status,
    showActiveEventPainting: props.showActiveEventPainting,
    timestamp: props.timestamp,
    nowMs,
    shellProcessStatus,
    exitCode,
  });
  const isLoading = runtimeDisplayState.isLoading;
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
  const runningStatusText = runtimeDisplayState.isLongForegroundWait
    ? t("tools.terminalWaitRunning")
    : undefined;
  const runningStatusIcon = runtimeDisplayState.isLongForegroundWait
    ? getEventIcon("await_output", { action: "wait_for" })
    : undefined;
  return (
    <TerminalBlock
      command={command}
      title={headerTitle}
      runningStatusText={runningStatusText}
      runningStatusIcon={runningStatusIcon}
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
