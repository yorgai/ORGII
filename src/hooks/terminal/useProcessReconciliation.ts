/**
 * useProcessReconciliation
 *
 * Runs once at startup to reseed in-memory process state from Rust's
 * authoritative process tables. Fixes the "blank after hot reload" problem
 * for both agent shell processes and Code Editor PTY sessions.
 *
 * Agent shells:
 *   Calls `agent_list_running_shell_jobs` → seeds `shellProcessMapAtom`
 *   with processes that are still alive in Rust's job registry.
 *
 * PTY sessions:
 *   Calls `list_pty_sessions` → cross-references with `terminalSessionsAtom`
 *   (persisted in localStorage). Removes entries whose Rust PTY is gone,
 *   refreshes metadata (pid, shell, cwd) for entries that are still alive.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef } from "react";

import {
  shellProcessMapAtom,
  updateShellProcessAtom,
} from "@src/store/session/shellProcessAtom";
import {
  closeTerminalSessionAtom,
  terminalSessionsAtom,
  updateTerminalSessionInfoAtom,
} from "@src/store/workstation/codeEditor/terminal";
import type { ShellKind } from "@src/types/terminal";
import { invokeTauri } from "@src/util/platform/tauri/init";
import { toBackendPtySessionId } from "@src/util/ui/terminal/ptySessionId";

interface RunningShellJob {
  session_id: string;
  pid: number;
  command: string;
  log_path: string | null;
}

interface PtySessionInfo {
  session_id: string;
  pid: number | null;
  shell: string;
  shell_kind: ShellKind;
  cwd: string | null;
  name: string | null;
}

export function useProcessReconciliation(): void {
  const shellProcessMap = useAtomValue(shellProcessMapAtom);
  const terminalSessions = useAtomValue(terminalSessionsAtom);
  const dispatchUpdateShellProcess = useSetAtom(updateShellProcessAtom);
  const dispatchUpdateTerminalInfo = useSetAtom(updateTerminalSessionInfoAtom);
  const dispatchCloseSession = useSetAtom(closeTerminalSessionAtom);

  // Mirror the latest values into refs so the one-shot startup effect always
  // sees the current atom state even if it was still initializing on mount.
  const shellProcessMapRef = useRef(shellProcessMap);
  const terminalSessionsRef = useRef(terminalSessions);
  const dispatchUpdateShellProcessRef = useRef(dispatchUpdateShellProcess);
  const dispatchUpdateTerminalInfoRef = useRef(dispatchUpdateTerminalInfo);
  const dispatchCloseSessionRef = useRef(dispatchCloseSession);

  useEffect(() => {
    shellProcessMapRef.current = shellProcessMap;
    terminalSessionsRef.current = terminalSessions;
    dispatchUpdateShellProcessRef.current = dispatchUpdateShellProcess;
    dispatchUpdateTerminalInfoRef.current = dispatchUpdateTerminalInfo;
    dispatchCloseSessionRef.current = dispatchCloseSession;
  });

  useEffect(() => {
    let cancelled = false;

    async function reconcile() {
      // --- Agent shell processes ---
      try {
        const runningJobs = await invokeTauri<RunningShellJob[]>(
          "agent_list_running_shell_jobs"
        );
        if (cancelled) return;

        for (const job of runningJobs) {
          const existing = shellProcessMapRef.current
            .get(job.session_id)
            ?.get(job.pid);
          if (
            !existing ||
            existing.status === "exited" ||
            existing.status === "killed"
          ) {
            dispatchUpdateShellProcessRef.current({
              type: "start",
              sessionId: job.session_id,
              pid: job.pid,
              command: job.command,
              logPath: job.log_path ?? undefined,
            });
          }
        }
      } catch (err) {
        console.error("[ProcessReconciliation] agent jobs:", err);
      }

      // --- PTY sessions ---
      try {
        const livePtySessions =
          await invokeTauri<PtySessionInfo[]>("list_pty_sessions");
        if (cancelled) return;

        const livePtyIds = new Set(livePtySessions.map((s) => s.session_id));

        for (const session of terminalSessionsRef.current) {
          if (session.readOnly) continue;

          const ptyId = toBackendPtySessionId(session.id);
          if (!livePtyIds.has(ptyId)) {
            dispatchCloseSessionRef.current(session.id);
          } else {
            const info = livePtySessions.find((s) => s.session_id === ptyId);
            if (info) {
              dispatchUpdateTerminalInfoRef.current({
                sessionId: session.id,
                info: {
                  pid: info.pid ?? undefined,
                  shell: info.shell,
                  shellKind: info.shell_kind,
                  cwd: info.cwd ?? undefined,
                },
              });
            }
          }
        }
      } catch (err) {
        console.error("[ProcessReconciliation] pty sessions:", err);
      }
    }

    reconcile();

    return () => {
      cancelled = true;
    };
  }, []); // One-shot startup reconciliation: deps intentionally empty.
  // Live values are accessed via refs updated on every render above.
}
