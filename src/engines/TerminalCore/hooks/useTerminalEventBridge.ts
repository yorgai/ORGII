import { useSetAtom } from "jotai";
import { useEffect } from "react";

import { createAgentTerminalSessionAtom } from "@src/store/workstation/codeEditor/terminal";

export function useTerminalEventBridge(): void {
  const dispatchCreateAgentSession = useSetAtom(createAgentTerminalSessionAtom);

  useEffect(() => {
    function handleAgentTerminal(event: Event) {
      const detail = (
        event as CustomEvent<{ ptySessionId: string; label?: string }>
      ).detail;
      if (detail?.ptySessionId) {
        dispatchCreateAgentSession({
          ptySessionId: detail.ptySessionId,
          label: detail.label,
        });
      }
    }

    window.addEventListener("agent-terminal-created", handleAgentTerminal);
    return () => {
      window.removeEventListener("agent-terminal-created", handleAgentTerminal);
    };
  }, [dispatchCreateAgentSession]);
}
