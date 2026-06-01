/**
 * Flatten Workflow Utilities
 *
 * Transforms hierarchical ActionInstance[] into a flat list of FlatWorkflowNode[]
 * for simplified drag-and-drop with depth-based indentation.
 */
import type { ActionDefinition, ActionInstance } from "../data";

// ============================================
// Types
// ============================================

export type FlatNodeType = "action" | "branch-label" | "end-block";
export type BranchLabelType = "if-true" | "if-false" | "loop-body";
export type EndBlockType = "end-if" | "end-loop";

export interface FlatWorkflowNode {
  id: string;
  type: FlatNodeType;
  depth: number;

  // For 'action' type
  actionInstance?: ActionInstance;

  // For 'branch-label' type
  labelType?: BranchLabelType;
  parentActionId?: string;

  // For 'end-block' type
  endType?: EndBlockType;

  // Branch context - for determining colors of ghost lines
  branchType?: "if-true" | "if-false" | "loop-body";
}

// ============================================
// Flatten Function
// ============================================

/**
 * Flatten ActionInstance[] into FlatWorkflowNode[] with branch labels and end markers.
 * All actions are in a single flat list with depth indicating nesting level.
 */
export function flattenWorkflowToNodes(
  instances: ActionInstance[],
  definitions: ActionDefinition[]
): FlatWorkflowNode[] {
  const nodes: FlatWorkflowNode[] = [];

  // Get root-level instances (no parent)
  const rootInstances = instances.filter(
    (inst) => !inst.parentIfId && !inst.parentLoopId
  );

  for (const instance of rootInstances) {
    flattenInstance(instance, 0, instances, definitions, nodes);
  }

  return nodes;
}

/**
 * Recursively flatten an instance and its children
 */
function flattenInstance(
  instance: ActionInstance,
  depth: number,
  allInstances: ActionInstance[],
  definitions: ActionDefinition[],
  nodes: FlatWorkflowNode[],
  branchContext?: "if-true" | "if-false" | "loop-body"
): void {
  const definition = definitions.find(
    (def) => def.id === instance.definitionId
  );

  // Add the action node
  nodes.push({
    id: instance.id,
    type: "action",
    depth,
    actionInstance: instance,
    branchType: branchContext,
  });

  // Handle If action - add branches
  if (definition?.type === "if") {
    // IF TRUE branch
    nodes.push({
      id: `label-if-true-${instance.id}`,
      type: "branch-label",
      depth: depth + 1,
      labelType: "if-true",
      parentActionId: instance.id,
      branchType: branchContext, // Inherit parent branch context
    });

    // Get if-true children
    const ifTrueChildren = allInstances.filter(
      (inst) => inst.parentIfId === instance.id && inst.branchType === "if-true"
    );
    for (const child of ifTrueChildren) {
      flattenInstance(
        child,
        depth + 1,
        allInstances,
        definitions,
        nodes,
        "if-true"
      );
    }

    // IF FALSE branch
    nodes.push({
      id: `label-if-false-${instance.id}`,
      type: "branch-label",
      depth: depth + 1,
      labelType: "if-false",
      parentActionId: instance.id,
      branchType: branchContext, // Inherit parent branch context
    });

    // Get if-false children
    const ifFalseChildren = allInstances.filter(
      (inst) =>
        inst.parentIfId === instance.id && inst.branchType === "if-false"
    );
    for (const child of ifFalseChildren) {
      flattenInstance(
        child,
        depth + 1,
        allInstances,
        definitions,
        nodes,
        "if-false"
      );
    }

    // END IF marker - inherits parent branch context
    nodes.push({
      id: `end-if-${instance.id}`,
      type: "end-block",
      depth: depth + 1,
      endType: "end-if",
      parentActionId: instance.id,
      branchType: branchContext,
    });
  }

  // Handle Loop action - add body
  if (definition?.type === "loop") {
    // LOOP BODY label
    nodes.push({
      id: `label-loop-body-${instance.id}`,
      type: "branch-label",
      depth: depth + 1,
      labelType: "loop-body",
      parentActionId: instance.id,
      branchType: branchContext, // Inherit parent branch context
    });

    // Get loop body children
    const loopBodyChildren = allInstances.filter(
      (inst) =>
        inst.parentLoopId === instance.id && inst.branchType === "loop-body"
    );
    for (const child of loopBodyChildren) {
      flattenInstance(
        child,
        depth + 1,
        allInstances,
        definitions,
        nodes,
        "loop-body"
      );
    }

    // END LOOP marker - inherits parent branch context (not loop-body!)
    nodes.push({
      id: `end-loop-${instance.id}`,
      type: "end-block",
      depth: depth + 1,
      endType: "end-loop",
      parentActionId: instance.id,
      branchType: branchContext, // Use parent branch context, not "loop-body"
    });
  }
}

// ============================================
// Reconstruct Function
// ============================================

/**
 * Reconstruct ActionInstance[] from flat nodes after drag-and-drop reorder.
 * Parses the flat list order to determine parent-child relationships.
 */
export function reconstructInstancesFromNodes(
  nodes: FlatWorkflowNode[],
  definitions: ActionDefinition[]
): ActionInstance[] {
  const instances: ActionInstance[] = [];

  // Track parent context as we traverse
  interface ParentContext {
    actionId: string;
    type: "if" | "loop";
    currentBranch: "if-true" | "if-false" | "loop-body" | null;
  }

  const parentStack: ParentContext[] = [];

  for (const node of nodes) {
    if (node.type === "action" && node.actionInstance) {
      const definition = definitions.find(
        (def) => def.id === node.actionInstance!.definitionId
      );

      // Determine parent from stack
      const currentParent = parentStack[parentStack.length - 1];

      const newInstance: ActionInstance = {
        ...node.actionInstance,
        parentIfId:
          currentParent?.type === "if" ? currentParent.actionId : undefined,
        parentLoopId:
          currentParent?.type === "loop" ? currentParent.actionId : undefined,
        branchType: currentParent?.currentBranch || undefined,
        nestingLevel: parentStack.length > 0 ? parentStack.length : undefined,
      };

      instances.push(newInstance);

      // If this is an if/loop, push to stack (will be closed by end-block)
      if (definition?.type === "if") {
        parentStack.push({
          actionId: node.actionInstance.id,
          type: "if",
          currentBranch: null,
        });
      } else if (definition?.type === "loop") {
        parentStack.push({
          actionId: node.actionInstance.id,
          type: "loop",
          currentBranch: null,
        });
      }
    } else if (node.type === "branch-label") {
      // Update current branch on the parent
      const currentParent = parentStack[parentStack.length - 1];
      if (currentParent && node.labelType) {
        currentParent.currentBranch = node.labelType;
      }
    } else if (node.type === "end-block") {
      // Pop the parent from stack
      parentStack.pop();
    }
  }

  return instances;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Get display label for branch type
 */
export function getBranchLabelText(
  labelType: BranchLabelType,
  depth: number
): string {
  const level = depth > 1 ? ` (L${depth})` : "";
  switch (labelType) {
    case "if-true":
      return `When True${level}`;
    case "if-false":
      return `When False${level}`;
    case "loop-body":
      return `Repeat${level}`;
    default:
      return "";
  }
}

/**
 * Get display label for end block type
 */
export function getEndBlockText(endType: EndBlockType): string {
  switch (endType) {
    case "end-if":
      return "End If";
    case "end-loop":
      return "End Loop";
    default:
      return "";
  }
}

/**
 * Get color class for branch label
 */
export function getBranchLabelColor(labelType: BranchLabelType): string {
  switch (labelType) {
    case "if-true":
      return "text-success-6";
    case "if-false":
      return "text-danger-6";
    case "loop-body":
      return "text-warning-6";
    default:
      return "text-text-3";
  }
}

/**
 * Get color class for end block
 */
export function getEndBlockColor(endType: EndBlockType): string {
  switch (endType) {
    case "end-if":
      return "text-primary-6";
    case "end-loop":
      return "text-warning-6";
    default:
      return "text-text-3";
  }
}
