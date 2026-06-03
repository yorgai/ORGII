/**
 * Markdown Component (Implementation)
 *
 * Renders markdown content with syntax highlighting.
 *
 * Performance optimizations:
 * - Memoized component to prevent re-parsing unchanged content
 * - Static style objects moved outside component
 * - Memoized theme selection
 * - Custom comparison based on textContent
 *
 * NOTE: This file is lazy-loaded via index.tsx to avoid pulling ~700KB of
 * react-markdown + react-syntax-highlighter into the initial bundle.
 */
import { useAtomValue } from "jotai";
import React, { memo, useCallback, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { Prism as SyntaxHighlighterPrism } from "react-syntax-highlighter";
import {
  oneDark,
  oneLight,
} from "react-syntax-highlighter/dist/esm/styles/prism";
import remarkGfm from "remark-gfm";

import { isThemeCssPathDark } from "@src/config/appearance/globalThemes";
import { getLanguageFromPath } from "@src/config/languageMap";
import CanvasInlineCard from "@src/engines/ChatPanel/blocks/CanvasInlineCard";
import ChatCodeBlock from "@src/engines/ChatPanel/blocks/CodeBlock";
import { themesAtom } from "@src/store";

import MermaidBlock from "./MermaidBlock";
import "./index.scss";
import {
  detectCodeType,
  openFileInEditor,
  openUrlInBrowserApp,
  preprocessTextContent,
  renderChildren,
} from "./markdownUtils";

const SyntaxHighlighter =
  SyntaxHighlighterPrism as unknown as React.ComponentType<
    Record<string, unknown>
  >;

/**
 * Fenced language aliases that trigger CanvasInlineCard instead of a code
 * block. The agent writes ```canvas or ```preview with a JSON payload.
 *
 * Payload schema (JSON on a single line or pretty-printed):
 *   { "mode": "html"|"url"|"a2ui", "content"?: "...", "url"?: "...", "title"?: "..." }
 */
const CANVAS_FENCED_LANGUAGES = new Set([
  "canvas",
  "preview",
  "canvas-html",
  "canvas-url",
  "canvas-a2ui",
]);

type CanvasFencedMode = "html" | "url" | "a2ui";

function isCanvasFencedMode(value: unknown): value is CanvasFencedMode {
  return value === "html" || value === "url" || value === "a2ui";
}

/**
 * Fenced languages whose title bar adds little value next to the snippet itself.
 * File-backed code references still keep their header because `filePath` is set.
 */
const CHAT_CODE_BLOCK_HIDE_HEADER_LANGUAGES = new Set([
  "bash",
  "fish",
  "plaintext",
  "powershell",
  "ps1",
  "sh",
  "shell",
  "text",
  "txt",
  "zsh",
]);

interface CodeFenceMeta {
  language: string;
  filePath?: string;
  title?: string;
  startLine?: string;
  endLine?: string;
}

function parseCodeFenceMeta(rawInfo: string): CodeFenceMeta {
  const referenceMatch = rawInfo.match(/^(\d+):(\d+):(.+)$/);
  if (referenceMatch) {
    const startLine = referenceMatch[1];
    const endLine = referenceMatch[2];
    const filePath = referenceMatch[3];
    const fileName = filePath.split("/").pop() || filePath;
    return {
      language: getLanguageFromPath(filePath, "text") || "text",
      filePath,
      title: fileName,
      startLine,
      endLine,
    };
  }

  return { language: rawInfo || "text" };
}

// ============================================
// Types
// ============================================

export interface MarkdownProps {
  textContent: string;
  darkMode?: boolean;
  onEditorScroll?: (scrollTop: number) => void;
  researchMode?: boolean;
  /** Use ChatCodeBlock component for code blocks (collapsible, scrollable) */
  useChatCodeBlock?: boolean;
  /** Container width for ChatCodeBlock (for diff view) */
  codeBlockContainerWidth?: number;
  /** Enable clicking on inline code to open files in editor */
  enableFileNavigation?: boolean;
  /**
   * Skip the heavyweight preprocessTextContent pass (code auto-detection regexes).
   * Set to true when content is already well-formatted markdown (e.g., agent output
   * that arrives after streaming completes — the text was already sanitized on the
   * streaming path).
   */
  skipPreprocess?: boolean;
}

// ============================================
// Static Styles (moved outside component for performance)
// ============================================

const THEME_STYLES = {
  dark: oneDark,
  light: oneLight,
} as const;

const CODE_CUSTOM_STYLE: React.CSSProperties = {
  fontFamily: "var(--code-font-family)",
  fontSize: "12px",
  lineHeight: "1.6",
  margin: 0,
  padding: "12px 14px",
  borderRadius: "8px",
  background: "transparent",
};

const CODE_WRAPPER_STYLE: React.CSSProperties = {
  border: "none",
  borderRadius: "8px",
  margin: "8px 0",
};

// Just use the theme styles directly
const COMBINED_STYLE_DARK = THEME_STYLES.dark;
const COMBINED_STYLE_LIGHT = THEME_STYLES.light;

// ============================================
// Memoized Code Block Component
// ============================================

interface CodeBlockProps {
  children: string;
  language: string;
  isDarkMode: boolean;
}

const CodeBlock = memo<CodeBlockProps>(
  ({ children, language, isDarkMode }) => (
    <div className="code-block-wrapper" style={CODE_WRAPPER_STYLE}>
      <SyntaxHighlighter
        customStyle={CODE_CUSTOM_STYLE}
        style={isDarkMode ? COMBINED_STYLE_DARK : COMBINED_STYLE_LIGHT}
        language={language}
        PreTag="div"
        showLineNumbers={false}
        wrapLongLines
        wrapLines={true}
      >
        {children}
      </SyntaxHighlighter>
    </div>
  ),
  (prev, next) =>
    prev.children === next.children &&
    prev.language === next.language &&
    prev.isDarkMode === next.isDarkMode
);
CodeBlock.displayName = "CodeBlock";

// ============================================
// Main Component
// ============================================

const MarkdownComponent: React.FC<MarkdownProps> = ({
  textContent,
  darkMode,
  researchMode,
  useChatCodeBlock = false,
  codeBlockContainerWidth,
  enableFileNavigation = false,
  skipPreprocess = false,
}) => {
  const themes = useAtomValue(themesAtom);

  const handleLinkClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
      event.preventDefault();
      event.stopPropagation();
      openUrlInBrowserApp(href);
    },
    []
  );

  // Memoize dark mode calculation
  const isDarkMode = useMemo(() => {
    if (darkMode !== undefined) return darkMode;
    return isThemeCssPathDark(themes);
  }, [themes, darkMode]);

  // Types for ReactMarkdown custom components
  interface CodeElementProps {
    className?: string;
    children?: React.ReactNode;
  }

  // Memoize components object to prevent recreation
  const markdownComponents = useMemo((): Components => {
    const baseComponents: Components = {
      pre({ children, ...props }) {
        if (
          React.isValidElement(children) &&
          typeof (children as React.ReactElement<CodeElementProps>).props
            .className === "string" &&
          (
            children as React.ReactElement<CodeElementProps>
          ).props.className?.includes("language-")
        ) {
          const childProps = (children as React.ReactElement<CodeElementProps>)
            .props;
          const codeContent = String(childProps.children).replace(/\n$/, "");
          const match = /(?:^|\s)language-([^\s]+)/.exec(
            childProps.className || ""
          );
          const fenceMeta = parseCodeFenceMeta(match ? match[1] : "text");
          const { language } = fenceMeta;
          const lineSubtitle = fenceMeta.startLine
            ? fenceMeta.startLine === fenceMeta.endLine
              ? fenceMeta.startLine
              : `${fenceMeta.startLine}-${fenceMeta.endLine}`
            : undefined;

          if (language === "mermaid") {
            return <MermaidBlock code={codeContent} isDarkMode={isDarkMode} />;
          }

          // Canvas / preview fenced blocks — render as CanvasInlineCard
          if (CANVAS_FENCED_LANGUAGES.has(language.toLowerCase())) {
            let mode: CanvasFencedMode = "html";
            let cardContent: string | undefined;
            let cardUrl: string | undefined;
            let cardTitle: string | undefined;

            // Derive mode from language alias shortcuts (canvas-url, canvas-a2ui)
            if (language === "canvas-url") mode = "url";
            else if (language === "canvas-a2ui") mode = "a2ui";

            // Try to parse the body as a JSON payload
            const trimmed = codeContent.trim();
            if (trimmed.startsWith("{")) {
              try {
                const parsed = JSON.parse(trimmed) as Record<string, unknown>;
                // isCanvasFencedMode guards against unknown mode strings
                if (isCanvasFencedMode(parsed.mode)) mode = parsed.mode;
                if (typeof parsed.content === "string")
                  cardContent = parsed.content;
                if (typeof parsed.url === "string") cardUrl = parsed.url;
                if (typeof parsed.title === "string") cardTitle = parsed.title;
              } catch {
                // Not valid JSON — treat the raw content as HTML
                cardContent = codeContent;
              }
            } else {
              // Plain content — pass through as-is (HTML or A2UI JSONL)
              cardContent = codeContent;
            }

            return (
              <CanvasInlineCard
                mode={mode}
                content={cardContent}
                url={cardUrl}
                title={cardTitle}
              />
            );
          }

          // Use ChatCodeBlock if enabled
          if (useChatCodeBlock) {
            return (
              <div className="chat-markdown-fenced-block">
                <ChatCodeBlock
                  code={codeContent}
                  language={language}
                  filePath={fenceMeta.filePath}
                  title={fenceMeta.title}
                  subtitle={lineSubtitle}
                  maxHeight={300}
                  containerWidth={codeBlockContainerWidth}
                  showLineNumbers={true}
                  showLineCount={false}
                  hideHeader={
                    !fenceMeta.filePath &&
                    CHAT_CODE_BLOCK_HIDE_HEADER_LANGUAGES.has(
                      language.toLowerCase()
                    )
                  }
                />
              </div>
            );
          }

          return (
            <CodeBlock isDarkMode={isDarkMode} language={language}>
              {codeContent}
            </CodeBlock>
          );
        }
        return <pre {...props}>{children}</pre>;
      },
      code({ children, className, ...props }) {
        // Handle inline code (not in pre block)
        if (className?.includes("language-")) {
          // This is actually a code block, let pre handle it
          return (
            <code className={className} {...props}>
              {children}
            </code>
          );
        }

        // Check if file navigation is enabled and this looks like a file path
        if (enableFileNavigation) {
          const text = String(children);
          const codeType = detectCodeType(text);

          // Debug: log detection results
          if (codeType) {
            // Code type detected - proceeding with appropriate rendering
          }

          if (codeType === "file") {
            return (
              <code
                {...props}
                className="clickable-code file-path"
                title={undefined}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openFileInEditor(text, false);
                }}
              >
                {children}
              </code>
            );
          }

          if (codeType === "directory") {
            return (
              <code
                {...props}
                className="clickable-code directory-path"
                title={undefined}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openFileInEditor(text, true);
                }}
              >
                {children}
              </code>
            );
          }

          if (codeType === "identifier") {
            return (
              <code
                {...props}
                className="clickable-code identifier"
                title={`Search for ${text}`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  // For identifiers, we can search for them
                  openFileInEditor(text, false);
                }}
              >
                {children}
              </code>
            );
          }
        }

        // Regular inline code
        return <code {...props}>{children}</code>;
      },
      a({ children, href, ...props }) {
        const url = href ?? "";
        return (
          <a
            {...props}
            href={url}
            onClick={(event) => handleLinkClick(event, url)}
          >
            {children}
          </a>
        );
      },
      ul({ children, ...props }) {
        return <ul {...props}>{children}</ul>;
      },
      ol({ children, ...props }) {
        return <ol {...props}>{children}</ol>;
      },
      li({ children, ...props }) {
        return <li {...props}>{children}</li>;
      },
    };

    if (researchMode) {
      baseComponents.p = ({ children, ...props }) => (
        <p {...props}>{renderChildren(children)}</p>
      );
      baseComponents.li = ({ children, ...props }) => (
        <li {...props}>{renderChildren(children)}</li>
      );
    }

    return baseComponents;
  }, [
    isDarkMode,
    researchMode,
    useChatCodeBlock,
    codeBlockContainerWidth,
    enableFileNavigation,
    handleLinkClick,
  ]);

  // Memoize plugins array to prevent recreation
  const plugins = useMemo(() => [remarkGfm], []);

  // Preprocess text content to auto-detect and format code.
  // Skip the expensive regex pass when the caller guarantees the content is
  // already well-formed markdown (e.g., post-stream agent messages).
  const processedContent = useMemo(
    () => (skipPreprocess ? textContent : preprocessTextContent(textContent)),
    [textContent, skipPreprocess]
  );

  return (
    <ReactMarkdown
      className="chat-markdown-body"
      remarkPlugins={plugins}
      components={markdownComponents}
    >
      {processedContent}
    </ReactMarkdown>
  );
};

// ============================================
// Memoized Export
// ============================================

/**
 * Custom comparison - only re-render if content or mode changes
 */
const arePropsEqual = (prev: MarkdownProps, next: MarkdownProps): boolean => {
  if (prev.textContent !== next.textContent) return false;
  if (prev.darkMode !== next.darkMode) return false;
  if (prev.researchMode !== next.researchMode) return false;
  if (prev.useChatCodeBlock !== next.useChatCodeBlock) return false;
  if (prev.codeBlockContainerWidth !== next.codeBlockContainerWidth)
    return false;
  if (prev.enableFileNavigation !== next.enableFileNavigation) return false;
  if (prev.skipPreprocess !== next.skipPreprocess) return false;
  return true;
};

const Markdown = memo(MarkdownComponent, arePropsEqual);
Markdown.displayName = "Markdown";

export default Markdown;
