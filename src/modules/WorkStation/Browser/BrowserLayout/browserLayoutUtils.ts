/**
 * Pure helper functions for BrowserLayout state derivation.
 * Extracted from useBrowserLayoutState to keep that file under the hook
 * line limit.
 */
import type { ElementInfo } from "../hooks/useWebviewInspector";

/**
 * Short, pill-friendly label for a selected DOM element
 * (e.g. `div.hp_trivia_outer`).
 */
export function buildSelectedElementLabel(element: ElementInfo): string {
  const selector = element.selector || element.tagName || "element";
  return selector.length > 48 ? `${selector.slice(0, 45)}...` : selector;
}

/**
 * Structured text blob describing the selected DOM element for the agent.
 * Includes selector, rect, source-file path, and truncated innerText.
 */
export function buildSelectedElementText(
  element: ElementInfo,
  pageUrl: string | undefined
): string {
  const lines: string[] = ["[Browser DOM Element]"];
  if (pageUrl) lines.push(`URL: ${pageUrl}`);
  lines.push(`Selector: ${element.selector}`);
  if (element.xpath) lines.push(`XPath: ${element.xpath}`);
  const { x, y, width, height } = element.rect;
  lines.push(`Rect: x=${x} y=${y} ${width}x${height}`);
  lines.push(`Role: ${element.role}`);
  if (element.sourceLocation?.path) {
    const loc = element.sourceLocation;
    const line = loc.line != null ? `:${loc.line}` : "";
    lines.push(`Source: ${loc.path}${line}`);
    if (loc.componentName) lines.push(`Component: ${loc.componentName}`);
  }
  const innerText = element.innerText?.trim();
  if (innerText) {
    const preview =
      innerText.length > 200 ? `${innerText.slice(0, 197)}...` : innerText;
    lines.push(`Text: ${preview}`);
  }
  return lines.join("\n");
}
