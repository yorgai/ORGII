/**
 * DiffSidebarList
 *
 * Left-pane virtualized tree list of diff entries. Reuses the same TreeRowBase
 * + VirtualizedStickyTree primitives that Source Control uses for sidebar rows.
 */
import { FileText } from "lucide-react";
import React, { memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { TREE_ROW_HEIGHT, TreeRowBase } from "@src/components/TreeRow";
import type { TreeRowNode } from "@src/components/TreeRow";
import { VirtualizedStickyTree } from "@src/components/VirtualizedStickyTree";
import type {
  FlattenedTreeNode,
  TreeNodeBase,
} from "@src/components/VirtualizedStickyTree";
import { Placeholder } from "@src/modules/shared/layouts/blocks";

import type { DiffEntry } from "./types";

interface DiffSidebarListProps {
  entries: DiffEntry[];
  selectedEntryId: string | null;
  onSelectEntry: (entryId: string) => void;
}

interface DiffTreeNode extends TreeNodeBase {
  entry: DiffEntry;
  rowNode: TreeRowNode;
}

function buildDiffTreeNode(entry: DiffEntry): FlattenedTreeNode<DiffTreeNode> {
  const rowName = entry.fileName || entry.event.functionName;
  const rowPath = entry.filePath || rowName;
  const rowNode: TreeRowNode = {
    id: entry.entryId,
    name: rowName,
    path: rowPath,
    type: "file",
    ...(entry.fileName
      ? {}
      : { icon: <FileText size={14} className="text-text-3" /> }),
  };

  return {
    node: {
      path: entry.entryId,
      name: rowName,
      isFolder: false,
      entry,
      rowNode,
    },
    depth: 0,
  };
}

const DiffSidebarList: React.FC<DiffSidebarListProps> = ({
  entries,
  selectedEntryId,
  onSelectEntry,
}) => {
  const { t } = useTranslation("sessions");

  const flattenedNodes = useMemo(
    () => entries.map(buildDiffTreeNode),
    [entries]
  );

  const renderItem = useCallback(
    (item: FlattenedTreeNode<DiffTreeNode>) => {
      const { entry, rowNode } = item.node;
      return (
        <TreeRowBase
          node={rowNode}
          depth={item.depth}
          isSelected={entry.entryId === selectedEntryId}
          onClick={() => onSelectEntry(entry.entryId)}
          dataPath={entry.entryId}
        />
      );
    },
    [onSelectEntry, selectedEntryId]
  );

  if (entries.length === 0) {
    return (
      <Placeholder
        variant="empty"
        placement="sidebar"
        title={t(
          "simulator.replay.diffApp.emptyForFilter",
          "No diffs match this filter yet."
        )}
        fillParentHeight
      />
    );
  }

  return (
    <VirtualizedStickyTree
      flattenedNodes={flattenedNodes}
      rowHeight={TREE_ROW_HEIGHT}
      renderItem={renderItem}
      emptyMessage={t(
        "simulator.replay.diffApp.emptyForFilter",
        "No diffs match this filter yet."
      )}
    />
  );
};

export default memo(DiffSidebarList);
