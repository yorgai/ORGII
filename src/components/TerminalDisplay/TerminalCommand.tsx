/**
 * TerminalCommand Component
 *
 * Shared primitive for displaying terminal commands with syntax highlighting.
 * Consolidates command display logic from:
 * - RunCommand
 * - TerminalBlock
 * - TerminalCommandView
 *
 * Features:
 * - Shiki syntax highlighting (shared hook with caching)
 * - Customizable prompt prefix
 * - Optional highlighting disable
 * - Consistent styling across all contexts
 * - Optional inline stop button (right-aligned)
 */
import { Square } from "lucide-react";
import React, { memo } from "react";

import { useShikiHighlight } from "@src/hooks/code";

export interface TerminalCommandStopAction {
  /** Tooltip for the stop button */
  tooltip?: string;
  /** Whether stop is in progress */
  isStopping?: boolean;
  /** Click handler */
  onClick: (event: React.MouseEvent) => void;
}

export interface TerminalCommandProps {
  /** Command string to display */
  command: string;
  /** Prompt prefix (default: "$") */
  prefix?: string;
  /** Enable Shiki syntax highlighting (default: true) */
  highlighted?: boolean;
  /**
   * Shiki color theme. Defaults to auto-detect based on dark/light mode
   * (one-dark-pro in dark mode, github-light in light mode).
   */
  shikiTheme?: string;
  /** Font size in px (default: 14) */
  fontSize?: number;
  /**
   * When true, keep the command on one line with a trailing ellipsis if it
   * overflows (narrow panels). Disables wrap; use where full command is in title.
   */
  singleLineEllipsis?: boolean;
  /** Optional stop action - shows a circular stop button at right end */
  stopAction?: TerminalCommandStopAction;
  /** Additional CSS class */
  className?: string;
  /** Additional styles */
  style?: React.CSSProperties;
}

/**
 * TerminalCommand - Displays a terminal command with syntax highlighting
 *
 * @example
 * ```tsx
 * <TerminalCommand command="npm install" />
 * <TerminalCommand command="ls -la" prefix=">" fontSize={13} />
 * <TerminalCommand command="echo hello" highlighted={false} />
 * <TerminalCommand
 *   command="npm run dev"
 *   stopAction={{ onClick: handleStop, tooltip: "Stop" }}
 * />
 * ```
 */
export const TerminalCommand: React.FC<TerminalCommandProps> = memo(
  ({
    command,
    prefix = "$",
    highlighted = true,
    shikiTheme,
    fontSize = 12,
    singleLineEllipsis = false,
    stopAction,
    className = "",
    style,
  }) => {
    const useHighlight = highlighted && !singleLineEllipsis;
    // Single-line ellipsis needs plain text; Shiki HTML breaks text-overflow.
    const highlightedHtml = useShikiHighlight(useHighlight ? command : "", {
      lang: "shellscript",
      theme: shikiTheme,
    });

    const rootClass = [
      "terminal-command",
      singleLineEllipsis ? "terminal-command--single-line-ellipsis" : "",
      stopAction ? "terminal-command--with-stop" : "",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div
        className={rootClass}
        style={{ fontSize: `${fontSize}px`, ...style }}
        title={singleLineEllipsis ? command : undefined}
      >
        <span className="terminal-command__prefix select-none">{prefix}</span>
        {useHighlight && highlightedHtml ? (
          <span
            className="terminal-command__text"
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        ) : (
          <span className="terminal-command__text">{command}</span>
        )}
        {stopAction && (
          <button
            onClick={stopAction.onClick}
            disabled={stopAction.isStopping}
            title={stopAction.tooltip}
            className="terminal-command__stop"
          >
            <Square size={10} fill="currentColor" strokeWidth={0} />
          </button>
        )}
      </div>
    );
  }
);

TerminalCommand.displayName = "TerminalCommand";
