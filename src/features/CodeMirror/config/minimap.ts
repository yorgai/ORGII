/**
 * CodeMirror Minimap Extension
 *
 * Canvas-based minimap renderer showing a scaled-down overview of the document.
 * Features:
 * - Canvas-based rendering for performance (no nested CodeMirror)
 * - Viewport indicator showing visible region
 * - Click to navigate
 * - Scroll synchronization
 * - Syntax-aware coloring
 *
 * Performance:
 * - updateViewport() is ALWAYS deferred to rAF so layout reads never
 *   run synchronously inside CM6's update() cycle (which would force
 *   the browser to resolve all pending DOM changes mid-update, causing
 *   scroll jitter in WebKit/WKWebView).
 * - Host height is cached via ResizeObserver to avoid getBoundingClientRect()
 *   on every scroll frame.
 * - Viewport indicator uses CSS transform (GPU-composited) instead of `top`.
 */
import { syntaxTree } from "@codemirror/language";
import { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import type { RefObject } from "react";

/** Line height in pixels for minimap rendering */
const MINIMAP_LINE_HEIGHT = 3;
/** Padding at top and bottom of minimap content */
const MINIMAP_PADDING = 4;

/**
 * Creates a minimap extension using a canvas-based renderer.
 * The minimap shows a scaled-down overview of the document with a viewport indicator.
 *
 * IMPORTANT: The minimap host element must be a SIBLING of the editor, not inside it.
 *
 * @param hostRef - Ref to the minimap host element
 */
export function minimapExtension(
  hostRef: RefObject<HTMLElement | null>
): Extension {
  return ViewPlugin.fromClass(
    class {
      host: HTMLElement | null = null;
      canvas: HTMLCanvasElement | null = null;
      viewport: HTMLDivElement | null = null;
      mainView: EditorView;
      initialized = false;
      clickHandler: ((event: MouseEvent) => void) | null = null;
      dragHandler: ((event: MouseEvent) => void) | null = null;
      dragEndHandler: (() => void) | null = null;
      scrollHandler: (() => void) | null = null;
      initRafId = 0;
      scrollRafId = 0;
      updateRafId = 0;
      destroyed = false;
      isDragging = false;
      cachedHostHeight = 0;
      resizeObserver: ResizeObserver | null = null;

      constructor(mainView: EditorView) {
        this.mainView = mainView;
        this.initRafId = requestAnimationFrame(() => this.tryInitialize());
      }

      tryInitialize() {
        if (this.destroyed || this.initialized) return;

        this.host = hostRef.current;
        if (!this.host) {
          this.initRafId = requestAnimationFrame(() => this.tryInitialize());
          return;
        }

        this.initialized = true;

        // Clear any existing elements (in case of reinitialization)
        const existingCanvas = this.host.querySelector(".minimap-canvas");
        const existingViewport = this.host.querySelector(".minimap-viewport");
        if (existingCanvas) existingCanvas.remove();
        if (existingViewport) existingViewport.remove();

        // Create canvas for code rendering
        this.canvas = document.createElement("canvas");
        this.canvas.className = "minimap-canvas";
        this.host.appendChild(this.canvas);

        // Create viewport indicator
        this.viewport = document.createElement("div");
        this.viewport.className = "minimap-viewport";
        this.host.appendChild(this.viewport);

        // Cache host height via ResizeObserver to avoid getBoundingClientRect
        this.cachedHostHeight = this.host.clientHeight;
        this.resizeObserver = new ResizeObserver((entries) => {
          for (const entry of entries) {
            this.cachedHostHeight = entry.contentRect.height;
          }
          this.scheduleViewportUpdate();
        });
        this.resizeObserver.observe(this.host);

        // Set up event handlers
        this.clickHandler = (event: MouseEvent) => this.handleClick(event);
        this.dragHandler = (event: MouseEvent) => this.handleDrag(event);
        this.dragEndHandler = () => this.handleDragEnd();

        this.host.addEventListener("mousedown", this.clickHandler);
        document.addEventListener("mousemove", this.dragHandler);
        document.addEventListener("mouseup", this.dragEndHandler);

        this.scrollHandler = () => {
          this.scheduleViewportUpdate();
        };
        this.mainView.scrollDOM.addEventListener("scroll", this.scrollHandler, {
          passive: true,
        });

        // Initial render
        this.renderMinimap();
        this.scheduleViewportUpdate();
      }

      scheduleViewportUpdate() {
        cancelAnimationFrame(this.scrollRafId);
        this.scrollRafId = requestAnimationFrame(() => this.updateViewport());
      }

      handleClick(event: MouseEvent) {
        if (!this.host) return;
        event.preventDefault();
        this.isDragging = true;
        this.navigateToPosition(event);
      }

      handleDrag(event: MouseEvent) {
        if (!this.isDragging) return;
        this.navigateToPosition(event);
      }

      handleDragEnd() {
        this.isDragging = false;
      }

      navigateToPosition(event: MouseEvent) {
        if (!this.host) return;

        const rect = this.host.getBoundingClientRect();
        const clickY = event.clientY - rect.top - MINIMAP_PADDING;
        const contentHeight = this.getContentHeight();

        if (contentHeight === 0) return;

        const totalLines = this.mainView.state.doc.lines;
        const clickRatio = Math.max(0, Math.min(1, clickY / contentHeight));
        const targetLine = Math.max(
          1,
          Math.min(totalLines, Math.round(clickRatio * totalLines))
        );

        const line = this.mainView.state.doc.line(targetLine);
        this.mainView.dispatch({
          effects: EditorView.scrollIntoView(line.from, { y: "center" }),
        });
      }

      getContentHeight(): number {
        const totalLines = this.mainView.state.doc.lines;
        return totalLines * MINIMAP_LINE_HEIGHT;
      }

      getSyntaxColors(): Record<string, string> {
        const tempEl = document.createElement("div");
        tempEl.style.backgroundColor = "var(--color-bg-1)";
        document.body.appendChild(tempEl);
        const bgColor = getComputedStyle(tempEl).backgroundColor;
        document.body.removeChild(tempEl);

        const rgbMatch = bgColor.match(/\d+/g);
        const isDark = rgbMatch
          ? (parseInt(rgbMatch[0]) +
              parseInt(rgbMatch[1]) +
              parseInt(rgbMatch[2])) /
              3 <
            128
          : false;

        if (isDark) {
          return {
            keyword: "#ff7b72",
            string: "#a5d6ff",
            comment: "#8b949e",
            number: "#79c0ff",
            function: "#d2a8ff",
            variable: "#ffa657",
            type: "#7ee787",
            operator: "#79c0ff",
            property: "#79c0ff",
            default: "#8b949e",
          };
        } else {
          return {
            keyword: "#cf222e",
            string: "#0a3069",
            comment: "#6e7781",
            number: "#0550ae",
            function: "#8250df",
            variable: "#953800",
            type: "#116329",
            operator: "#0550ae",
            property: "#0550ae",
            default: "#6e7781",
          };
        }
      }

      getTokenColor(nodeType: string, colors: Record<string, string>): string {
        const typeLower = nodeType.toLowerCase();

        if (
          typeLower.includes("keyword") ||
          typeLower.includes("control") ||
          typeLower.includes("modifier")
        ) {
          return colors.keyword;
        }
        if (typeLower.includes("string") || typeLower.includes("template")) {
          return colors.string;
        }
        if (
          typeLower.includes("comment") ||
          typeLower.includes("blockcomment") ||
          typeLower.includes("linecomment")
        ) {
          return colors.comment;
        }
        if (
          typeLower.includes("number") ||
          typeLower.includes("integer") ||
          typeLower.includes("float")
        ) {
          return colors.number;
        }
        if (
          typeLower.includes("function") ||
          typeLower.includes("method") ||
          typeLower.includes("call")
        ) {
          return colors.function;
        }
        if (
          typeLower.includes("variable") ||
          typeLower.includes("identifier")
        ) {
          return colors.variable;
        }
        if (
          typeLower.includes("type") ||
          typeLower.includes("class") ||
          typeLower.includes("interface")
        ) {
          return colors.type;
        }
        if (
          typeLower.includes("operator") ||
          typeLower.includes("punctuation")
        ) {
          return colors.operator;
        }
        if (typeLower.includes("property")) {
          return colors.property;
        }

        return colors.default;
      }

      renderMinimap() {
        if (!this.canvas || !this.host) return;

        const hostRect = this.host.getBoundingClientRect();
        const width = hostRect.width;
        const height = hostRect.height;

        if (width === 0 || height === 0) return;

        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = width * dpr;
        this.canvas.height = height * dpr;
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;

        const ctx = this.canvas.getContext("2d");
        if (!ctx) return;

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, width, height);

        const colors = this.getSyntaxColors();
        const doc = this.mainView.state.doc;
        const totalLines = doc.lines;
        const tree = syntaxTree(this.mainView.state);

        const charWidth = 0.8;

        for (let lineNum = 1; lineNum <= totalLines; lineNum++) {
          const line = doc.line(lineNum);
          const lineText = line.text;
          const yPos = MINIMAP_PADDING + (lineNum - 1) * MINIMAP_LINE_HEIGHT;

          if (yPos > height) break;

          if (lineText.trim().length === 0) continue;

          const indentMatch = lineText.match(/^(\s*)/);
          const indent = indentMatch ? indentMatch[1].length : 0;
          const baseX = 4 + indent * 1.5;

          interface TokenSpan {
            start: number;
            end: number;
            color: string;
          }
          const tokens: TokenSpan[] = [];

          tree.iterate({
            from: line.from,
            to: line.to,
            enter: (node) => {
              if (node.node.firstChild) return;

              const nodeStart = Math.max(node.from, line.from);
              const nodeEnd = Math.min(node.to, line.to);

              if (nodeStart < nodeEnd) {
                const color = this.getTokenColor(node.name, colors);
                tokens.push({
                  start: nodeStart - line.from,
                  end: nodeEnd - line.from,
                  color,
                });
              }
            },
          });

          if (tokens.length === 0) {
            const contentLength = lineText.trim().length;
            const barWidth = Math.min(
              contentLength * charWidth,
              width - baseX - 4
            );
            ctx.fillStyle = colors.default;
            ctx.fillRect(baseX, yPos, Math.max(barWidth, 2), 2);
            continue;
          }

          tokens.sort((tokenA, tokenB) => tokenA.start - tokenB.start);

          for (const token of tokens) {
            const tokenText = lineText.slice(token.start, token.end);
            if (tokenText.trim().length === 0) continue;

            const xPos = baseX + (token.start - indent) * charWidth;
            const tokenWidth = Math.max(
              (token.end - token.start) * charWidth,
              1
            );

            ctx.fillStyle = token.color;
            ctx.fillRect(xPos, yPos, tokenWidth, 2);
          }
        }
      }

      updateViewport() {
        if (!this.viewport) return;

        const scroller = this.mainView.scrollDOM;
        const totalLines = this.mainView.state.doc.lines;
        const contentHeight = this.getContentHeight();
        const hostHeight = this.cachedHostHeight;

        if (totalLines === 0 || contentHeight === 0 || hostHeight <= 0) {
          this.viewport.style.display = "none";
          return;
        }

        this.viewport.style.display = "block";

        const scrollTop = scroller.scrollTop;
        const scrollHeight = scroller.scrollHeight;
        const clientHeight = scroller.clientHeight;

        const visibleRatio = clientHeight / scrollHeight;
        const scrollRatio =
          scrollTop / Math.max(1, scrollHeight - clientHeight);

        const viewportHeight = Math.max(
          20,
          Math.min(
            hostHeight - MINIMAP_PADDING * 2,
            visibleRatio * contentHeight
          )
        );
        const maxTop = hostHeight - viewportHeight - MINIMAP_PADDING;
        const viewportTop =
          MINIMAP_PADDING + scrollRatio * (maxTop - MINIMAP_PADDING);

        const safeTop = Math.max(MINIMAP_PADDING, viewportTop);
        this.viewport.style.transform = `translateY(${safeTop}px)`;
        this.viewport.style.height = `${viewportHeight}px`;
      }

      update(update: ViewUpdate) {
        if (!this.initialized) {
          this.tryInitialize();
          return;
        }

        if (update.docChanged) {
          this.renderMinimap();
        }

        if (
          update.docChanged ||
          update.geometryChanged ||
          update.viewportChanged
        ) {
          cancelAnimationFrame(this.updateRafId);
          this.updateRafId = requestAnimationFrame(() => this.updateViewport());
        }
      }

      destroy() {
        this.destroyed = true;
        cancelAnimationFrame(this.initRafId);
        cancelAnimationFrame(this.scrollRafId);
        cancelAnimationFrame(this.updateRafId);
        this.resizeObserver?.disconnect();
        if (this.host && this.clickHandler) {
          this.host.removeEventListener("mousedown", this.clickHandler);
        }
        if (this.dragHandler) {
          document.removeEventListener("mousemove", this.dragHandler);
        }
        if (this.dragEndHandler) {
          document.removeEventListener("mouseup", this.dragEndHandler);
        }
        if (this.scrollHandler) {
          this.mainView.scrollDOM.removeEventListener(
            "scroll",
            this.scrollHandler
          );
        }
        if (this.canvas && this.host) {
          this.host.removeChild(this.canvas);
        }
        if (this.viewport && this.host) {
          this.host.removeChild(this.viewport);
        }
        this.canvas = null;
        this.viewport = null;
        this.initialized = false;
      }
    }
  );
}
