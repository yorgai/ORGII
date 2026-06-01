/**
 * Workflow Editor State Management
 *
 * Stores state for workflow editor interactions
 */
import { atom } from "jotai";

// ============================================
// Atoms
// ============================================

/**
 * Workflow drag active atom
 * Set to true when dragging workflow nodes to prevent GlobalDragDrop interference
 */
export const workflowDragActiveAtom = atom<boolean>(false);
workflowDragActiveAtom.debugLabel = "workflowDragActiveAtom";
