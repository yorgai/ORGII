/**
 * BreadcrumbFileHeader Component
 *
 * VS Code-like breadcrumb navigation with dropdowns.
 * Each path segment is clickable and shows files/folders in that directory.
 */
import { ChevronRight } from "lucide-react";
import React, { useCallback, useMemo, useRef, useState } from "react";

import FileDropdown from "./FileDropdown";

export interface BreadcrumbFileHeaderProps {
  /** Full file path to display */
  filePath: string;
  /** Root repository path for navigation */
  repoPath?: string;
  /** Optional icon shown before the final segment (file name) */
  lastSegmentIcon?: React.ReactNode;
  /** Callback when a file is selected from dropdown */
  onFileSelect?: (filePath: string) => void;
  /** When true, breadcrumbs are display-only (no click, no dropdown) */
  disableNavigation?: boolean;
  /**
   * When true, show filePath as a single line (no splitting on `/`).
   * Use when the title is not a file path (e.g. concise shell command label).
   */
  plainTitle?: boolean;
  textSizeClassName?: string;
  className?: string;
}

interface PathSegment {
  label: string;
  fullPath: string;
  isLast: boolean;
}

/**
 * Check if a path is a virtual file (no navigation, just display name)
 * Virtual files: don't contain "/" or start with special prefixes
 */
function isVirtualFile(filePath: string): boolean {
  if (!filePath) return false;
  if (!filePath.includes("/")) return true;
  if (filePath.startsWith("git-error-")) return true;
  if (filePath.startsWith("untitled:")) return true;
  return false;
}

const BreadcrumbFileHeader: React.FC<BreadcrumbFileHeaderProps> = ({
  filePath,
  repoPath,
  lastSegmentIcon,
  onFileSelect,
  disableNavigation,
  plainTitle = false,
  textSizeClassName = "text-[13px]",
  className = "",
}) => {
  const [activeSegmentPath, setActiveSegmentPath] = useState<string | null>(
    null
  );
  const segmentRefs = useRef<Map<string, HTMLSpanElement>>(new Map());
  const activeTriggerRef = useRef<HTMLSpanElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const pathSegments = useMemo(() => {
    if (!filePath) return [];

    if (plainTitle || isVirtualFile(filePath)) {
      return [
        {
          label: filePath,
          fullPath: filePath,
          isLast: true,
        },
      ];
    }

    const parts = filePath.split("/").filter(Boolean);
    const segments: PathSegment[] = [];

    parts.forEach((part, index) => {
      const fullPath = parts.slice(0, index + 1).join("/");
      segments.push({
        label: part,
        fullPath: repoPath ? `${repoPath}/${fullPath}` : fullPath,
        isLast: index === parts.length - 1,
      });
    });

    return segments;
  }, [filePath, repoPath, plainTitle]);

  const scrollToRight = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollLeft = containerRef.current.scrollWidth;
    }
  }, []);

  React.useEffect(() => {
    scrollToRight();
  }, [filePath, scrollToRight]);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(scrollToRight);
    observer.observe(container);
    return () => observer.disconnect();
  }, [scrollToRight]);

  const handleSegmentClick = useCallback(
    (segmentPath: string, isLast: boolean) => {
      if (disableNavigation || isLast) {
        setActiveSegmentPath(null);
        return;
      }

      setActiveSegmentPath((prev) => {
        return prev === segmentPath ? null : segmentPath;
      });
    },
    [disableNavigation]
  );

  const handleFileSelect = useCallback(
    (selectedPath: string) => {
      setActiveSegmentPath(null);
      onFileSelect?.(selectedPath);
    },
    [onFileSelect]
  );

  const handleCloseDropdown = useCallback(() => {
    setActiveSegmentPath(null);
  }, []);

  React.useEffect(() => {
    if (activeSegmentPath) {
      activeTriggerRef.current =
        segmentRefs.current.get(activeSegmentPath) || null;
    } else {
      activeTriggerRef.current = null;
    }
  }, [activeSegmentPath]);

  return (
    <div
      ref={containerRef}
      className={`flex min-w-0 flex-1 items-center gap-0.5 ${
        plainTitle
          ? "overflow-x-hidden"
          : "flex-nowrap overflow-x-auto scrollbar-hide"
      } ${className}`.trim()}
    >
      {pathSegments.map((segment) => {
        const isActive = activeSegmentPath === segment.fullPath;
        const isLast = segment.isLast;
        const singleLineTitle = plainTitle && isLast;

        return (
          <React.Fragment key={segment.fullPath}>
            <span
              ref={(el) => {
                if (el) {
                  segmentRefs.current.set(segment.fullPath, el);
                  if (isActive) {
                    activeTriggerRef.current = el;
                  }
                } else {
                  segmentRefs.current.delete(segment.fullPath);
                  if (activeTriggerRef.current === el) {
                    activeTriggerRef.current = null;
                  }
                }
              }}
              title={singleLineTitle ? filePath : undefined}
              className={`h-6 min-w-0 items-center px-1 ${textSizeClassName} leading-6 transition-colors ${
                singleLineTitle
                  ? "flex flex-1 truncate font-medium text-text-1"
                  : `inline-flex flex-shrink-0 whitespace-nowrap ${
                      isLast
                        ? "font-medium text-text-1"
                        : disableNavigation
                          ? "text-text-2"
                          : "cursor-pointer text-text-2 hover:text-text-1"
                    }`
              } ${isActive && !disableNavigation ? "text-text-1 underline decoration-text-1" : ""}`}
              onClick={() =>
                handleSegmentClick(segment.fullPath, segment.isLast)
              }
            >
              {isLast && lastSegmentIcon ? (
                <span className="mr-1.5 inline-flex shrink-0 items-center text-text-2">
                  {lastSegmentIcon}
                </span>
              ) : null}
              {singleLineTitle ? (
                <span className="min-w-0 flex-1 truncate">{segment.label}</span>
              ) : (
                segment.label
              )}
            </span>

            {!isLast && (
              <ChevronRight
                size={14}
                strokeWidth={1.75}
                className="flex-shrink-0 text-fill-4"
              />
            )}

            {isActive && !disableNavigation && !segment.isLast && (
              <FileDropdown
                visible={true}
                directoryPath={segment.fullPath}
                repoPath={repoPath}
                currentFilePath={filePath}
                onFileSelect={handleFileSelect}
                onClose={handleCloseDropdown}
                triggerRef={activeTriggerRef}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default BreadcrumbFileHeader;
