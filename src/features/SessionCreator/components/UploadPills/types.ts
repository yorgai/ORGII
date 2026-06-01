/**
 * UploadPills Type Definitions
 */

// ============================================
// File Types
// ============================================

export interface UploadedFile {
  /** Unique identifier for the file */
  id: string;
  /** Display name of the file */
  name: string;
  /** File type category */
  type: "text" | "image" | "document" | "folder";
  /** Optional File object reference (for browser uploads) */
  file?: File;
  /** Optional file path (for Tauri drops) */
  path?: string;
}

// ============================================
// Component Props
// ============================================

export interface UploadPillsProps {
  /** List of uploaded files to display */
  files: UploadedFile[];
  /** Callback when a file is removed */
  onRemove: (fileId: string) => void;
  /** Maximum number of pills to show before scrolling */
  maxVisible?: number;
  /** Additional CSS classes */
  className?: string;
}

export interface UploadPillProps {
  /** The file to display */
  file: UploadedFile;
  /** Callback when remove button is clicked */
  onRemove: () => void;
  /** Additional CSS classes */
  className?: string;
}
