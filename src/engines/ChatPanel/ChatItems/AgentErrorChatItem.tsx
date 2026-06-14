/**
 * AgentErrorChatItem — Displays LLM/agent errors inline in the chat panel.
 *
 * Rendered as a single InlineAlert (danger variant), so the error reads as
 * one bordered card instead of the split header / body / footer layout the
 * previous block-style render produced.
 *
 * IMPORTANT: This component must NOT subscribe to chatEventsAtom. It is
 * rendered inside the chat list which is itself driven by chatEventsAtom.
 * Subscribing here creates a nested Jotai listener chain that overflows the
 * call stack when the session snapshot changes (e.g. on tab switch).
 */
import React, { memo } from "react";
import { useTranslation } from "react-i18next";

import InlineAlert from "@src/components/InlineAlert";

import { sanitizeAgentErrorMessage } from "./sanitizeAgentErrorMessage";

export interface AgentErrorChatItemProps {
  errorMessage: string;
}

const AgentErrorChatItem: React.FC<AgentErrorChatItemProps> = memo(
  ({ errorMessage }) => {
    const { t } = useTranslation();

    const cleanMessage = sanitizeAgentErrorMessage(errorMessage);

    return (
      <div className="animate-fade-in">
        <InlineAlert type="danger" title={t("errors.agentRequestFailed")}>
          <div className="whitespace-pre-wrap break-words">{cleanMessage}</div>
        </InlineAlert>
      </div>
    );
  }
);

AgentErrorChatItem.displayName = "AgentErrorChatItem";

export default AgentErrorChatItem;
