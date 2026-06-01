// Element Inspector - Inspect Mode Control
// Provides enable/disable/toggle functionality for the inspector

// Enable inspect mode
window.__ORGII_ENABLE_INSPECT_MODE__ = function () {
  if (inspectEnabled) return;
  inspectEnabled = true;
  document.body.style.cursor = "crosshair";
  document.addEventListener("mousemove", handleMouseMove, true);
  document.addEventListener("mousedown", handleMouseDown, true);
  document.addEventListener("mouseup", handleMouseUp, true);
  document.addEventListener("click", handleClick, true);
  document.addEventListener("keydown", handleKeyDown, true);
};

// Disable inspect mode
window.__ORGII_DISABLE_INSPECT_MODE__ = function () {
  if (!inspectEnabled) return;
  inspectEnabled = false;
  document.body.style.cursor = "";
  document.removeEventListener("mousemove", handleMouseMove, true);
  document.removeEventListener("mousedown", handleMouseDown, true);
  document.removeEventListener("mouseup", handleMouseUp, true);
  document.removeEventListener("click", handleClick, true);
  document.removeEventListener("keydown", handleKeyDown, true);
  highlightOverlay.style.display = "none";
  infoTooltip.style.display = "none";
  hideDropIndicator();
  hoveredElement = null;
  isDragging = false;
  draggedElement = null;
};

// Toggle inspect mode
window.__ORGII_TOGGLE_INSPECT_MODE__ = function () {
  if (inspectEnabled) {
    window.__ORGII_DISABLE_INSPECT_MODE__();
    return false;
  } else {
    window.__ORGII_ENABLE_INSPECT_MODE__();
    return true;
  }
};

// Get inspect mode state
window.__ORGII_IS_INSPECT_MODE_ENABLED__ = function () {
  return inspectEnabled;
};
