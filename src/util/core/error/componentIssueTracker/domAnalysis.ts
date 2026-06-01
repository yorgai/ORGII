/**
 * DOM analysis utilities for building selectors, paths, and style snapshots.
 */

export const buildCssSelector = (element: Element): string => {
  const parts: string[] = [];
  let current: Element | null = element;

  while (current && current.nodeType === 1) {
    let selector = current.tagName.toLowerCase();

    if (current.id) {
      selector += `#${CSS.escape(current.id)}`;
      parts.unshift(selector);
      break;
    }

    const classList = Array.from(current.classList).filter(Boolean);
    if (classList.length) {
      selector += "." + classList.map((cls) => CSS.escape(cls)).join(".");
    }

    const siblingIndex = Array.from(
      current.parentElement?.children || []
    ).indexOf(current);
    if (siblingIndex >= 0) {
      selector += `:nth-child(${siblingIndex + 1})`;
    }

    parts.unshift(selector);
    current = current.parentElement;
    if (current === document.body) {
      parts.unshift("body");
      break;
    }
  }

  return parts.join(" > ");
};

export const buildDomPath = (element: Element): string[] => {
  const path: string[] = [];
  let current: Element | null = element;

  while (
    current &&
    current !== document.body &&
    current !== document.documentElement
  ) {
    const nameParts = [current.tagName.toLowerCase()];
    if (current.id) nameParts.push(`#${current.id}`);
    if (current.classList.length) {
      nameParts.push(
        "." + Array.from(current.classList).filter(Boolean).join(".")
      );
    }
    path.unshift(nameParts.join(""));
    current = current.parentElement;
  }

  path.unshift("body");
  return path;
};

export const buildHierarchy = (element: Element) => {
  const hierarchy = [];
  let current: Element | null = element;

  while (current && current !== document.documentElement) {
    hierarchy.unshift({
      tag: current.tagName.toLowerCase(),
      id: current.id || undefined,
      classList: Array.from(current.classList),
      dataComponent: current.getAttribute("data-component") || undefined,
      role: current.getAttribute("role") || undefined,
    });
    current = current.parentElement;
  }

  return hierarchy;
};

export const buildStyleSnapshot = (
  element: Element
): Record<string, string> => {
  const computedStyles = window.getComputedStyle(element);
  const keys = [
    "color",
    "background",
    "background-color",
    "border",
    "border-color",
    "border-top-color",
    "border-right-color",
    "border-bottom-color",
    "border-left-color",
    "outline-color",
    "caret-color",
    "fill",
    "stroke",
    "font-size",
    "font-weight",
    "font-family",
    "line-height",
    "display",
    "position",
    "z-index",
    "margin",
    "padding",
  ];

  return keys.reduce<Record<string, string>>((acc, key) => {
    acc[key] = computedStyles.getPropertyValue(key) || "";
    return acc;
  }, {});
};
