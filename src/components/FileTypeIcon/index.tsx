/**
 * FileTypeIcon Component
 *
 * Displays the appropriate SVG icon based on file type.
 * Uses memoization to prevent unnecessary re-renders.
 *
 * @example
 * ```tsx
 * <FileTypeIcon fileName="app.tsx" />
 * <FileTypeIcon fileName="readme.md" size="large" />
 * <FileTypeIcon type="python" size="small" />
 * ```
 */
import React, { memo } from "react";

import { DocumentIcon, ICON_MAP } from "./config";
import { type FileTypeIconProps, SIZE_STYLES } from "./types";
import { getFileTypeFromName } from "./utils";

// Re-export types for external use
export type { FileType, FileTypeIconProps } from "./types";
export { getFileTypeFromName } from "./utils";

/**
 * File type icon component
 */
const FileTypeIcon: React.FC<FileTypeIconProps> = memo(
  ({ fileName, type: propType, className = "", size = "medium" }) => {
    const type = propType || getFileTypeFromName(fileName);
    const { width, height } = SIZE_STYLES[size] || SIZE_STYLES.medium;
    const Icon = ICON_MAP[type];

    if (type === "other" || !Icon) {
      return (
        <DocumentIcon width={width} height={height} className={className} />
      );
    }

    return <Icon width={width} height={height} className={className} />;
  }
);

FileTypeIcon.displayName = "FileTypeIcon";

export default FileTypeIcon;
