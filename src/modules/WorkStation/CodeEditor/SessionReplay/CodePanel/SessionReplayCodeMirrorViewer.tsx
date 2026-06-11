/**
 * Read-only CodeMirror viewer for session replay file display.
 * Uses the same editor theme, typography, and syntax highlighting as the real code editor.
 */
import React, { memo } from "react";

import { CodeMirrorEditor } from "@src/features/CodeMirror";

export interface SessionReplayCodeMirrorViewerProps {
  content: string;
  filePath?: string;
  language?: string;
  /** 1-indexed file line of the first content line (ranged reads). */
  startLine?: number;
}

export const SessionReplayCodeMirrorViewer: React.FC<SessionReplayCodeMirrorViewerProps> =
  memo(({ content, filePath, language, startLine }) => {
    return (
      <div className="h-full min-h-0 min-w-0 overflow-hidden [&_.codemirror-editor-wrapper]:h-full">
        <CodeMirrorEditor
          value={content}
          filePath={filePath}
          language={language}
          height="100%"
          readOnly
          enableMinimap={false}
          enableLinting={false}
          enableDirtyDiff={false}
          registerWithService={false}
          enableGitBlame={false}
          lineNumberStart={startLine}
        />
      </div>
    );
  });

SessionReplayCodeMirrorViewer.displayName = "SessionReplayCodeMirrorViewer";
