import type { RefObject } from "react";

import type { ComposerInputRef as TiptapInputRef } from "@src/components/ComposerInput";
import type { SessionSource } from "@src/store/session/creatorStateAtom";

import { formatUserInput } from "./useInputFormatter";

export interface PreparedLaunchInput {
  userInput: string;
  agentInput: string;
}

export interface PrepareLaunchInputOptions {
  editorContent: string;
  effectiveSource: SessionSource | null;
  tiptapRef: RefObject<TiptapInputRef>;
}

export async function prepareLaunchInput(
  options: PrepareLaunchInputOptions
): Promise<PreparedLaunchInput> {
  const { editorContent, effectiveSource, tiptapRef } = options;
  const repoRef = effectiveSource?.repoPath
    ? { path: effectiveSource.repoPath }
    : undefined;

  const userInput = tiptapRef.current?.getTextWithPills
    ? (tiptapRef.current.getTextWithPills() || "").trim()
    : formatUserInput({ editorContent, tiptapRef, repo: repoRef }).userInput;

  const { waitForPendingPills } = await import("@src/util/contextPillContent");
  await waitForPendingPills();

  const terminalTexts = tiptapRef.current?.getTerminalPillTexts?.();
  const terminalEntries = terminalTexts ? Object.entries(terminalTexts) : [];
  if (terminalEntries.length === 0) {
    return { userInput, agentInput: userInput };
  }

  const terminalBlocks = terminalEntries.map(([, text]) =>
    ["```", text, "```"].join("\n")
  );
  return {
    userInput,
    agentInput: [userInput, terminalBlocks.join("\n\n")].join("\n\n"),
  };
}
