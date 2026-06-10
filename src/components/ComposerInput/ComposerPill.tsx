/**
 * ComposerPill
 *
 * Atomic, non-editable inline pill rendered inside the ComposerInput
 * `contenteditable` host. The wrapping `<span>` uses `contenteditable="false"`
 * so the browser treats the entire pill as a single insertion point — caret
 * navigation, selection, and Backspace/Delete operate on the whole node.
 *
 * Mirrors the inline context-pill visual + hover-preview behavior without
 * relying on a rich text editor framework.
 */
import {
  AtSign,
  Code,
  FolderKanban,
  GitBranch,
  Globe,
  ListChecks,
  MessageSquare,
  SquareMousePointer,
  Terminal,
  Toolbox,
  X,
} from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import FileTreePreview from "@src/components/FileTreePreview";
import FileTypeIcon from "@src/components/FileTypeIcon";
import { PILL_SIZE } from "@src/config/pillTokens";

import BasePill from "./BasePill";
import type { ComposerPillAttrs, PillIconType } from "./types";

const PREVIEW_SHOW_DELAY = 300;
const PREVIEW_HIDE_DELAY = 150;
const ICON_PROPS = { size: PILL_SIZE.iconSize, strokeWidth: 1.75 } as const;

/** Heuristic for resolving plain file/folder references into folder icons. */
function isLikelyFolder(path: string, name: string): boolean {
  if (!path && !name) return false;
  if (path?.endsWith("/")) return true;
  if (name && !name.includes(".")) return true;
  const folderNames = new Set([
    "node_modules",
    "src",
    "lib",
    "dist",
    "build",
    "public",
    "assets",
    "components",
    "hooks",
    "utils",
    "types",
    "styles",
    "pages",
    "features",
    "api",
    "store",
    "config",
    "tests",
    "__tests__",
    "__mocks__",
    ".git",
    ".vscode",
    ".idea",
  ]);
  const lower = (name || path?.split("/").pop() || "").toLowerCase();
  return folderNames.has(lower);
}

export interface ComposerPillProps {
  attrs: ComposerPillAttrs;
  /** Called when the user clicks the X icon to remove the pill */
  onDelete: () => void;
}

const ComposerPill: React.FC<ComposerPillProps> = ({ attrs, onDelete }) => {
  const {
    filePath,
    fileName,
    isFolder: isFolderAttr,
    iconType,
    lineStart,
    lineEnd,
  } = attrs;

  const [isHovered, setIsHovered] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewPosition, setPreviewPosition] = useState({ left: 0, top: 0 });

  const pillRef = useRef<HTMLSpanElement>(null);
  const showTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lineRangeDisplay = useMemo(() => {
    if (lineStart != null && lineEnd != null)
      return `(${lineStart}-${lineEnd})`;
    if (lineStart != null) return `(${lineStart})`;
    return null;
  }, [lineStart, lineEnd]);

  const isFolder = useMemo(() => {
    if (iconType && iconType !== "folder") return false;
    if (iconType === "folder") return true;
    if (isFolderAttr === true) return true;
    return isLikelyFolder(filePath, fileName);
  }, [isFolderAttr, filePath, fileName, iconType]);

  const shouldShowTreePreview = useMemo(() => {
    return !iconType || iconType === "folder" || iconType === "file";
  }, [iconType]);

  const handleDelete = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onDelete();
    },
    [onDelete]
  );

  const handlePillMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
  }, []);

  const handlePillClick = useCallback(
    (event: React.MouseEvent) => {
      if ((event.target as HTMLElement).closest("svg")) return;

      if (iconType === "member") {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (iconType === "terminal") {
        event.preventDefault();
        event.stopPropagation();
        let sessionId: string;
        if (filePath.startsWith("terminal://")) {
          sessionId = filePath.replace("terminal://", "").split("/")[0];
        } else {
          sessionId = filePath;
        }
        const terminalText =
          window.__orgiiTerminalPillTexts?.[filePath] ?? undefined;
        document.dispatchEvent(
          new CustomEvent("terminal-pill-click", {
            detail: { sessionId, fileName, terminalText },
            bubbles: true,
          })
        );
        return;
      }

      document.dispatchEvent(
        new CustomEvent("file-pill-click", {
          detail: { filePath, fileName, lineStart, lineEnd, isFolder },
          bubbles: true,
        })
      );
    },
    [filePath, fileName, lineStart, lineEnd, isFolder, iconType]
  );

  const updatePreviewPosition = useCallback(() => {
    if (!pillRef.current) return;
    const rect = pillRef.current.getBoundingClientRect();
    setPreviewPosition({ left: rect.left, top: rect.top - 4 });
  }, []);

  const handleMouseEnter = useCallback(() => {
    setIsHovered(true);
    if (!shouldShowTreePreview) return;
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    showTimeoutRef.current = setTimeout(() => {
      updatePreviewPosition();
      setShowPreview(true);
    }, PREVIEW_SHOW_DELAY);
  }, [shouldShowTreePreview, updatePreviewPosition]);

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
    if (showTimeoutRef.current) {
      clearTimeout(showTimeoutRef.current);
      showTimeoutRef.current = null;
    }
    hideTimeoutRef.current = setTimeout(() => {
      setShowPreview(false);
    }, PREVIEW_HIDE_DELAY);
  }, []);

  const handlePreviewMouseEnter = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  const handlePreviewMouseLeave = useCallback(() => {
    hideTimeoutRef.current = setTimeout(() => {
      setShowPreview(false);
    }, PREVIEW_HIDE_DELAY);
  }, []);

  useEffect(() => {
    return () => {
      if (showTimeoutRef.current) clearTimeout(showTimeoutRef.current);
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, []);

  const iconNode = (() => {
    if (isHovered) {
      return (
        <X
          size={PILL_SIZE.iconSize}
          strokeWidth={2}
          onClick={handleDelete}
          style={{ cursor: "pointer", color: "var(--color-text-3)" }}
        />
      );
    }
    switch (iconType as PillIconType | null) {
      case "repo":
        return <Code {...ICON_PROPS} />;
      case "branch":
        return <GitBranch {...ICON_PROPS} />;
      case "terminal":
        return <Terminal {...ICON_PROPS} />;
      case "session":
        return <MessageSquare {...ICON_PROPS} />;
      case "browser":
        return <Globe {...ICON_PROPS} />;
      case "project":
        return <FolderKanban {...ICON_PROPS} />;
      case "workitem":
        return <ListChecks {...ICON_PROPS} />;
      case "dom-element":
        return <SquareMousePointer {...ICON_PROPS} />;
      case "skill":
        return <Toolbox {...ICON_PROPS} />;
      case "member":
        return <AtSign {...ICON_PROPS} />;
      default:
        return (
          <FileTypeIcon
            fileName={isFolder ? filePath || fileName : fileName || filePath}
            type={isFolder ? "folder" : undefined}
            size="small"
          />
        );
    }
  })();

  return (
    <>
      <BasePill
        variant="editor"
        iconNode={iconNode}
        pillRef={pillRef}
        className="composer-pill"
        style={{
          userSelect: "none",
          WebkitUserSelect: "none",
          cursor: "pointer",
          backgroundColor: "transparent",
          outline: "none",
        }}
        onClick={handlePillClick}
        onMouseDown={handlePillMouseDown}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <span>{fileName}</span>
        {lineRangeDisplay && (
          <span style={{ color: "var(--color-text-3)", fontSize: "12px" }}>
            {lineRangeDisplay}
          </span>
        )}
      </BasePill>

      {showPreview &&
        shouldShowTreePreview &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: previewPosition.left,
              top: previewPosition.top,
              transform: "translateY(-100%)",
              zIndex: 9999,
            }}
            onMouseEnter={handlePreviewMouseEnter}
            onMouseLeave={handlePreviewMouseLeave}
          >
            <FileTreePreview
              path={filePath}
              itemType={isFolder ? "folder" : "file"}
              width="auto"
            />
          </div>,
          document.body
        )}
    </>
  );
};

export default ComposerPill;
