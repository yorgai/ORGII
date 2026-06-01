/**
 * SimCodeBlock - Dark/light terminal-style code display for simulator rendering.
 *
 * Distinct from the full `blocks/CodeBlock/` component (which is a CodeMirror-
 * powered chat block). This is a lightweight styled pre-block used by
 * simulator-variant renderers (mcp, tool-call) to show JSON args/results.
 */
import { ReactNode, memo, useMemo } from "react";

import { SESSION_UI_TOKENS } from "./config";

const FONT_MONO = "var(--code-font-family)";

export interface SimCodeBlockProps {
  children: ReactNode;
  minHeight?: string;
  variant?: "dark" | "light" | "diff";
  title?: string;
  language?: string;
  showLineNumbers?: boolean;
}

export const SimCodeBlock = memo<SimCodeBlockProps>(
  ({
    children,
    minHeight = "100px",
    variant = "dark",
    title,
    language,
    showLineNumbers = false,
  }) => {
    const containerClass = useMemo(
      () =>
        `flex-1 overflow-hidden rounded-lg ${
          variant === "dark" || variant === "diff"
            ? "border border-border-1"
            : "border border-border-1 bg-fill-1"
        }`,
      [variant]
    );

    const headerClass =
      "flex select-none items-center justify-between px-4 py-2 border-b border-border-1 bg-event-block/50";

    const codeClass = useMemo(
      () =>
        `overflow-auto p-4 text-[13px] leading-relaxed ${
          showLineNumbers ? "pl-12" : ""
        } text-text-1`,
      [showLineNumbers]
    );

    const style = useMemo(
      () => ({ minHeight, fontFamily: FONT_MONO }),
      [minHeight]
    );

    return (
      <div className={containerClass}>
        {(title || language) && (
          <div className={headerClass}>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-full bg-danger-6" />
                <span className="h-3 w-3 rounded-full bg-warning-6" />
                <span className="h-3 w-3 rounded-full bg-success-6" />
              </div>
              {title && (
                <span
                  className={`ml-2 ${SESSION_UI_TOKENS.FONT_SIZE_SM} font-medium ${SESSION_UI_TOKENS.TEXT.TERTIARY}`}
                >
                  {title}
                </span>
              )}
            </div>
            {language && (
              <span
                className={`rounded bg-event-block px-2 py-0.5 ${SESSION_UI_TOKENS.FONT_SIZE_XS} font-medium uppercase ${SESSION_UI_TOKENS.TEXT.TERTIARY}`}
              >
                {language}
              </span>
            )}
          </div>
        )}
        <div className={codeClass} style={style}>
          {children}
        </div>
      </div>
    );
  },
  (prev, next) => {
    if (prev.minHeight !== next.minHeight) return false;
    if (prev.variant !== next.variant) return false;
    if (prev.title !== next.title) return false;
    if (prev.language !== next.language) return false;
    if (prev.showLineNumbers !== next.showLineNumbers) return false;
    if (prev.children !== next.children) return false;
    return true;
  }
);
SimCodeBlock.displayName = "SimCodeBlock";

export default SimCodeBlock;
