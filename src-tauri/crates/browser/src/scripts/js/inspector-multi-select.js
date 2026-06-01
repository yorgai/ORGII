// Element Inspector - Multi-select overlays, bounds, resize, position
// Depends on: inspector-editor.js (recordMutation)

const multiSelectedElements = new Map(); // xpath -> element
const multiSelectOverlays = new Map(); // xpath -> overlay div

// Create multi-select overlay
const createMultiSelectOverlay = (xpath) => {
  const overlay = document.createElement("div");
  overlay.className = "__orgii_multi_select_overlay__";
  overlay.style.cssText = `
        position: fixed;
        pointer-events: none;
        z-index: 2147483644;
        border: 2px solid #8b5cf6;
        background: rgba(139, 92, 246, 0.1);
        display: none;
        box-sizing: border-box;
    `;
  document.body.appendChild(overlay);
  return overlay;
};

// Add element to multi-selection
window.__ORGII_MULTI_SELECT_ADD__ = function (xpath) {
  try {
    const el = getElementByXPath(xpath);
    if (!el) return false;

    if (multiSelectedElements.has(xpath)) return true; // Already selected

    multiSelectedElements.set(xpath, el);

    const overlay = createMultiSelectOverlay(xpath);
    positionOverlay(overlay, el);
    multiSelectOverlays.set(xpath, overlay);
    return true;
  } catch (e) {
    console.error("[Orgii Inspector] Multi-select add failed:", e);
    return false;
  }
};

// Remove element from multi-selection
window.__ORGII_MULTI_SELECT_REMOVE__ = function (xpath) {
  try {
    if (!multiSelectedElements.has(xpath)) return false;

    multiSelectedElements.delete(xpath);

    const overlay = multiSelectOverlays.get(xpath);
    if (overlay) {
      overlay.remove();
      multiSelectOverlays.delete(xpath);
    }
    return true;
  } catch (e) {
    console.error("[Orgii Inspector] Multi-select remove failed:", e);
    return false;
  }
};

// Toggle element in multi-selection
window.__ORGII_MULTI_SELECT_TOGGLE__ = function (xpath) {
  if (multiSelectedElements.has(xpath)) {
    return window.__ORGII_MULTI_SELECT_REMOVE__(xpath);
  } else {
    return window.__ORGII_MULTI_SELECT_ADD__(xpath);
  }
};

// Get all multi-selected elements
window.__ORGII_GET_MULTI_SELECTION__ = function () {
  try {
    const selections = [];
    for (const [xpath, el] of multiSelectedElements) {
      const info = getElementInfo(el);
      if (info) {
        selections.push(info);
      }
    }
    return JSON.stringify(selections);
  } catch (e) {
    console.error("[Orgii Inspector] Get multi-selection failed:", e);
    return "[]";
  }
};

// Clear all multi-selections
window.__ORGII_CLEAR_MULTI_SELECTION__ = function () {
  try {
    for (const overlay of multiSelectOverlays.values()) {
      overlay.remove();
    }
    multiSelectedElements.clear();
    multiSelectOverlays.clear();
    return true;
  } catch (e) {
    console.error("[Orgii Inspector] Clear multi-selection failed:", e);
    return false;
  }
};

// Update multi-select overlays (call after DOM changes)
window.__ORGII_UPDATE_MULTI_SELECT_OVERLAYS__ = function () {
  for (const [xpath, overlay] of multiSelectOverlays) {
    const el = multiSelectedElements.get(xpath);
    if (el && document.body.contains(el)) {
      positionOverlay(overlay, el);
    } else {
      // Element removed from DOM, clean up
      overlay.remove();
      multiSelectOverlays.delete(xpath);
      multiSelectedElements.delete(xpath);
    }
  }
};

// Get Element Bounds (for React overlay)
window.__ORGII_GET_ELEMENT_BOUNDS__ = function (xpath) {
  try {
    const el = getElementByXPath(xpath);
    if (!el) return null;

    const rect = el.getBoundingClientRect();
    return JSON.stringify({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
    });
  } catch (e) {
    console.error("[Orgii Inspector] Get bounds failed:", e);
    return null;
  }
};

// Get bounds for multiple elements
window.__ORGII_GET_MULTIPLE_BOUNDS__ = function (xpaths) {
  try {
    const pathList = JSON.parse(xpaths);
    const bounds = {};
    for (const xpath of pathList) {
      const el = getElementByXPath(xpath);
      if (el) {
        const rect = el.getBoundingClientRect();
        bounds[xpath] = {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
      }
    }
    return JSON.stringify(bounds);
  } catch (e) {
    console.error("[Orgii Inspector] Get multiple bounds failed:", e);
    return "{}";
  }
};

// Resize Element
window.__ORGII_RESIZE_ELEMENT__ = function (xpath, width, height) {
  try {
    const element = getElementByXPath(xpath);
    if (!element) return false;

    // Record for undo
    const oldWidth = element.style.width || "";
    const oldHeight = element.style.height || "";

    recordMutation("resize", {
      xpath: xpath,
      oldWidth: oldWidth,
      oldHeight: oldHeight,
      newWidth: width,
      newHeight: height,
    });

    // Apply resize
    if (width !== null && width !== undefined) {
      element.style.width = typeof width === "number" ? width + "px" : width;
    }
    if (height !== null && height !== undefined) {
      element.style.height =
        typeof height === "number" ? height + "px" : height;
    }

    // Update overlays
    if (element === selectedElement) {
      positionOverlay(selectedOverlay, element);
      window.__ORGII_SELECTED_ELEMENT_INFO__ = getElementInfo(element);
    }
    window.__ORGII_UPDATE_MULTI_SELECT_OVERLAYS__();
    return true;
  } catch (e) {
    console.error("[Orgii DOM Editor] Resize failed:", e);
    return false;
  }
};

// Move/Position Element
window.__ORGII_SET_ELEMENT_POSITION__ = function (xpath, x, y) {
  try {
    const element = getElementByXPath(xpath);
    if (!element) return false;

    // Record for undo
    const oldLeft = element.style.left || "";
    const oldTop = element.style.top || "";
    const oldPosition = element.style.position || "";

    recordMutation("position", {
      xpath: xpath,
      oldLeft: oldLeft,
      oldTop: oldTop,
      oldPosition: oldPosition,
      newLeft: x,
      newTop: y,
    });

    // Ensure position is set
    if (!element.style.position || element.style.position === "static") {
      element.style.position = "relative";
    }

    // Apply position
    if (x !== null && x !== undefined) {
      element.style.left = typeof x === "number" ? x + "px" : x;
    }
    if (y !== null && y !== undefined) {
      element.style.top = typeof y === "number" ? y + "px" : y;
    }

    // Update overlays
    if (element === selectedElement) {
      positionOverlay(selectedOverlay, element);
      window.__ORGII_SELECTED_ELEMENT_INFO__ = getElementInfo(element);
    }
    window.__ORGII_UPDATE_MULTI_SELECT_OVERLAYS__();
    return true;
  } catch (e) {
    console.error("[Orgii DOM Editor] Position failed:", e);
    return false;
  }
};
