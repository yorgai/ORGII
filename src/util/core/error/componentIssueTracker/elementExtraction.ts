/**
 * Element extraction utilities for React component info, context clues, and position.
 */

// Extract React component name from element's fiber
export const getReactComponentInfo = (element: Element) => {
  try {
    // Try to get React fiber from element
    const fiberKey = Object.keys(element).find(
      (key) =>
        key.startsWith("__reactFiber") ||
        key.startsWith("__reactInternalInstance")
    );

    if (fiberKey) {
      const fiber = (element as unknown as Record<string, unknown>)[
        fiberKey
      ] as {
        type?: { name?: string; displayName?: string };
        elementType?: { name?: string; displayName?: string };
        _debugOwner?: { type?: { name?: string; displayName?: string } };
        return?: { type?: { name?: string; displayName?: string } };
      };

      // Try multiple ways to get the component name
      const componentName =
        fiber?.type?.displayName ||
        fiber?.type?.name ||
        fiber?.elementType?.displayName ||
        fiber?.elementType?.name ||
        fiber?._debugOwner?.type?.displayName ||
        fiber?._debugOwner?.type?.name ||
        fiber?.return?.type?.displayName ||
        fiber?.return?.type?.name;

      if (componentName) {
        return {
          name: componentName,
          fiber: fiberKey,
        };
      }
    }
  } catch (_error) {
    // Silently fail - React info is optional
  }
  return undefined;
};

// Extract context clues from element
export const extractContextClues = (element: Element) => {
  const clues: {
    nearbyText?: string;
    siblingElements?: string[];
    eventHandlers?: string[];
    ariaAttributes?: Record<string, string>;
  } = {};

  // Get nearby text from siblings
  const parent = element.parentElement;
  if (parent) {
    const siblingTexts: string[] = [];
    Array.from(parent.children).forEach((sibling) => {
      if (sibling !== element && sibling.textContent) {
        const text = sibling.textContent.trim().slice(0, 50);
        if (text) siblingTexts.push(text);
      }
    });
    if (siblingTexts.length > 0) {
      clues.nearbyText = siblingTexts.join(" | ");
    }
  }

  // Get sibling element types
  if (parent) {
    const siblings: string[] = [];
    Array.from(parent.children).forEach((sibling) => {
      if (sibling !== element) {
        const tag = sibling.tagName.toLowerCase();
        const dataComp = sibling.getAttribute("data-component");
        siblings.push(dataComp ? `${tag}[${dataComp}]` : tag);
      }
    });
    if (siblings.length > 0 && siblings.length <= 10) {
      clues.siblingElements = siblings;
    }
  }

  // Extract event handler attribute names
  const handlers: string[] = [];
  Array.from(element.attributes).forEach((attr) => {
    if (attr.name.startsWith("on")) {
      handlers.push(attr.name);
    }
  });
  if (handlers.length > 0) {
    clues.eventHandlers = handlers;
  }

  // Extract ARIA attributes
  const ariaAttrs: Record<string, string> = {};
  Array.from(element.attributes).forEach((attr) => {
    if (attr.name.startsWith("aria-") || attr.name === "role") {
      ariaAttrs[attr.name] = attr.value;
    }
  });
  if (Object.keys(ariaAttrs).length > 0) {
    clues.ariaAttributes = ariaAttrs;
  }

  return Object.keys(clues).length > 0 ? clues : undefined;
};

// Extract position information
export const extractPosition = (element: Element) => {
  const computedStyle = window.getComputedStyle(element);
  return {
    top: computedStyle.top,
    left: computedStyle.left,
    right: computedStyle.right,
    bottom: computedStyle.bottom,
    position: computedStyle.position,
  };
};
