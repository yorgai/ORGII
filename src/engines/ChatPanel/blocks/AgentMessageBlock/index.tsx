/**
 * AgentMessageBlock - Wraps agent messages in a collapsible block
 *
 * Header removed -- agent message content renders flush, with no row above it.
 * Agent messages still do NOT participate in "collapse all" so the user can
 * always read the conversation.
 */
import React from "react";

export interface AgentMessageBlockProps {
  children: React.ReactNode;
}

const AgentMessageBlock: React.FC<AgentMessageBlockProps> = ({ children }) => {
  return (
    <div className="w-full min-w-0 overflow-hidden px-2 py-1">{children}</div>
  );
};

AgentMessageBlock.displayName = "AgentMessageBlock";

export default AgentMessageBlock;
