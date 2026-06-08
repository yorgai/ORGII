/**
 * WorkStation FileTreeContent wrapper.
 *
 * Re-exports the shared FileTreeContent, injecting the WorkStation-specific
 * stickyBgClass from the primary sidebar surface token hook.
 */
import React, { forwardRef, memo } from "react";

import {
  type FileTreeContentHandle,
  type FileTreeContentProps,
  FileTreeContent as SharedFileTreeContent,
} from "@src/components/FileTreeContent";
import { usePrimarySidebarSurface } from "@src/modules/WorkStation/shared/hooks/usePrimarySidebarSurface";

export type { FileTreeContentHandle, FileTreeContentProps };

const FileTreeContentInner = forwardRef<
  FileTreeContentHandle,
  FileTreeContentProps
>((props, ref) => {
  const { stickyBgClass } = usePrimarySidebarSurface();
  return (
    <SharedFileTreeContent ref={ref} {...props} stickyBgClass={stickyBgClass} />
  );
});

FileTreeContentInner.displayName = "FileTreeContent";

export const FileTreeContent = memo(FileTreeContentInner);
FileTreeContent.displayName = "FileTreeContent";
