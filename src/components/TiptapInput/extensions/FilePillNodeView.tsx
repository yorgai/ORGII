/**
 * FilePill Node View Component (Tiptap-side adapter)
 *
 * Used by the heavyweight `RichTextEditor` (which still runs on Tiptap for
 * its markdown / floating-toolbar / lists / code-block stack). All pill UI
 * lives in `ComposerPill` — this file just adapts the NodeView protocol
 * (attrs + deleteNode) onto the shared component.
 */
import { NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import React from "react";

import type { PillIconType } from "@src/components/ComposerInput";
import ComposerPill from "@src/components/ComposerInput/ComposerPill";

const FilePillNodeView: React.FC<NodeViewProps> = ({ node, deleteNode }) => {
  const { filePath, fileName, isFolder, iconType, lineStart, lineEnd } =
    node.attrs as {
      filePath: string;
      fileName: string;
      isFolder: boolean;
      iconType: PillIconType | null;
      lineStart: number | null;
      lineEnd: number | null;
    };

  return (
    <NodeViewWrapper
      as="span"
      className="file-pill-node"
      data-file-path={filePath}
      contentEditable={false}
      style={{ display: "inline" }}
    >
      <ComposerPill
        attrs={{
          filePath,
          fileName,
          isFolder,
          iconType,
          lineStart,
          lineEnd,
        }}
        onDelete={() => deleteNode()}
      />
    </NodeViewWrapper>
  );
};

export default FilePillNodeView;
