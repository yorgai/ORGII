/**
 * Inspect mode controls: toggle, lock, cleanup, and level navigation.
 */
import { ensureHoverTracking } from "./hoverTracking";
import {
  createHighlightOverlay,
  getElementAtLevel,
  removeHighlightOverlay,
  updateHighlight,
} from "./overlay";
import {
  areLabelsHidden,
  decrementCurrentLevel,
  getCurrentLevel,
  getLabelOverlay,
  getLastHoveredElement,
  getParentLabelOverlay,
  incrementCurrentLevel,
  isInspectModeEnabled,
  resetInspectState,
  setCurrentLevel,
  setHighlightLocked,
  setInspectModeEnabled,
  setLabelsHidden,
  setUserNavigatedLevel,
} from "./state";

// --- Inspect Mode Toggle ---

export const toggleInspectMode = (): boolean => {
  const enabled = !isInspectModeEnabled();
  setInspectModeEnabled(enabled);

  if (enabled) {
    ensureHoverTracking();
    createHighlightOverlay();
    setCurrentLevel(0);
    setLabelsHidden(false);
    setHighlightLocked(false);
    setUserNavigatedLevel(false);
    // Update highlight for current element
    const lastHoveredElement = getLastHoveredElement();
    if (lastHoveredElement) {
      updateHighlight(lastHoveredElement);
    }
  } else {
    resetInspectState();
    removeHighlightOverlay();
  }

  // Dispatch event for UI notification
  window.dispatchEvent(
    new CustomEvent("inspect-mode-changed", {
      detail: { enabled },
    })
  );

  return enabled;
};

export const enableInspectMode = () => {
  if (!isInspectModeEnabled()) {
    toggleInspectMode();
  }
};

export const disableInspectMode = () => {
  if (isInspectModeEnabled()) {
    toggleInspectMode();
  }
};

// --- Highlight Lock ---

export const lockHighlight = () => {
  setHighlightLocked(true);
  window.dispatchEvent(
    new CustomEvent("highlight-lock-changed", {
      detail: { locked: true },
    })
  );
};

export const unlockHighlight = () => {
  setHighlightLocked(false);
  window.dispatchEvent(
    new CustomEvent("highlight-lock-changed", {
      detail: { locked: false },
    })
  );
};

// --- Cleanup ---

export const cleanupInspectMode = () => {
  resetInspectState();
  setInspectModeEnabled(false);
  removeHighlightOverlay();
  window.dispatchEvent(
    new CustomEvent("inspect-mode-changed", {
      detail: { enabled: false },
    })
  );
};

// --- Level Navigation ---

/**
 * Move up one level in the DOM hierarchy (select parent container).
 * Returns true if successfully moved up, false if already at top.
 */
export const moveUpLevel = (): boolean => {
  const lastHoveredElement = getLastHoveredElement();
  if (!isInspectModeEnabled() || !lastHoveredElement) return false;

  const currentElement = getElementAtLevel(
    lastHoveredElement,
    getCurrentLevel()
  );
  if (!currentElement) return false;

  const parent = currentElement.parentElement;
  if (
    !parent ||
    parent === document.body ||
    parent === document.documentElement
  ) {
    return false;
  }

  incrementCurrentLevel();
  setUserNavigatedLevel(true);
  updateHighlight(lastHoveredElement);
  window.dispatchEvent(
    new CustomEvent("inspect-level-changed", {
      detail: { level: getCurrentLevel(), element: parent.tagName },
    })
  );

  return true;
};

/**
 * Move down one level in the DOM hierarchy (select child).
 * Returns true if successfully moved down, false if already at original level.
 */
export const moveDownLevel = (): boolean => {
  const currentLevel = getCurrentLevel();
  if (!isInspectModeEnabled() || currentLevel <= 0) {
    return false;
  }

  decrementCurrentLevel();
  const lastHoveredElement = getLastHoveredElement();
  const newElement = getElementAtLevel(lastHoveredElement, getCurrentLevel());

  // Reset navigation flag when returning to level 0 to resume mouse tracking
  if (getCurrentLevel() === 0) {
    setUserNavigatedLevel(false);
  }

  updateHighlight(lastHoveredElement);
  window.dispatchEvent(
    new CustomEvent("inspect-level-changed", {
      detail: { level: getCurrentLevel(), element: newElement?.tagName },
    })
  );

  return true;
};

/**
 * Reset level to 0 (original hovered element).
 */
export const resetLevel = () => {
  setCurrentLevel(0);
  const lastHoveredElement = getLastHoveredElement();
  if (isInspectModeEnabled() && lastHoveredElement) {
    updateHighlight(lastHoveredElement);
  }
};

// --- Label Visibility ---

/**
 * Toggle visibility of label overlays (H key).
 * When hidden, only the highlight boxes are shown without text labels.
 */
export const toggleLabelsHidden = (): boolean => {
  const hidden = !areLabelsHidden();
  setLabelsHidden(hidden);

  // Update label visibility immediately
  const labelOverlay = getLabelOverlay();
  const parentLabelOverlay = getParentLabelOverlay();

  if (labelOverlay) {
    labelOverlay.style.display = hidden ? "none" : "block";
  }
  if (parentLabelOverlay) {
    parentLabelOverlay.style.display = hidden ? "none" : "block";
  }
  window.dispatchEvent(
    new CustomEvent("inspect-labels-changed", {
      detail: { hidden },
    })
  );

  return hidden;
};

/**
 * Hide label overlays (X key).
 * Unlike toggleLabelsHidden, this only hides (doesn't toggle back).
 */
export const hideLabels = () => {
  if (areLabelsHidden()) return; // Already hidden, no-op

  setLabelsHidden(true);

  const labelOverlay = getLabelOverlay();
  const parentLabelOverlay = getParentLabelOverlay();

  if (labelOverlay) {
    labelOverlay.style.display = "none";
  }
  if (parentLabelOverlay) {
    parentLabelOverlay.style.display = "none";
  }
  window.dispatchEvent(
    new CustomEvent("inspect-labels-changed", {
      detail: { hidden: true },
    })
  );
};
