/**
 * Input formatting utilities for session launch
 * Handles file pill extraction and user input formatting
 */
import type { RefObject } from "react";

import type { ComposerInputRef } from "@src/components/ComposerInput";

/**
 * Only the two path-ish fields `formatUserInput` actually reads. Kept
 * narrower than `Repo` so callers don't need to fabricate full Repo
 * objects when they have only a `repoPath` on hand (e.g. SessionSource).
 */
export interface FormatRepoRef {
  path?: string;
  fs_uri?: string;
}

export interface FormatUserInputOptions {
  editorContent: string;
  composerInputRef: RefObject<ComposerInputRef | null>;
  repo: FormatRepoRef | undefined;
}

export interface FormattedInput {
  userInput: string;
  filePills: Array<{ filePath: string }>;
}

/**
 * Extract file pills and format user input with file references
 */
export function formatUserInput(
  options: FormatUserInputOptions
): FormattedInput {
  const { editorContent, composerInputRef, repo } = options;

  const textContent = editorContent.trim();
  const filePills = composerInputRef.current?.getFilePills() || [];

  if (filePills.length === 0) {
    return { userInput: textContent, filePills };
  }

  const repoPath = repo?.path || repo?.fs_uri || "";
  const fileRefs = filePills
    .map((pill) => {
      let relativePath = pill.filePath;
      if (repoPath && pill.filePath.startsWith(repoPath)) {
        relativePath = pill.filePath.slice(repoPath.length);
        if (relativePath.startsWith("/")) {
          relativePath = relativePath.slice(1);
        }
      }
      return `@${relativePath}`;
    })
    .join(" ");

  const userInput = `${fileRefs} ${textContent}`.trim();
  return { userInput, filePills };
}
