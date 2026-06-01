/**
 * FileTreePreview Types
 */

// ============================================
// Tree Node Structure
// ============================================

export interface TreeNode {
  /** Name of the file or folder */
  name: string;
  /** Whether this node represents a file (vs folder) */
  isFile: boolean;
  /** Whether this node should be highlighted (usually the target) */
  isHighlighted: boolean;
  /** Child nodes (subdirectories/files) */
  children: TreeNode[];
}

// ============================================
// Component Props
// ============================================

export interface FileTreePreviewProps {
  /** The file or folder path to display */
  path: string;
  /** Type of the item (file or folder) - affects icon display */
  itemType?: "file" | "folder";
  /** Repository root path - used to compute relative paths */
  repoPath?: string;
  /** Custom width for the panel */
  width?: string | number;
  /** Additional CSS classes */
  className?: string;
}
