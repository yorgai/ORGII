/**
 * ActiveProcesses
 *
 * Collapsible section in ComposerStack showing currently running/background
 * agent shell processes for the active session. Each row displays the command
 * text with a status badge and a Stop button on hover.
 *
 * Data comes from shellProcessMapAtom, filtered by the active session ID
 * to only include processes with status "running" or "background".
 */
import { useAtomValue } from "jotai";
import { SquareTerminal, Trash2 } from "lucide-react";
import React, { memo, useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import {
  CHAT_COMPOSER_STACK_BAR_INNER_PADDING_X_CLASS,
  CHAT_COMPOSER_STACK_BAR_SURFACE_BG_CLASS,
  COMPOSER_STACK_ROW_ACTIONS,
  COMPOSER_STACK_ROW_BASE,
  COMPOSER_STACK_ROW_HOVER,
  COMPOSER_STACK_ROW_LABEL,
} from "@src/config/composerStackTokens";
import { createLogger } from "@src/hooks/logger";
import { killAgentShellProcess } from "@src/services/terminal";
import { activeSessionIdAtom } from "@src/store/session";
import {
  type ShellProcessState,
  shellProcessMapAtom,
} from "@src/store/session/shellProcessAtom";

import ComposerStackHeader from "./ComposerStackHeader";

const logger = createLogger("ActiveProcesses");

// ============================================
// Types
// ============================================

export interface ActiveProcessesProps {
  onToggle: () => void;
  sessionId?: string | null;
  onVisibleCountChange?: (count: number) => void;
  /** When true, keeps component mounted (for count tracking) but renders nothing visible. */
  hidden?: boolean;
  /** When provided, renders with this static data instead of reading from atoms. */
  initialProcesses?: ShellProcessState[];
}

// ============================================
// Process row
// ============================================

interface ProcessRowProps {
  process: ShellProcessState;
  onStop: (pid: number) => void;
}

const ProcessRow: React.FC<ProcessRowProps> = memo(({ process, onStop }) => {
  const { t } = useTranslation("common");
  const handleStop = useCallback(
    () => onStop(process.pid),
    [onStop, process.pid]
  );

  return (
    <div className={`${COMPOSER_STACK_ROW_BASE} ${COMPOSER_STACK_ROW_HOVER}`}>
      <div className="flex h-[14px] w-[14px] shrink-0 items-center justify-center">
        <SquareTerminal size={14} className="text-text-2" />
      </div>
      <span className={COMPOSER_STACK_ROW_LABEL}>{process.command}</span>
      <span className={COMPOSER_STACK_ROW_ACTIONS}>
        <Button
          htmlType="button"
          variant="tertiary"
          size="mini"
          icon={<Trash2 size={12} />}
          iconOnly
          className="enabled:hover:bg-fill-3 enabled:hover:text-danger-6"
          onClick={handleStop}
          title={t("actions.stop")}
        />
      </span>
    </div>
  );
});
ProcessRow.displayName = "ProcessRow";

// ============================================
// Main component
// ============================================

const ActiveProcesses: React.FC<ActiveProcessesProps> = memo(
  ({
    onToggle,
    sessionId: sessionIdProp,
    onVisibleCountChange,
    hidden,
    initialProcesses,
  }) => {
    const { t } = useTranslation("common");
    const activeSessionId = useAtomValue(activeSessionIdAtom);
    const sessionId = sessionIdProp ?? activeSessionId;
    const processMap = useAtomValue(shellProcessMapAtom);

    const activeProcesses = useMemo(() => {
      if (initialProcesses) return initialProcesses;
      if (!sessionId) return [];
      const sessionProcesses = processMap.get(sessionId);
      if (!sessionProcesses) return [];
      return [...sessionProcesses.values()].filter(
        (proc) => proc.status === "running" || proc.status === "background"
      );
    }, [initialProcesses, processMap, sessionId]);

    const count = activeProcesses.length;

    useEffect(() => {
      onVisibleCountChange?.(count);
    }, [count, onVisibleCountChange]);

    const handleStop = useCallback(
      async (pid: number) => {
        try {
          await killAgentShellProcess({
            pid,
            sessionId: sessionId ?? undefined,
          });
        } catch (err: unknown) {
          logger.warn("kill failed:", err);
        }
      },
      [sessionId]
    );

    if (count === 0 || hidden) return null;

    return (
      <div
        className={`${CHAT_COMPOSER_STACK_BAR_SURFACE_BG_CLASS} overflow-hidden rounded-lg border border-solid border-border-2`}
      >
        <ComposerStackHeader
          icon={<SquareTerminal size={14} />}
          label={t("labels.processCount", { count })}
          expanded={true}
          onToggle={onToggle}
        />
        <div
          className={`${CHAT_COMPOSER_STACK_BAR_INNER_PADDING_X_CLASS} max-h-[192px] overflow-y-auto pb-1`}
        >
          {activeProcesses.map((proc) => (
            <ProcessRow key={proc.pid} process={proc} onStop={handleStop} />
          ))}
        </div>
      </div>
    );
  }
);

ActiveProcesses.displayName = "ActiveProcesses";

export default ActiveProcesses;
