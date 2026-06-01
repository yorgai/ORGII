/**
 * Shell Operation Converter
 *
 * Converts SessionEvents into ShellOperationEntry for the IDE simulator view.
 */
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { extractShellData } from "@src/engines/SessionCore/rendering/props";
import { APP_SUBTOOL } from "@src/engines/SessionCore/rendering/registry";
import { getAppSubtool } from "@src/engines/SessionCore/rendering/registry/initToolRegistry";
import type { EventStatus } from "@src/engines/SessionCore/rendering/types/universalProps";
import { getEventStatus } from "@src/util/data/converters/eventStatus";

import type { ShellOperationEntry } from "../types";

export function parseCommandKeywords(command: string): string {
  if (!command) return "";
  const parts = command.split(/(?:&&|\|\||;|\|)/);
  const commands = parts
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean);
  return [...new Set(commands)].join(", ");
}

/**
 * Convert a SessionEvent to a ShellOperationEntry.
 * Returns null if the event is not a shell operation.
 */
export function convertToShellOperation(
  event: SessionEvent,
  isCurrent: boolean
): ShellOperationEntry | null {
  const eventType = event.functionName;

  const subtool = getAppSubtool(eventType);

  if (subtool === APP_SUBTOOL.SHELL) {
    const statusString = getEventStatus(event) as EventStatus;

    const propsForExtraction = {
      eventId: event.id,
      eventType: event.functionName,
      args: event.args,
      result: event.result,
      status: statusString,
      variant: "simulator" as const,
      context: "simulator" as const,
    };

    const data = extractShellData(propsForExtraction);

    if (!data.command) return null;

    const isLoading = statusString === "running" || statusString === "pending";
    const rawStreamOutput =
      typeof event.args?.streamOutput === "string"
        ? event.args.streamOutput
        : undefined;

    return {
      command: data.command,
      shortCommand: data.command.split(/\s+/)[0] || data.command,
      commandKeywords: parseCommandKeywords(data.command),
      cwd: data.cwd,
      output: data.output,
      streamOutput: isLoading ? rawStreamOutput : undefined,
      exitCode: data.exitCode,
      executionTime: data.executionTime,
      isLoading,
      isError: data.exitCode !== undefined && data.exitCode !== 0,
      isFailed: statusString === "failed",
      event,
      eventId: event.id,
      isCurrent,
    };
  }

  return null;
}
