/**
 * FileSearchPanel Component
 *
 * Floating overlay panel for file search with fuzzy matching.
 * Uses the sidebar variant of SearchInput.
 * (This is a file picker like Ctrl+P, not a code search panel)
 */
import React, { memo } from "react";

import {
  BaseFileSearchPanel,
  type FileSearchPanelProps,
} from "./BaseFileSearchPanel";

export const FileSearchPanel: React.FC<FileSearchPanelProps> = memo((props) => {
  return <BaseFileSearchPanel {...props} searchInputVariant="sidebar" />;
});

FileSearchPanel.displayName = "FileSearchPanel";

export default FileSearchPanel;
