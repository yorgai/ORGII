import { ChevronRight } from "lucide-react";
import React from "react";

import BreadcrumbFileHeader from "@src/modules/shared/components/FileHeader/BreadcrumbFileHeader";

export interface ProjectManagerBreadcrumbSegment {
  label: string;
}

interface ProjectManagerBreadcrumbProps {
  segments: readonly ProjectManagerBreadcrumbSegment[];
  trailingNode?: React.ReactNode;
}

const STORY_MANAGER_BREADCRUMB_SEPARATOR = "/";

function escapeBreadcrumbSegment(label: string): string {
  return label.split(STORY_MANAGER_BREADCRUMB_SEPARATOR).join("∕");
}

export const ProjectManagerBreadcrumb: React.FC<
  ProjectManagerBreadcrumbProps
> = ({ segments, trailingNode }) => {
  const displaySegments = segments.filter((segment) => segment.label.trim());
  const filePath = displaySegments
    .map((segment) => escapeBreadcrumbSegment(segment.label))
    .join(STORY_MANAGER_BREADCRUMB_SEPARATOR);

  if (!filePath && !trailingNode) return null;

  return (
    <div className="flex min-w-0 flex-none items-center gap-0.5">
      {filePath && (
        <BreadcrumbFileHeader
          filePath={filePath}
          disableNavigation
          textSizeClassName="text-[12px]"
          className="!flex-none"
        />
      )}
      {trailingNode && filePath && (
        <ChevronRight
          size={14}
          strokeWidth={1.75}
          className="flex-shrink-0 text-fill-4"
        />
      )}
      {trailingNode && (
        <span className="inline-flex h-6 flex-shrink-0 items-center">
          {trailingNode}
        </span>
      )}
    </div>
  );
};

export default ProjectManagerBreadcrumb;
