import { CheckCircle2, Terminal, XCircle } from "lucide-react";
import React from "react";

import type { CommandResultData } from "../types";

interface CommandResultCardProps {
  card: CommandResultData;
}

const CommandResultCard: React.FC<CommandResultCardProps> = ({ card }) => {
  const isSuccess = card.exitCode === 0;

  return (
    <div className="mx-3 my-2 overflow-hidden rounded-lg border border-fill-4 bg-fill-2">
      {/* Header row: command + exit status */}
      <div className="flex items-center gap-2 border-b border-fill-4 px-3 py-2">
        <Terminal size={12} className="shrink-0 text-text-4" />
        <code className="min-w-0 flex-1 truncate text-xs text-text-2">
          {card.command}
        </code>
        <span
          className={`inline-flex shrink-0 items-center gap-1 text-xs ${isSuccess ? "text-success-6" : "text-danger-6"}`}
        >
          {isSuccess ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
          {isSuccess ? "0" : String(card.exitCode)}
        </span>
      </div>

      {/* Summary row */}
      <div className="px-3 py-2">
        <p className="chat-block-content text-xs text-text-2">{card.summary}</p>
      </div>

      {/* Artifact rows */}
      {card.artifacts && card.artifacts.length > 0 && (
        <div className="border-t border-fill-4 px-3 py-1.5">
          {card.artifacts.map((artifact) => (
            <div
              key={artifact.label}
              className="flex items-center justify-between py-0.5"
            >
              <span className="truncate text-xs text-text-4">
                {artifact.label}
              </span>
              <span className="ml-4 shrink-0 text-xs text-text-3">
                {artifact.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

CommandResultCard.displayName = "CommandResultCard";

export default CommandResultCard;
