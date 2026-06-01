/**
 * Payload builder for component issue reporting.
 */
import { inferComponentSuggestions } from "../../../config/componentMapping";
import {
  buildCssSelector,
  buildDomPath,
  buildHierarchy,
  buildStyleSnapshot,
} from "./domAnalysis";
import {
  extractContextClues,
  extractPosition,
  getReactComponentInfo,
} from "./elementExtraction";
import type { ComponentIssuePayload } from "./types";

export const buildIssuePayload = (
  element?: Element | null
): ComponentIssuePayload | null => {
  if (!element || !(element instanceof HTMLElement)) return null;

  const rect = element.getBoundingClientRect();
  const attributes = Array.from(element.attributes).reduce<
    Record<string, string>
  >((acc, attr) => {
    acc[attr.name] = attr.value;
    return acc;
  }, {});

  const dataAttributes = Object.keys(element.dataset).reduce<
    Record<string, string>
  >((acc, key) => {
    const value = element.dataset[key];
    if (value !== undefined) {
      acc[key] = value;
    }
    return acc;
  }, {});

  const textSample = (element.textContent || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);

  const htmlSnippet = element.outerHTML.slice(0, 800);

  const formatSearchableLabel = () => {
    const dataComponent = element.getAttribute("data-component");
    if (dataComponent) return `data-component="${dataComponent}"`;

    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) return `aria-label="${ariaLabel}"`;

    if (element.id) return `id="${element.id}"`;

    const classTokens = Array.from(element.classList).filter(Boolean);
    if (classTokens.length) {
      return `className="${classTokens.join(" ")}"`;
    }

    return `<${element.tagName.toLowerCase()}>`;
  };

  const componentLabel = formatSearchableLabel();
  const url = window.location.href;

  // Infer component suggestions
  const componentSuggestions = inferComponentSuggestions(element, url);

  // Extract React component info
  const reactComponent = getReactComponentInfo(element);

  // Extract context clues
  const contextClues = extractContextClues(element);

  // Extract position info
  const position = extractPosition(element);

  return {
    componentLabel,
    tagName: element.tagName.toLowerCase(),
    id: element.id || undefined,
    classList: Array.from(element.classList),
    attributes,
    dataAttributes,
    textSample,
    htmlSnippet,
    cssSelector: buildCssSelector(element),
    domPath: buildDomPath(element),
    boundingRect: {
      top: rect.top,
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    },
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    },
    styleSnapshot: buildStyleSnapshot(element),
    hierarchy: buildHierarchy(element),
    timestamp: new Date().toISOString(),
    url,
    componentSuggestions,
    reactComponent,
    contextClues,
    position,
  };
};
