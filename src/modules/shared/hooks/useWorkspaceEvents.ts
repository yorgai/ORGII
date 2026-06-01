/**
 * useWorkspaceEvents Hook
 *
 * Listens for Tauri workspace events and handles navigation
 * Extracted from index.tsx (lines 784-838)
 */
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";

import { useAppNavigation } from "@src/hooks/navigation/useAppNavigation";
import { useSessionView } from "@src/hooks/ui/tabs/useSessionView";
import { isTauriDesktop } from "@src/util/platform/tauri";

/**
 * Hook to handle Tauri workspace events
 * Listens for:
 * - open-workspace: Navigate to session workspace
 * - open-workflow-workspace: Navigate to create session with workflow params
 */
export function useWorkspaceEvents(): void {
  const { openSession } = useSessionView();
  const { goToNewSession } = useAppNavigation();
  const isTauri = isTauriDesktop();

  const navRef = useRef({ openSession, goToNewSession });
  useEffect(() => {
    navRef.current = { openSession, goToNewSession };
  }, [openSession, goToNewSession]);

  useEffect(() => {
    if (!isTauri) return;

    let cancelled = false;
    let unlistenWorkspaceFn: (() => void) | null = null;
    let unlistenWorkflowFn: (() => void) | null = null;

    listen("open-workspace", async (event) => {
      if (cancelled) return;
      const { sessionId, projectId } = event.payload as {
        sessionId: string;
        projectId: string;
        buildType?: string;
      };

      if (sessionId && projectId) {
        navRef.current.openSession(sessionId);
      }
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
      } else {
        unlistenWorkspaceFn = unlisten;
      }
    });

    listen("open-workflow-workspace", async (event) => {
      if (cancelled) return;
      const { workflowId, projectId } = event.payload as {
        workflowId: string;
        projectId: string;
      };

      if (workflowId && projectId) {
        navRef.current.goToNewSession({ workflowId, projectId });
      }
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
      } else {
        unlistenWorkflowFn = unlisten;
      }
    });

    return () => {
      cancelled = true;
      unlistenWorkspaceFn?.();
      unlistenWorkflowFn?.();
    };
  }, [isTauri]);
}
