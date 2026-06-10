/**
 * DomComponentPreviewContent
 *
 * Renders the JSON captured from a `dom-element` paste pill (e.g. by the
 * Cursor / browser-extension element-picker). Two view modes:
 *
 * - Raw: the JSON text (read-only Monaco viewer)
 * - Preview: a sandboxed iframe that renders the captured component. We
 *   try to *clone the live host element* via the recorded `cssSelector`
 *   so children, text, and inline styles are mirrored 1:1. When that
 *   lookup fails (route changed, element unmounted), we fall back to an
 *   empty shell sized to `dimensions.width × height` with just the
 *   `className` applied.
 *
 * Either way we inline the main window's stylesheets into the iframe so
 * Tailwind utilities and CSS custom properties resolve identically. The
 * iframe inherits whatever theme the host window has loaded.
 *
 * Preview chrome: a meta strip on top (component name / dimensions / DOM
 * depth / url).
 */
import React, { Suspense, memo, useMemo, useState } from "react";

import { FileHeader } from "@src/modules/WorkStation/shared";
import type { ToggleOption } from "@src/modules/shared/components/FileHeader";
import { Placeholder } from "@src/modules/shared/layouts/blocks";

const CodeViewerContent = React.lazy(() => import("../CodeViewerContent"));

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface DomComponentPreviewContentProps {
  fileName: string;
  jsonText: string;
}

type ViewMode = "raw" | "preview";

interface ParsedDomComponent {
  cssSelector?: string;
  dimensions?: { width?: number; height?: number };
  reactComponent?: { name?: string; fiber?: string };
  domPath?: string[];
  meta?: {
    url?: string;
    timestamp?: string;
    viewport?: { width?: number; height?: number };
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 80;
const PREVIEW_PADDING = 32;
const CHECKERBOARD =
  "repeating-conic-gradient(var(--color-bg-2, #1f1f1f) 0% 25%, var(--color-bg-1, #141414) 0% 50%) 50% / 16px 16px";

const TOGGLE_OPTIONS: readonly ToggleOption[] = [
  { value: "raw", label: "Raw" },
  { value: "preview", label: "Preview" },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Parsing helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseDomJson(jsonText: string): ParsedDomComponent | null {
  try {
    return JSON.parse(jsonText) as ParsedDomComponent;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML escaping
// ─────────────────────────────────────────────────────────────────────────────

const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ENTITIES[ch] ?? ch);
}

// ─────────────────────────────────────────────────────────────────────────────
// Host element cloning
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Locate the captured element in the live host document via the recorded CSS
 * selector. Strict full-selector match only — trimming the leading ancestors
 * would silently match a *different* component that happens to share the
 * trailing class chain, producing a misleading "preview" of an unrelated
 * element.
 */
function findHostElement(cssSelector: string | undefined): Element | null {
  if (!cssSelector) return null;
  try {
    return document.querySelector(cssSelector);
  } catch {
    return null;
  }
}

/**
 * Clone a host element to standalone HTML for iframe srcdoc injection.
 * Strips `id` attributes (own + descendant) to avoid duplicate-id warnings;
 * everything else (class, style, data-*, children, text) is preserved.
 */
function serializeClonedElement(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.removeAttribute("id");
  clone.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
  return clone.outerHTML;
}

// ─────────────────────────────────────────────────────────────────────────────
// Host CSS (module-scoped lazy cache)
//
// Each host stylesheet maps to one of two iframe entries:
//   • External `<link rel="stylesheet">` → re-emitted as a `<link>` in the
//     iframe. We can't reliably read `sheet.cssRules` on production builds
//     (MiniCssExtractPlugin emits separate CSS files that WebKit treats as
//     non-readable from JS in some Tauri configurations) — but a `<link>`
//     with the same same-origin URL loads and parses normally inside the
//     iframe.
//   • Inline `<style>` (dev `style-loader`, runtime injected) → has no `href`,
//     so we serialize its `cssRules` into a single `<style>` block.
//
// The set of stylesheets is stable for the lifetime of the window, so we
// compute the head fragment on first use and reuse it for every preview tab.
// ─────────────────────────────────────────────────────────────────────────────

let cachedHostStyleHead: string | null = null;

function getHostStyleHead(): string {
  if (cachedHostStyleHead !== null) return cachedHostStyleHead;
  const parts: string[] = [];
  const inlineChunks: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    if (sheet.href) {
      parts.push(`<link rel="stylesheet" href="${escapeHtml(sheet.href)}" />`);
      continue;
    }
    try {
      const rules = sheet.cssRules;
      if (!rules) continue;
      for (const rule of Array.from(rules)) {
        inlineChunks.push(rule.cssText);
      }
    } catch {
      // Inline stylesheet became unreadable for some reason — skip silently.
    }
  }
  if (inlineChunks.length > 0) {
    parts.push(`<style>${inlineChunks.join("\n")}</style>`);
  }
  cachedHostStyleHead = parts.join("\n");
  return cachedHostStyleHead;
}

// ─────────────────────────────────────────────────────────────────────────────
// srcDoc builder
// ─────────────────────────────────────────────────────────────────────────────

interface BuildSrcDocInput {
  innerHtml: string;
  baseHref: string;
  width: number;
  height: number;
}

function buildSrcDoc({
  innerHtml,
  baseHref,
  width,
  height,
}: BuildSrcDocInput): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<base href="${escapeHtml(baseHref)}" />
${getHostStyleHead()}
<style>
  html, body { margin: 0; padding: 0; background: transparent; color: inherit; }
  body {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: ${PREVIEW_PADDING}px;
    box-sizing: border-box;
  }
  .__preview-host {
    width: ${width}px;
    height: ${height}px;
    box-sizing: border-box;
    position: relative;
    overflow: visible;
  }
  /* Element-picker capture often pins width/flex on the captured element via
     surrounding flex layout. Force it to fill the host so the rendered
     dimensions match the requested preview size. */
  .__preview-host > * {
    width: 100% !important;
    height: 100% !important;
    flex: none !important;
    max-width: none !important;
    max-height: none !important;
  }
</style>
</head>
<body>
  <div class="__preview-host">${innerHtml}</div>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PreviewFrame
// ─────────────────────────────────────────────────────────────────────────────

interface PreviewFrameProps {
  parsed: ParsedDomComponent;
  width: number;
  height: number;
}

const PreviewFrame: React.FC<PreviewFrameProps> = memo(
  ({ parsed, width, height }) => {
    const srcDoc = useMemo(() => {
      const el = findHostElement(parsed.cssSelector);
      if (!el) return null;
      const innerHtml = serializeClonedElement(el);
      return buildSrcDoc({
        innerHtml,
        baseHref: parsed.meta?.url ?? window.location.href,
        width,
        height,
      });
    }, [parsed.cssSelector, parsed.meta?.url, width, height]);

    if (!srcDoc) {
      return (
        <Placeholder
          variant="empty"
          placement="detail-panel"
          title="Captured element is no longer mounted"
          subtitle="Re-capture the component on the live page to refresh this preview, or switch to Raw to inspect the JSON."
          fillParentHeight
        />
      );
    }

    return (
      <iframe
        title="DOM component preview"
        sandbox="allow-same-origin"
        srcDoc={srcDoc}
        style={{
          width: "100%",
          height: "100%",
          border: "none",
          background: CHECKERBOARD,
        }}
      />
    );
  }
);
PreviewFrame.displayName = "PreviewFrame";

// ─────────────────────────────────────────────────────────────────────────────
// MetaStrip
// ─────────────────────────────────────────────────────────────────────────────

interface MetaStripProps {
  componentName: string;
  width: number;
  height: number;
  domDepth: number;
  url: string | undefined;
}

const MetaStrip: React.FC<MetaStripProps> = memo(
  ({ componentName, width, height, domDepth, url }) => (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-0 border-b border-solid border-border-2 px-3 py-2 text-[11px] text-text-3">
      <span className="font-medium text-text-2">{componentName}</span>
      <span>
        {width} × {height} px
      </span>
      <span>DOM depth {domDepth}</span>
      {url && (
        <span className="truncate" title={url}>
          {url}
        </span>
      )}
    </div>
  )
);
MetaStrip.displayName = "MetaStrip";

// ─────────────────────────────────────────────────────────────────────────────
// Body renderers (one per view mode)
// ─────────────────────────────────────────────────────────────────────────────

const RawBody: React.FC<{ fileName: string; jsonText: string }> = ({
  fileName,
  jsonText,
}) => (
  <Suspense
    fallback={
      <Placeholder
        variant="loading"
        placement="detail-panel"
        fillParentHeight
      />
    }
  >
    <CodeViewerContent
      selectedFile={fileName}
      fileContent={jsonText}
      loading={false}
      error={null}
      repoPath=""
      readOnly
    />
  </Suspense>
);

const PreviewBody: React.FC<{ parsed: ParsedDomComponent }> = ({ parsed }) => {
  const width = parsed.dimensions?.width ?? DEFAULT_WIDTH;
  const height = parsed.dimensions?.height ?? DEFAULT_HEIGHT;
  const componentName = parsed.reactComponent?.name ?? "Unknown";
  const domDepth = parsed.domPath?.length ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MetaStrip
        componentName={componentName}
        width={width}
        height={height}
        domDepth={domDepth}
        url={parsed.meta?.url}
      />
      <div className="min-h-0 flex-1">
        <PreviewFrame parsed={parsed} width={width} height={height} />
      </div>
    </div>
  );
};

const UnparsableBody: React.FC = () => (
  <Placeholder
    variant="empty"
    placement="detail-panel"
    title="Could not parse JSON"
    subtitle="Switch to Raw to inspect the source."
    fillParentHeight
  />
);

// ─────────────────────────────────────────────────────────────────────────────
// Root
// ─────────────────────────────────────────────────────────────────────────────

const DomComponentPreviewContent: React.FC<DomComponentPreviewContentProps> =
  memo(({ fileName, jsonText }) => {
    const [viewMode, setViewMode] = useState<ViewMode>("preview");
    const parsed = useMemo(() => parseDomJson(jsonText), [jsonText]);

    const handleToggleChange = (value: string) =>
      setViewMode(value as ViewMode);

    let body: React.ReactNode;
    if (viewMode === "raw") {
      body = <RawBody fileName={fileName} jsonText={jsonText} />;
    } else if (parsed) {
      body = <PreviewBody parsed={parsed} />;
    } else {
      body = <UnparsableBody />;
    }

    return (
      <div className="flex h-full flex-col">
        <FileHeader
          filePath={fileName}
          plainTitle
          disableNavigation
          toggleOptions={TOGGLE_OPTIONS as ToggleOption[]}
          toggleValue={viewMode}
          onToggleChange={handleToggleChange}
        />
        {body}
      </div>
    );
  });

DomComponentPreviewContent.displayName = "DomComponentPreviewContent";

export default DomComponentPreviewContent;
