/**
 * Highlight overlay creation and management.
 */
import { getViewportSize } from "@src/util/ui/window/viewport";

import {
  areLabelsHidden,
  getCurrentLevel,
  getHighlightOverlay,
  getLabelOverlay,
  getParentHighlightOverlay,
  getParentLabelOverlay,
  setCurrentLevel,
  setHighlightOverlay,
  setLabelOverlay,
  setParentHighlightOverlay,
  setParentLabelOverlay,
} from "./state";

// Helper to get the element at the current level (0 = original, 1 = parent, etc.)
export const getElementAtLevel = (
  baseElement: Element | null,
  level: number
): Element | null => {
  if (!baseElement) return null;
  let current: Element | null = baseElement;
  for (let levelIndex = 0; levelIndex < level; levelIndex++) {
    const parent: Element | null = current?.parentElement;
    if (
      !parent ||
      parent === document.body ||
      parent === document.documentElement
    ) {
      return current; // Can't go higher, return current
    }
    current = parent;
  }
  return current;
};

// Helper to build element label text
export const buildElementLabel = (element: Element): string => {
  const rect = element.getBoundingClientRect();
  const tagName = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : "";
  const classes = Array.from(element.classList).filter(Boolean).slice(0, 3);
  const classStr = classes.length ? `.${classes.join(".")}` : "";
  const dataComponent = element.getAttribute("data-component");
  const componentStr = dataComponent ? ` [${dataComponent}]` : "";
  const dimensions = `${Math.round(rect.width)}×${Math.round(rect.height)}`;
  return `${tagName}${id}${classStr}${componentStr} — ${dimensions}`;
};

export const createHighlightOverlay = () => {
  if (getHighlightOverlay()) return;

  // Parent highlight (color b - amber/orange, shown behind)
  const parentHighlight = document.createElement("div");
  parentHighlight.id = "orgii-inspect-parent-highlight";
  parentHighlight.style.cssText = `
    position: fixed;
    pointer-events: none;
    z-index: 999998;
    border: 2px dashed #f59e0b;
    background: rgba(245, 158, 11, 0.08);
    box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.2);
    transition: all 0.1s ease-out;
    display: none;
  `;
  document.body.appendChild(parentHighlight);
  setParentHighlightOverlay(parentHighlight);

  const parentLabel = document.createElement("div");
  parentLabel.id = "orgii-inspect-parent-label";
  parentLabel.style.cssText = `
    position: fixed;
    pointer-events: none;
    z-index: 999999;
    background: linear-gradient(135deg, #451a03 0%, #78350f 100%);
    color: #fbbf24;
    padding: 3px 6px;
    border-radius: 3px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 10px;
    font-weight: 500;
    border: 1px solid rgba(245, 158, 11, 0.4);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
    white-space: nowrap;
    display: none;
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;
    opacity: 0.9;
  `;
  document.body.appendChild(parentLabel);
  setParentLabelOverlay(parentLabel);

  // Main element highlight (color a - cyan, shown in front)
  const highlight = document.createElement("div");
  highlight.id = "orgii-inspect-highlight";
  highlight.style.cssText = `
    position: fixed;
    pointer-events: none;
    z-index: 999999;
    border: 2px solid #00d9ff;
    background: rgba(0, 217, 255, 0.1);
    box-shadow: 0 0 0 1px rgba(0, 217, 255, 0.3), inset 0 0 20px rgba(0, 217, 255, 0.1);
    transition: all 0.1s ease-out;
    display: none;
  `;
  document.body.appendChild(highlight);
  setHighlightOverlay(highlight);

  const label = document.createElement("div");
  label.id = "orgii-inspect-label";
  label.style.cssText = `
    position: fixed;
    pointer-events: none;
    z-index: 1000000;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    color: #00d9ff;
    padding: 4px 8px;
    border-radius: 4px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 11px;
    font-weight: 500;
    border: 1px solid rgba(0, 217, 255, 0.4);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    white-space: nowrap;
    display: none;
    max-width: 400px;
    overflow: hidden;
    text-overflow: ellipsis;
  `;
  document.body.appendChild(label);
  setLabelOverlay(label);
};

export const removeHighlightOverlay = () => {
  const highlightOverlay = getHighlightOverlay();
  const labelOverlay = getLabelOverlay();
  const parentHighlightOverlay = getParentHighlightOverlay();
  const parentLabelOverlay = getParentLabelOverlay();

  if (highlightOverlay) {
    highlightOverlay.remove();
    setHighlightOverlay(null);
  }
  if (labelOverlay) {
    labelOverlay.remove();
    setLabelOverlay(null);
  }
  if (parentHighlightOverlay) {
    parentHighlightOverlay.remove();
    setParentHighlightOverlay(null);
  }
  if (parentLabelOverlay) {
    parentLabelOverlay.remove();
    setParentLabelOverlay(null);
  }
  setCurrentLevel(0);
};

export const updateHighlight = (element: Element | null) => {
  const highlightOverlay = getHighlightOverlay();
  const labelOverlay = getLabelOverlay();
  const parentHighlightOverlay = getParentHighlightOverlay();
  const parentLabelOverlay = getParentLabelOverlay();
  const currentLevel = getCurrentLevel();
  const labelsHidden = areLabelsHidden();

  if (!highlightOverlay || !labelOverlay || !element) {
    if (highlightOverlay) highlightOverlay.style.display = "none";
    if (labelOverlay) labelOverlay.style.display = "none";
    if (parentHighlightOverlay) parentHighlightOverlay.style.display = "none";
    if (parentLabelOverlay) parentLabelOverlay.style.display = "none";
    return;
  }

  // Get the actual selected element based on current level
  const selectedElement = getElementAtLevel(element, currentLevel);
  if (!selectedElement) return;

  const rect = selectedElement.getBoundingClientRect();

  // Update main highlight
  highlightOverlay.style.display = "block";
  highlightOverlay.style.top = `${rect.top}px`;
  highlightOverlay.style.left = `${rect.left}px`;
  highlightOverlay.style.width = `${rect.width}px`;
  highlightOverlay.style.height = `${rect.height}px`;

  // Build and position main label (respect labelsHidden state)
  labelOverlay.textContent = buildElementLabel(selectedElement);
  labelOverlay.style.display = labelsHidden ? "none" : "block";

  const labelHeight = 24;
  const labelTop = rect.top - labelHeight - 4;

  if (labelTop > 0) {
    labelOverlay.style.top = `${labelTop}px`;
  } else {
    labelOverlay.style.top = `${rect.bottom + 4}px`;
  }
  labelOverlay.style.left = `${Math.max(4, rect.left)}px`;

  // Update parent highlight (color b)
  const parentElement = selectedElement.parentElement;
  if (
    parentHighlightOverlay &&
    parentLabelOverlay &&
    parentElement &&
    parentElement !== document.body &&
    parentElement !== document.documentElement
  ) {
    const parentRect = parentElement.getBoundingClientRect();

    parentHighlightOverlay.style.display = "block";
    parentHighlightOverlay.style.top = `${parentRect.top}px`;
    parentHighlightOverlay.style.left = `${parentRect.left}px`;
    parentHighlightOverlay.style.width = `${parentRect.width}px`;
    parentHighlightOverlay.style.height = `${parentRect.height}px`;

    // Build and position parent label (on right edge, middle) - respect labelsHidden state
    parentLabelOverlay.textContent = `↑ ${buildElementLabel(parentElement)}`;
    parentLabelOverlay.style.display = labelsHidden ? "none" : "block";

    // Position parent label at the top-right of the parent, offset to not overlap main label
    const parentLabelTop = parentRect.top + 4;
    parentLabelOverlay.style.top = `${parentLabelTop}px`;
    parentLabelOverlay.style.left = `${Math.min(parentRect.right - 200, getViewportSize().width - 210)}px`;
  } else if (parentHighlightOverlay && parentLabelOverlay) {
    parentHighlightOverlay.style.display = "none";
    parentLabelOverlay.style.display = "none";
  }
};
