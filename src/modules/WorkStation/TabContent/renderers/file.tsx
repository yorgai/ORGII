/**
 * Renderer wrapper for `file` tabs.
 *
 * TODO(Phase 2): The current EditorContent host owns `fileContentState`
 * (UseFileContentManagerReturn) and `gitFilesByPath`, both of which
 * `CodeViewerContent` needs to render real file content + dirty-diff
 * baselines. Outside that host this wrapper can only render the
 * placeholder shell. Phase 2 collapses AppShell so the dispatcher mounts
 * INSIDE the editor host and these props become reachable. The live
 * render path is still `TabContentRenderer` in
 * src/modules/WorkStation/CodeEditor/Panels/EditorMainPane/content/TabContentRenderer/index.tsx
 * — do not import this wrapper from the editor host yet.
 */
import React, { memo } from "react";

import type { UnifiedTabContentProps } from "../types";
import { HostCoupledPlaceholder } from "./HostCoupledPlaceholder";

const FileTabRenderer: React.FC<UnifiedTabContentProps> = memo(({ tab }) => {
  const filePath = String(tab.data.filePath ?? "");
  return (
    <HostCoupledPlaceholder
      tabType="file"
      title={filePath || "File"}
      hostNote="Editor host owns fileContentState + gitFilesByPath"
    />
  );
});

FileTabRenderer.displayName = "FileTabRenderer";

export default FileTabRenderer;
