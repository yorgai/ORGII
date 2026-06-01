// Element Inspector - Element Info Extraction
// Provides detailed element information for the inspector panel

// Get element info
const getElementInfo = (el) => {
  if (!el) return null;
  try {
    const rect = el.getBoundingClientRect();
    const computedStyle = window.getComputedStyle(el);

    // Get attributes (limit to important ones)
    const attrs = {};
    const importantAttrs = [
      "id",
      "class",
      "name",
      "type",
      "href",
      "src",
      "alt",
      "title",
      "placeholder",
      "value",
      "role",
      "aria-label",
      "data-testid",
    ];
    importantAttrs.forEach((attr) => {
      try {
        const val = el.getAttribute(attr);
        if (val)
          attrs[attr] = val.length > 100 ? val.substring(0, 97) + "..." : val;
      } catch (e) {}
    });

    // Handle className safely (SVG elements have SVGAnimatedString)
    let classNameStr = null;
    try {
      if (typeof el.className === "string") {
        classNameStr = el.className || null;
      } else if (el.className && el.className.baseVal !== undefined) {
        // SVGAnimatedString
        classNameStr = el.className.baseVal || null;
      } else if (el.getAttribute) {
        classNameStr = el.getAttribute("class") || null;
      }
    } catch (e) {
      classNameStr = null;
    }

    // Get source location (for DOM-to-Source mapping)
    const sourceLocation = getSourceLocation(el);

    return {
      tagName: el.tagName.toLowerCase(),
      selector: getElementSelector(el),
      id: el.id || null,
      className: classNameStr,
      attributes: attrs,
      innerText: (el.innerText || "").substring(0, 200),
      innerHTML: (el.innerHTML || "").substring(0, 500),
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      computedStyle: {
        display: computedStyle.display || null,
        position: computedStyle.position || null,
        color: computedStyle.color || null,
        backgroundColor: computedStyle.backgroundColor || null,
        fontSize: computedStyle.fontSize || null,
        fontFamily: computedStyle.fontFamily || null,
      },
      role: el.getAttribute("role") || el.tagName.toLowerCase(),
      xpath: getXPath(el),
      sourceLocation: sourceLocation,
    };
  } catch (e) {
    console.error("[Orgii Inspector] Error getting element info:", e);
    return null;
  }
};

// Get Full Computed Styles (for Design panel)
window.__ORGII_GET_FULL_COMPUTED_STYLES__ = function () {
  if (!selectedElement) return null;

  try {
    var computed = window.getComputedStyle(selectedElement);
    var rect = selectedElement.getBoundingClientRect();

    var styles = {
      // Box model
      width: computed.width,
      height: computed.height,
      paddingTop: computed.paddingTop,
      paddingRight: computed.paddingRight,
      paddingBottom: computed.paddingBottom,
      paddingLeft: computed.paddingLeft,
      marginTop: computed.marginTop,
      marginRight: computed.marginRight,
      marginBottom: computed.marginBottom,
      marginLeft: computed.marginLeft,
      borderTopWidth: computed.borderTopWidth,
      borderRightWidth: computed.borderRightWidth,
      borderBottomWidth: computed.borderBottomWidth,
      borderLeftWidth: computed.borderLeftWidth,

      // Position
      position: computed.position,
      top: computed.top,
      right: computed.right,
      bottom: computed.bottom,
      left: computed.left,
      zIndex: computed.zIndex,

      // Layout
      display: computed.display,
      flexDirection: computed.flexDirection,
      justifyContent: computed.justifyContent,
      alignItems: computed.alignItems,
      alignContent: computed.alignContent,
      flexWrap: computed.flexWrap,
      gap: computed.gap,
      gridTemplateColumns: computed.gridTemplateColumns,
      gridTemplateRows: computed.gridTemplateRows,

      // Typography
      fontSize: computed.fontSize,
      fontWeight: computed.fontWeight,
      fontFamily: computed.fontFamily,
      lineHeight: computed.lineHeight,
      letterSpacing: computed.letterSpacing,
      textAlign: computed.textAlign,
      textDecoration: computed.textDecoration,
      color: computed.color,

      // Background & Borders
      backgroundColor: computed.backgroundColor,
      backgroundImage: computed.backgroundImage,
      borderRadius: computed.borderRadius,
      borderTopLeftRadius: computed.borderTopLeftRadius,
      borderTopRightRadius: computed.borderTopRightRadius,
      borderBottomLeftRadius: computed.borderBottomLeftRadius,
      borderBottomRightRadius: computed.borderBottomRightRadius,
      borderColor: computed.borderColor,
      borderStyle: computed.borderStyle,
      boxShadow: computed.boxShadow,

      // Effects
      opacity: computed.opacity,
      overflow: computed.overflow,
      overflowX: computed.overflowX,
      overflowY: computed.overflowY,
      transform: computed.transform,
      transition: computed.transition,
      cursor: computed.cursor,
      visibility: computed.visibility,

      // Computed rect (actual position on screen)
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    };

    window.__ORGII_LAST_COMPUTED_STYLES__ = JSON.stringify(styles);
    return window.__ORGII_LAST_COMPUTED_STYLES__;
  } catch (e) {
    console.error("[Orgii Inspector] Failed to get computed styles:", e);
    return null;
  }
};

// Get selected element info
window.__ORGII_GET_SELECTED_ELEMENT__ = function () {
  return JSON.stringify(window.__ORGII_SELECTED_ELEMENT_INFO__ || null);
};

// Clear selection
window.__ORGII_CLEAR_SELECTION__ = function () {
  selectedElement = null;
  window.__ORGII_SELECTED_ELEMENT_INFO__ = null;
  selectedOverlay.style.display = "none";
};

// Clear Highlight (when mouse leaves React tree)
window.__ORGII_CLEAR_HIGHLIGHT__ = function () {
  highlightOverlay.style.display = "none";
  infoTooltip.style.display = "none";
};

// Get element by XPath (utility - exposed to window)
window.__ORGII_GET_ELEMENT_BY_XPATH__ = function (xpath) {
  if (!xpath) return null;
  try {
    var result = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    return result.singleNodeValue;
  } catch (e) {
    return null;
  }
};

// Expand tree to element (find path from selection)
window.__ORGII_GET_ELEMENT_PATH__ = function () {
  if (!selectedElement) return null;

  var paths = [];
  var el = selectedElement;

  while (el && el !== document.body && el.nodeType === Node.ELEMENT_NODE) {
    paths.unshift(getXPath(el));
    el = el.parentElement;
  }

  // Add body
  if (document.body) {
    paths.unshift(getXPath(document.body));
  }

  return JSON.stringify(paths);
};

// Diagnostic: Get React fiber info for debugging
window.__ORGII_GET_FIBER_DIAGNOSTIC__ = function () {
  if (!selectedElement) return JSON.stringify({ error: "No element selected" });

  try {
    var el = selectedElement;
    var diagnostic = {
      hasReactFiber: false,
      fiberKey: null,
      hasDebugSource: false,
      debugSourceSample: null,
      hasTypeSource: false,
      typeSourceSample: null,
      componentNames: [],
      availableFiberProps: [],
      hasReactDevTools: !!window.__REACT_DEVTOOLS_GLOBAL_HOOK__,
      rendererCount: 0,
    };

    // Find React fiber
    var fiberKey = Object.keys(el).find(function (key) {
      return (
        key.startsWith("__reactFiber") ||
        key.startsWith("__reactInternalInstance")
      );
    });

    if (fiberKey) {
      diagnostic.hasReactFiber = true;
      diagnostic.fiberKey = fiberKey;

      var fiber = el[fiberKey];
      var depth = 0;

      while (fiber && depth < 20) {
        depth++;

        // Check for _debugSource
        if (fiber._debugSource) {
          diagnostic.hasDebugSource = true;
          diagnostic.debugSourceSample = {
            fileName: fiber._debugSource.fileName,
            lineNumber: fiber._debugSource.lineNumber,
          };
        }

        // Check for type.__source
        if (fiber.type && fiber.type.__source) {
          diagnostic.hasTypeSource = true;
          diagnostic.typeSourceSample = fiber.type.__source;
        }

        // Get component name
        if (fiber.type) {
          var name = null;
          if (typeof fiber.type === "function") {
            name = fiber.type.displayName || fiber.type.name;
          } else if (fiber.type.render) {
            name = fiber.type.displayName || fiber.type.render.name;
          }
          if (name && diagnostic.componentNames.indexOf(name) === -1) {
            diagnostic.componentNames.push(name);
          }
        }

        // Collect available props on first fiber
        if (depth === 1) {
          diagnostic.availableFiberProps = Object.keys(fiber).filter(
            function (k) {
              return k.startsWith("_") || k === "type" || k === "elementType";
            }
          );
        }

        fiber = fiber._debugOwner || fiber.return;
      }
    }

    // Check React DevTools
    if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
      var hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      if (hook.renderers) {
        diagnostic.rendererCount = hook.renderers.size || 0;
      }
    }

    return JSON.stringify(diagnostic, null, 2);
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
};
