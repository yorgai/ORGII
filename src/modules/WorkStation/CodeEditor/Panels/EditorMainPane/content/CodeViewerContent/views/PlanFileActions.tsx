/**
 * PlanFileActions — "Execute Plan" button shown in the FileHeader
 * when a .plan.md file is open in the editor.
 *
 * Uses the current editor content (planContent prop) so that
 * user edits to the plan file are respected on execute.
 */
import { useAtomValue } from "jotai";
import { Play } from "lucide-react";
import React, { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";

import { isOwnKey } from "@src/api/tauri/session";
import Button from "@src/components/Button";
import Message from "@src/components/Message";
import { PlanExecutionService } from "@src/engines/SessionCore/services/PlanExecutionService";
import { useSessionExecModeField } from "@src/hooks/session/useSessionPatch";
import { currentRepoAtom } from "@src/store/repo";
import { creatorDefaultModelSelectionAtom } from "@src/store/session/creatorDefaultModelAtom";
import { sessionByIdAtom } from "@src/store/session/sessionAtom";
import { activeSessionIdAtom } from "@src/store/session/viewAtom";
import { isAgentSession } from "@src/util/session/sessionDispatch";

interface PlanFileActionsProps {
  planContent: string;
}

export const PlanFileActions: React.FC<PlanFileActionsProps> = memo(
  ({ planContent }) => {
    const { t } = useTranslation("sessions");
    const sessionId = useAtomValue(activeSessionIdAtom);
    const session = useAtomValue(sessionByIdAtom(sessionId ?? ""));
    const { setMode: setSessionExecMode } = useSessionExecModeField(
      sessionId ?? ""
    );
    const creatorDefaultSelection = useAtomValue(
      creatorDefaultModelSelectionAtom
    );
    const currentRepo = useAtomValue(currentRepoAtom);

    const handleExecute = useCallback(() => {
      if (!sessionId || !isAgentSession(sessionId)) {
        Message.error(t("planner.plan.noActiveSession"));
        return;
      }

      const trimmed = planContent.trim();
      if (!trimmed) {
        Message.error("Plan file is empty");
        return;
      }

      // Persist mode=build on this session, not as a global default.
      // Fire-and-forget; the dispatch below pins `mode: "build"`
      // on the wire too so the call is correct even if the patch is
      // still in flight.
      void setSessionExecMode("build");

      // Prefer the session row's own-key model+account; fall back to
      // the creator-default selection only if the session has no
      // model yet (very fresh agent session, no model picker run).
      const sessionKeySource =
        session?.keySource ?? creatorDefaultSelection?.keySource;
      const useSession = session?.model && isOwnKey(sessionKeySource);
      const model = useSession
        ? session?.model
        : creatorDefaultSelection != null &&
            isOwnKey(creatorDefaultSelection.keySource)
          ? creatorDefaultSelection.model
          : undefined;
      const accountId = useSession
        ? session?.accountId
        : creatorDefaultSelection != null &&
            isOwnKey(creatorDefaultSelection.keySource)
          ? creatorDefaultSelection.selectedAccountId
          : undefined;
      // The session row's persisted repo path is the source of truth for
      // `workspace_root`. The global repo selection atom is only a fallback
      // for older rows without the per-session column — using it first would
      // let two open sessions on different repos collide whenever global
      // selection is focused on the "wrong" repo at dispatch time.
      const activeRepoPath =
        session?.repoPath ??
        currentRepo?.path ??
        currentRepo?.fs_uri ??
        undefined;

      PlanExecutionService.executePlanDocument({
        sessionId,
        planContent: trimmed,
        model,
        accountId,
        workspacePath: activeRepoPath,
        mode: "build",
      }).catch((err: unknown) => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error("[PlanFileActions] Agent message error:", errorMsg);
        Message.error(errorMsg);
      });
    }, [
      sessionId,
      session,
      planContent,
      setSessionExecMode,
      creatorDefaultSelection,
      currentRepo,
      t,
    ]);

    if (!sessionId || !isAgentSession(sessionId) || !planContent.trim()) {
      return null;
    }

    return (
      <Button
        variant="primary"
        size="mini"
        onClick={handleExecute}
        icon={<Play size={12} />}
      >
        {t("planner.plan.executePlan")}
      </Button>
    );
  }
);

PlanFileActions.displayName = "PlanFileActions";
