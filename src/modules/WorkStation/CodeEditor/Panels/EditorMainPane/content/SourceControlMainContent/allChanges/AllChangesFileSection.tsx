import React, { memo } from "react";

import { DiffFileSection } from "@src/modules/WorkStation/shared";
import type { GitFile } from "@src/types/git/types";

export interface AllChangesFileSectionProps {
  file: GitFile;
  defaultExpanded?: boolean;
  repoPath?: string;
  sectionRef?: React.RefObject<HTMLDivElement>;
  onFileSelect?: (path: string) => void;
  onRequestContent?: (file: GitFile) => void;
}

const AllChangesFileSection: React.FC<AllChangesFileSectionProps> = ({
  file,
  defaultExpanded = true,
  repoPath,
  sectionRef,
  onFileSelect,
  onRequestContent,
}) => {
  return (
    <DiffFileSection
      file={file}
      defaultExpanded={defaultExpanded}
      repoPath={repoPath}
      sectionRef={sectionRef}
      onFileSelect={onFileSelect}
      onRequestContent={
        onRequestContent ? () => onRequestContent(file) : undefined
      }
    />
  );
};

AllChangesFileSection.displayName = "AllChangesFileSection";

export default memo(AllChangesFileSection);
