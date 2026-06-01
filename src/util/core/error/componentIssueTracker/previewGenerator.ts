/**
 * Preview HTML generation with inline styles.
 */

const PREVIEW_STYLE_KEYS = [
  "display",
  "position",
  "flex-direction",
  "align-items",
  "justify-content",
  "gap",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "border",
  "border-radius",
  "background",
  "background-color",
  "color",
  "font",
  "font-size",
  "font-weight",
  "font-family",
  "line-height",
  "text-align",
  "width",
  "min-width",
  "max-width",
  "height",
  "min-height",
  "max-height",
  "overflow",
  "white-space",
];

const MAX_PREVIEW_NODES = 200;

const applyInlinePreviewStyles = (
  source: HTMLElement,
  target: HTMLElement,
  counter: { value: number }
) => {
  if (counter.value >= MAX_PREVIEW_NODES) return;
  counter.value += 1;

  const computed = window.getComputedStyle(source);
  const inlineStyle = PREVIEW_STYLE_KEYS.map(
    (key) => `${key}:${computed.getPropertyValue(key)}`
  ).join(";");
  target.setAttribute("style", inlineStyle);

  const sourceChildren = Array.from(source.children);
  const targetChildren = Array.from(target.children);

  sourceChildren.forEach((child, index) => {
    const targetChild = targetChildren[index];
    if (
      child instanceof HTMLElement &&
      targetChild instanceof HTMLElement &&
      counter.value < MAX_PREVIEW_NODES
    ) {
      applyInlinePreviewStyles(child, targetChild, counter);
    }
  });
};

export const generatePreviewHtml = (element?: Element | null): string => {
  if (!element || !(element instanceof HTMLElement)) return "";
  const clone = element.cloneNode(true) as HTMLElement;
  applyInlinePreviewStyles(element, clone, { value: 0 });
  return clone.outerHTML;
};
