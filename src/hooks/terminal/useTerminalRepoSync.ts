/**
 * useTerminalRepoSync
 *
 * Sends `cd <repoPath>` to all initialized terminals when the user
 * switches the active repository.  Only fires on *changes* after
 * the first valid repo path (skips mount & initial load).
 */
import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";

import { currentRepoAtom } from "@src/store/repo";
import {
  initializedTerminalIdsAtom,
  terminalSessionsAtom,
} from "@src/store/workstation/codeEditor/terminal";
import { invokeTauri } from "@src/util/platform/tauri/init";
import {
  isAgentPtySessionId,
  toBackendPtySessionId,
} from "@src/util/ui/terminal/ptySessionId";

function shellEscapePath(path: string): string {
  return `'${path.replace(/'/g, "'\\''")}'`;
}

export function useTerminalRepoSync(): void {
  const currentRepo = useAtomValue(currentRepoAtom);
  const sessions = useAtomValue(terminalSessionsAtom);
  const initialized = useAtomValue(initializedTerminalIdsAtom);

  const prevRepoPathRef = useRef<string | null>(null);

  useEffect(() => {
    const rawPath = currentRepo?.path ?? currentRepo?.fs_uri;
    if (!rawPath) return;

    const repoPath = rawPath.startsWith("file://")
      ? rawPath.replace("file://", "")
      : rawPath;

    if (prevRepoPathRef.current === null) {
      prevRepoPathRef.current = repoPath;
      return;
    }

    if (repoPath === prevRepoPathRef.current) return;
    prevRepoPathRef.current = repoPath;

    const cdCmd = `cd ${shellEscapePath(repoPath)}\n`;

    for (const session of sessions) {
      if (session.readOnly || isAgentPtySessionId(session.id)) continue;
      if (!initialized.has(session.id)) continue;

      const ptyId = toBackendPtySessionId(session.id);
      invokeTauri("write_pty", { sessionId: ptyId, data: cdCmd }).catch(
        (err) => {
          // eslint-disable-next-line no-console
          console.warn(
            `[TerminalRepoSync] Failed to cd terminal ${session.id}:`,
            err
          );
        }
      );
    }
  }, [currentRepo, sessions, initialized]);
}
