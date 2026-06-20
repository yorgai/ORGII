/**
 * OrgChart — recursive tree renderer for the team hierarchy.
 *
 * Renders OrgNodeCard per member with CSS-based connector lines.
 * Uses classes from index.scss for vertical/horizontal connectors.
 */
import React from "react";

import type {
  AgentDefinition,
  OrgMember,
} from "@src/modules/MainApp/AgentOrgs/types";

import OrgNodeCard from "./OrgNodeCard";
import { MAX_TREE_DEPTH } from "./config";

interface OrgChartCallbacks {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAddChild: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

interface OrgChartProps extends OrgChartCallbacks {
  root: OrgMember;
  /** When true, skip root node card and only render its children */
  hideRoot?: boolean;
  /** Agent definitions for resolving agentId → display name */
  agents?: AgentDefinition[];
  /**
   * When true, hide the per-node hover action bar (+ / pencil / trash).
   * Used by the wizard preview tab where editing happens elsewhere.
   */
  readOnly?: boolean;
}

interface OrgSubtreeProps extends OrgChartCallbacks {
  node: OrgMember;
  depth: number;
  isRoot: boolean;
  agents?: AgentDefinition[];
  readOnly: boolean;
}

const OrgSubtree: React.FC<OrgSubtreeProps> = ({
  node,
  depth,
  isRoot,
  agents,
  selectedId,
  onSelect,
  onAddChild,
  onEdit,
  onDelete,
  readOnly,
}) => {
  const hasChildren = node.children.length > 0;
  const canAddChild = depth < MAX_TREE_DEPTH;

  return (
    <div className="org-subtree flex flex-col items-center">
      <OrgNodeCard
        node={node}
        agents={agents}
        isSelected={selectedId === node.id}
        canAddChild={canAddChild}
        onSelect={onSelect}
        onAddChild={onAddChild}
        onEdit={onEdit}
        onDelete={onDelete}
        isRoot={isRoot}
        readOnly={readOnly}
      />

      {hasChildren && (
        <>
          <div className="org-vline h-6 w-px bg-border-2" />

          <div className="org-children flex items-start gap-0">
            {node.children.map((child, index) => (
              <div
                key={child.id}
                className={`org-child-branch flex flex-col items-center px-3 ${
                  node.children.length > 1 ? "org-child-connected" : ""
                } ${index === 0 ? "org-child-first" : ""} ${
                  index === node.children.length - 1 ? "org-child-last" : ""
                }`}
              >
                <OrgSubtree
                  node={child}
                  depth={depth + 1}
                  isRoot={false}
                  agents={agents}
                  selectedId={selectedId}
                  onSelect={onSelect}
                  onAddChild={onAddChild}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  readOnly={readOnly}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

const OrgChart: React.FC<OrgChartProps> = ({
  root,
  hideRoot = false,
  agents,
  selectedId,
  onSelect,
  onAddChild,
  onEdit,
  onDelete,
  readOnly = false,
}) => {
  if (hideRoot) {
    return (
      <div className="org-chart inline-flex justify-center gap-6 p-6">
        {root.children.map((child) => (
          <OrgSubtree
            key={child.id}
            node={child}
            depth={1}
            isRoot={false}
            agents={agents}
            selectedId={selectedId}
            onSelect={onSelect}
            onAddChild={onAddChild}
            onEdit={onEdit}
            onDelete={onDelete}
            readOnly={readOnly}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="org-chart inline-flex justify-center p-6">
      <OrgSubtree
        node={root}
        depth={0}
        isRoot={true}
        agents={agents}
        selectedId={selectedId}
        onSelect={onSelect}
        onAddChild={onAddChild}
        onEdit={onEdit}
        onDelete={onDelete}
        readOnly={readOnly}
      />
    </div>
  );
};

export default OrgChart;
