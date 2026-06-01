import { Slash } from "lucide-react";
import React, { useMemo } from "react";

const PATH_SEPARATOR = (
  <Slash
    size={10}
    strokeWidth={1.5}
    className="shrink-0 -rotate-12 text-text-4/50"
  />
);

const MAX_VISIBLE_SEGMENTS = 4;

interface FilePathBreadcrumbProps {
  path: string;
}

const FilePathBreadcrumb: React.FC<FilePathBreadcrumbProps> = ({ path }) => {
  const segments = useMemo(() => path.split("/").filter(Boolean), [path]);

  const displaySegments = useMemo(() => {
    if (segments.length <= MAX_VISIBLE_SEGMENTS) return segments;
    return [
      segments[0],
      "\u2026",
      ...segments.slice(-(MAX_VISIBLE_SEGMENTS - 2)),
    ];
  }, [segments]);

  const lastIndex = displaySegments.length - 1;

  return (
    <span className="inline-flex items-center gap-0.5 text-xs">
      {displaySegments.map((segment, index) => {
        const isFile = index === lastIndex;
        return (
          <React.Fragment key={index}>
            {index > 0 && PATH_SEPARATOR}
            <span
              className={isFile ? "font-medium text-text-1" : "text-text-2"}
            >
              {segment}
            </span>
          </React.Fragment>
        );
      })}
    </span>
  );
};

export default FilePathBreadcrumb;
