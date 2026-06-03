/**
 * UserMessageContent
 *
 * Renders user message text with inline file/repo/branch pills.
 * Parses the serialized pill format: `displayName [type:path]`
 * produced by TiptapInput.getTextWithPills().
 */
import {
  Code,
  Folder,
  FolderKanban,
  GitBranch,
  Globe,
  ListChecks,
  MessageSquare,
  SquareMousePointer,
  Terminal,
  Toolbox,
} from "lucide-react";
import React, { memo, useCallback, useMemo } from "react";

import { ChatImageThumbnailRow } from "@src/components/ChatImageThumbnail";
import BasePill from "@src/components/ComposerInput/BasePill";
import FileTypeIcon from "@src/components/FileTypeIcon";
import {
  PILL_LINE_HEIGHT,
  PILL_REGEX,
  PILL_SIZE,
  PILL_TYPES,
} from "@src/config/pillTokens";
import type { PillType } from "@src/config/pillTokens";

// ============================================
// Types
// ============================================

interface PillSegment {
  kind: "pill";
  displayName: string;
  pillType: PillType;
  path: string;
  /** Decoded terminal content embedded in the serialized pill (base64) */
  terminalText?: string;
}

interface TextSegment {
  kind: "text";
  text: string;
}

type Segment = PillSegment | TextSegment;

// ============================================
// Parser
// ============================================

/**
 * Extract the first fenced code block from text.
 * Returns the content between ``` markers, or undefined if none found.
 */
function extractCodeBlock(text: string): string | undefined {
  const match = text.match(/```\n?([\s\S]*?)```/);
  return match?.[1]?.trim() || undefined;
}

function parseUserMessage(text: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;

  // Pre-extract code block for terminal pills that lack embedded content
  const codeBlockContent = extractCodeBlock(text);

  for (const match of text.matchAll(PILL_REGEX)) {
    const matchStart = match.index;
    if (matchStart === undefined) continue;

    // Text before this pill
    if (matchStart > lastIndex) {
      segments.push({ kind: "text", text: text.slice(lastIndex, matchStart) });
    }

    const displayName = match[1].trim();
    const pillType = match[2] as PillType;
    const rawPath = match[3];

    if (PILL_TYPES.has(pillType)) {
      // Context pills (terminal, session, browser) may embed base64 content
      // after "::" or have a code block fallback in the same message
      const isContextPill =
        pillType === "terminal" ||
        pillType === "session" ||
        pillType === "browser" ||
        pillType === "dom-element";
      let path = rawPath;
      let terminalText: string | undefined;
      if (isContextPill) {
        if (rawPath.includes("::")) {
          const sepIdx = rawPath.indexOf("::");
          path = rawPath.slice(0, sepIdx);
          const encoded = rawPath.slice(sepIdx + 2);
          try {
            terminalText = decodeURIComponent(atob(encoded));
          } catch {
            // Malformed base64 — ignore
          }
        }
        if (pillType === "terminal" && !terminalText && codeBlockContent) {
          terminalText = codeBlockContent;
        }
      }
      segments.push({
        kind: "pill",
        displayName,
        pillType,
        path,
        terminalText,
      });
    } else {
      // Unknown type — keep as text
      segments.push({ kind: "text", text: match[0] });
    }

    lastIndex = matchStart + match[0].length;
  }

  // Check if any context pill (terminal/session/browser) consumed the code block
  const hasContextPill = segments.some(
    (s) =>
      s.kind === "pill" &&
      (s.pillType === "terminal" ||
        s.pillType === "session" ||
        s.pillType === "browser")
  );

  // Strip trailing code blocks — they carry embedded context, not user text
  if (lastIndex < text.length) {
    let remaining = text.slice(lastIndex);
    if (hasContextPill && codeBlockContent) {
      remaining = remaining.replace(/\n*```\n?[\s\S]*?```\s*$/, "");
    }
    if (remaining) {
      segments.push({ kind: "text", text: remaining });
    }
  }

  return segments;
}

// ============================================
// Pill Icon
// ============================================

const ICON_PROPS = { size: PILL_SIZE.iconSize, strokeWidth: 1.75 } as const;

const PillIcon: React.FC<{ pillType: PillType; displayName: string }> = memo(
  ({ pillType, displayName }) => {
    switch (pillType) {
      case "repo":
        return <Code {...ICON_PROPS} className="text-text-2" />;
      case "folder":
        return <Folder {...ICON_PROPS} className="text-text-2" />;
      case "branch":
        return <GitBranch {...ICON_PROPS} className="text-text-2" />;
      case "terminal":
        return <Terminal {...ICON_PROPS} className="text-text-2" />;
      case "session":
        return <MessageSquare {...ICON_PROPS} className="text-text-2" />;
      case "browser":
        return <Globe {...ICON_PROPS} className="text-text-2" />;
      case "dom-element":
        return <SquareMousePointer {...ICON_PROPS} className="text-text-2" />;
      case "project":
        return <FolderKanban {...ICON_PROPS} className="text-text-2" />;
      case "workitem":
        return <ListChecks {...ICON_PROPS} className="text-text-2" />;
      case "skill":
        return <Toolbox {...ICON_PROPS} className="text-text-2" />;
      default:
        return <FileTypeIcon fileName={displayName} size="small" />;
    }
  }
);
PillIcon.displayName = "PillIcon";

// ============================================
// Inline Pill (read-only, clickable)
// ============================================

const InlinePill: React.FC<{ segment: PillSegment }> = memo(({ segment }) => {
  const isClickable =
    segment.pillType === "terminal" ||
    segment.pillType === "file" ||
    segment.pillType === "folder";

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();

      if (segment.pillType === "terminal") {
        let sessionId: string;
        if (segment.path.startsWith("terminal://")) {
          const parts = segment.path.replace("terminal://", "").split("/");
          sessionId = parts[0];
        } else {
          sessionId = segment.path;
        }

        const terminalText =
          segment.terminalText ??
          window.__orgiiTerminalPillTexts?.[segment.path] ??
          undefined;

        document.dispatchEvent(
          new CustomEvent("terminal-pill-click", {
            detail: {
              sessionId,
              fileName: segment.displayName,
              terminalText,
            },
          })
        );
        return;
      }

      if (segment.pillType === "file" || segment.pillType === "folder") {
        document.dispatchEvent(
          new CustomEvent("file-pill-click", {
            detail: {
              filePath: segment.path,
              fileName: segment.displayName,
              isFolder: segment.pillType === "folder",
            },
          })
        );
      }
    },
    [segment]
  );

  /** Prevent mousedown from triggering text-selection or parent click */
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (isClickable) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    [isClickable]
  );

  return (
    <BasePill
      variant="editor"
      iconNode={
        <PillIcon
          pillType={segment.pillType}
          displayName={segment.displayName}
        />
      }
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      style={{
        cursor: isClickable ? "pointer" : "default",
        position: "relative",
        zIndex: 1,
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
      onClick={isClickable ? handleClick : undefined}
      onMouseDown={handleMouseDown}
    >
      <span>{segment.displayName}</span>
    </BasePill>
  );
});
InlinePill.displayName = "InlinePill";

// ============================================
// Main Component
// ============================================

interface UserMessageContentProps {
  text: string;
  /** Optional image URLs (data URLs or Tauri asset URLs) attached to this message */
  images?: string[];
}

const TEXT_BASE_CLASS =
  "whitespace-pre-wrap break-words text-[14px] leading-relaxed text-text-1";

const UserMessageContent: React.FC<UserMessageContentProps> = memo(
  ({ text, images }) => {
    const segments = useMemo(() => parseUserMessage(text), [text]);
    const hasImages = images && images.length > 0;

    // Fast path: no pills and no images, render plain text
    const hasPills = segments.some((s) => s.kind === "pill");
    if (!hasPills && !hasImages) {
      return <span className={TEXT_BASE_CLASS}>{text}</span>;
    }

    return (
      <div className="flex flex-col gap-2">
        {hasImages && <ChatImageThumbnailRow images={images} />}
        {text && text !== "(image)" && (
          <span
            className="whitespace-pre-wrap break-words text-[14px] text-text-1"
            style={{ lineHeight: PILL_LINE_HEIGHT }}
          >
            {segments.map((segment, idx) =>
              segment.kind === "text" ? (
                <React.Fragment key={idx}>{segment.text}</React.Fragment>
              ) : (
                <InlinePill key={idx} segment={segment} />
              )
            )}
          </span>
        )}
      </div>
    );
  }
);
UserMessageContent.displayName = "UserMessageContent";

export default UserMessageContent;
