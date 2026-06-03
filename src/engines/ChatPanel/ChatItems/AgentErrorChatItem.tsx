/**
 * AgentErrorChatItem — Displays LLM/agent errors inline in the chat panel.
 *
 * Rendered as a single InlineAlert (danger variant), so the error reads as
 * one bordered card with the Resume action on the header row, instead of the
 * split header / body / footer layout the previous block-style render produced.
 *
 * IMPORTANT: This component must NOT subscribe to chatEventsAtom. It is
 * rendered inside the chat list which is itself driven by chatEventsAtom.
 * Subscribing here creates a nested Jotai listener chain that overflows the
 * call stack when the session snapshot changes (e.g. on tab switch).
 *
 * Resume flow:
 *   1. The user message that produced this error is kept visible (it is the
 *      same prompt the user wants the agent to attempt again).
 *   2. The Resume button calls `dispatcher.sendMessage` with empty content
 *      and `isResume: true`. The Rust backend runs
 *      `recovery::filter_unresolved_tool_uses` (deletion-based, like CC's
 *      `filterUnresolvedToolUses`) instead of injecting a synthetic
 *      continuation user message — so the next turn picks up cleanly from
 *      the original user prompt without any duplicate bubbles.
 */
import { useAtomValue } from "jotai";
import { RefreshCw } from "lucide-react";
import React, { memo, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { isHostedKey } from "@src/api/tauri/session";
import Button from "@src/components/Button";
import InlineAlert from "@src/components/InlineAlert";
import type { AgentExecMode } from "@src/config/sessionCreatorConfig";
import { useAgentTurnContext } from "@src/engines/ChatPanel/ChatHistory/AgentTurnContext";
import { useChatSessionId } from "@src/engines/ChatPanel/ChatSessionContext";
import { SessionService } from "@src/engines/SessionCore/services/SessionService";
import {
  creatorDefaultExecModeAtom,
  creatorDefaultModelSelectionAtom,
  sessionByIdAtom,
} from "@src/store/session";
import { resolveModelForMessage } from "@src/util/session/resolveModelForMessage";

export interface AgentErrorChatItemProps {
  errorMessage: string;
}

const AgentErrorChatItem: React.FC<AgentErrorChatItemProps> = memo(
  ({ errorMessage }) => {
    const { t } = useTranslation();

    // Resolve the session id from the surrounding ChatView's
    // context, NOT the global pipeline atom. A kanban detail panel
    // can claim the pipeline for session B while WorkStation's chat
    // is still rendering session A in the side panel — both error
    // items must Retry against the session they actually belong to.
    const sessionId = useChatSessionId() ?? null;
    // Per-session source of truth: read model+mode straight from the
    // session row. Creator-default atoms only kick in for very old
    // sessions whose row was created before per-session columns
    // existed (or before the user's first ModePill / model picker
    // interaction).
    const session = useAtomValue(sessionByIdAtom(sessionId ?? ""));
    const creatorDefaultSelection = useAtomValue(
      creatorDefaultModelSelectionAtom
    );
    const creatorDefaultMode = useAtomValue(creatorDefaultExecModeAtom);
    const [isResuming, setIsResuming] = useState(false);

    // Resume only makes sense when this error is the trailing event in
    // the most recent turn. Two gates:
    //   1. `isLastGroup` — the user has not started a follow-up turn
    //      after this error. Resuming a stale turn would clobber the
    //      newer turn.
    //   2. `isLastItemInGroup` — the agent has not produced more output
    //      (assistant message, tool call, …) after the error inside
    //      the same user turn. If it has, the error was already worked
    //      around and Resume would clobber that newer output.
    // `useAgentTurnContext` returns `null` outside the chat history
    // (e.g. Playground preview); treat that as "no Resume" too.
    const turnContext = useAgentTurnContext();
    const canResume =
      (turnContext?.isLastGroup ?? false) &&
      (turnContext?.isLastItemInGroup ?? false);

    const handleResume = useCallback(async () => {
      if (!sessionId || isResuming) return;

      const keySource =
        session?.keySource ?? creatorDefaultSelection?.keySource;
      const isHosted = isHostedKey(keySource);
      const lastModelSelection = session
        ? {
            ...creatorDefaultSelection,
            keySource,
            model: isHosted
              ? undefined
              : (session.model ?? creatorDefaultSelection?.model),
            listingModel: isHosted
              ? (session.model ?? creatorDefaultSelection?.listingModel)
              : undefined,
            selectedAccountId:
              session.accountId ?? creatorDefaultSelection?.selectedAccountId,
            cliAgentType:
              session.cliAgentType ?? creatorDefaultSelection?.cliAgentType,
            tier: session.tier ?? creatorDefaultSelection?.tier,
          }
        : creatorDefaultSelection;
      const agentExecMode: AgentExecMode =
        (session?.agentExecMode as AgentExecMode | undefined) ??
        creatorDefaultMode;
      const { model, accountId } = resolveModelForMessage(lastModelSelection);

      setIsResuming(true);
      try {
        await SessionService.sendMessage({
          sessionId,
          content: "",
          isResume: true,
          model,
          accountId,
          mode: agentExecMode,
        });
      } catch (err) {
        console.error("[AgentErrorChatItem] Resume failed:", err);
      } finally {
        setIsResuming(false);
      }
    }, [
      sessionId,
      isResuming,
      session,
      creatorDefaultSelection,
      creatorDefaultMode,
    ]);

    const cleanMessage = errorMessage.replace(/^Error:\s*/i, "");

    return (
      <div className="animate-fade-in">
        <InlineAlert type="danger" title={t("errors.agentRequestFailed")}>
          <div className="whitespace-pre-wrap break-words">{cleanMessage}</div>
          {canResume && (
            <div className="mt-2">
              <Button
                variant="secondary"
                size="small"
                onClick={handleResume}
                disabled={isResuming}
                icon={
                  <RefreshCw
                    size={12}
                    strokeWidth={1.75}
                    className={isResuming ? "animate-spin" : ""}
                  />
                }
                iconPosition="left"
              >
                {t("common:actions.resume")}
              </Button>
            </div>
          )}
        </InlineAlert>
      </div>
    );
  }
);

AgentErrorChatItem.displayName = "AgentErrorChatItem";

export default AgentErrorChatItem;
