// Element Inspector - DOM Tree Export and XPath Operations
// Provides DOM tree export for React panel and XPath-based operations

// DOM Tree Export (for React panel)
//
// Walks light DOM, open Shadow DOM, and same-origin iframe contentDocument.
// Cross-origin iframes and closed shadow roots remain opaque by design —
// the web security model forbids access, and DevTools exhibits the same
// limitation.
//
// Pseudo-nodes are emitted for shadow-root boundaries and iframe documents
// so the React tree can render them as DevTools-style dividers. They carry
// a synthetic xpath suffix (`__shadow__` / `__iframedoc__`) that is unique
// within the tree but cannot be selected in the webview.
window.__ORGII_GET_DOM_TREE__ = function (maxDepth) {
  maxDepth = maxDepth || 12;

  function makePseudoNode(parentXPath, kind, childEls) {
    var suffix = kind === "shadow-root" ? "__shadow__" : "__iframedoc__";
    var tagName = kind === "shadow-root" ? "#shadow-root" : "#document";
    return {
      tagName: tagName,
      id: null,
      className: null,
      xpath: parentXPath + "/" + suffix,
      rect: { x: 0, y: 0, width: 0, height: 0 },
      childCount: childEls ? childEls.length : 0,
      children: [],
      nodeKind: kind,
    };
  }

  function buildNode(el, depth) {
    if (!el || depth > maxDepth) return null;
    if (el.id && el.id.startsWith("__orgii_")) return null;
    if (el.nodeType !== Node.ELEMENT_NODE) return null;

    var rect = el.getBoundingClientRect();

    var classNameStr = null;
    try {
      if (typeof el.className === "string") {
        classNameStr = el.className || null;
      } else if (el.className && el.className.baseVal !== undefined) {
        classNameStr = el.className.baseVal || null;
      } else if (el.getAttribute) {
        classNameStr = el.getAttribute("class") || null;
      }
    } catch (e) {
      classNameStr = null;
    }

    if (classNameStr) {
      classNameStr =
        classNameStr
          .split(" ")
          .filter(function (c) {
            return c && !c.startsWith("__orgii");
          })
          .join(" ") || null;
    }

    var xpath = getXPath(el);
    var tagName = el.tagName.toLowerCase();

    // Detect shadow host (open mode only — closed roots are inaccessible)
    var shadow = null;
    try {
      if (el.shadowRoot) shadow = el.shadowRoot;
    } catch (e) {
      shadow = null;
    }

    // Detect same-origin iframe body
    var iframeDoc = null;
    if (tagName === "iframe" || tagName === "frame") {
      try {
        iframeDoc = el.contentDocument || null;
      } catch (e) {
        iframeDoc = null;
      }
    }

    var lightChildren = el.children;
    var shadowChildren = shadow ? shadow.children : null;
    var iframeBody = iframeDoc && iframeDoc.body ? iframeDoc.body : null;
    var totalChildCount =
      lightChildren.length +
      (shadowChildren ? shadowChildren.length : 0) +
      (iframeBody ? 1 : 0);

    var node = {
      tagName: tagName,
      id: el.id || null,
      className: classNameStr,
      xpath: xpath,
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      childCount: totalChildCount,
      children: [],
      nodeKind: "element",
    };

    if (depth < maxDepth) {
      // 1. Light DOM children
      for (var i = 0; i < lightChildren.length; i++) {
        var childNode = buildNode(lightChildren[i], depth + 1);
        if (childNode) node.children.push(childNode);
      }

      // 2. Open Shadow DOM — emit pseudo-node then shadow children
      if (shadow && shadowChildren && shadowChildren.length > 0) {
        var shadowNode = makePseudoNode(xpath, "shadow-root", shadowChildren);
        for (var j = 0; j < shadowChildren.length; j++) {
          var shadowChild = buildNode(shadowChildren[j], depth + 1);
          if (shadowChild) shadowNode.children.push(shadowChild);
        }
        node.children.push(shadowNode);
      }

      // 3. Same-origin iframe — emit pseudo-node wrapping iframe body
      if (iframeBody) {
        var docNode = makePseudoNode(xpath, "iframe-document", [iframeBody]);
        var bodyNode = buildNode(iframeBody, depth + 1);
        if (bodyNode) docNode.children.push(bodyNode);
        node.children.push(docNode);
      }
    }

    return node;
  }

  var tree = buildNode(document.body, 0);
  window.__ORGII_LAST_DOM_TREE__ = JSON.stringify(tree);
  // Reading the tree clears the dirty flag so the next React poll only
  // refetches if mutations happened *after* this snapshot.
  window.__ORGII_DOM_DIRTY__ = false;
  return window.__ORGII_LAST_DOM_TREE__;
};

// MutationObserver-based dirty flag.
//
// React polls `__ORGII_DOM_DIRTY__` on a cheap interval (e.g. every ~1.5 s).
// A full tree refetch only happens when this flag is true, so idle pages
// cost ~one boolean read per tick instead of a full DOM walk + serialize.
//
// We watch `document.documentElement` rather than `document.body` because
// some SPAs swap the entire body element. Subtree + childList captures
// element add/remove anywhere in the light DOM. Attribute/text mutations
// are intentionally ignored — they don't change the structural tree the
// React panel renders, and they fire constantly on real pages (animations,
// React re-renders, etc.).
//
// Shadow DOM and same-origin iframe mutations are NOT observed here. The
// cost of attaching observers to every shadow root and iframe at runtime
// outweighs the benefit; users can always hit the refresh button. The
// initial `__ORGII_GET_DOM_TREE__` walk still traverses both.
(function () {
  if (window.__ORGII_DOM_DIRTY_OBSERVER__) return;
  window.__ORGII_DOM_DIRTY_OBSERVER__ = true;
  // Start dirty so the first poll guarantees an initial paint even if the
  // tree was fetched before any mutations.
  window.__ORGII_DOM_DIRTY__ = true;

  var setupObserver = function () {
    if (!document.documentElement) return;
    try {
      var observer = new MutationObserver(function () {
        window.__ORGII_DOM_DIRTY__ = true;
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    } catch (e) {
      // If MutationObserver isn't available (extremely old WebKit), fall
      // back to "always dirty" — React polling will refetch every tick,
      // which is the pre-MutationObserver behaviour.
      window.__ORGII_DOM_DIRTY__ = true;
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupObserver, {
      once: true,
    });
  } else {
    setupObserver();
  }
})();

// Highlight by XPath (hover preview from React)
window.__ORGII_HIGHLIGHT_BY_XPATH__ = function (xpath) {
  if (!xpath) {
    highlightOverlay.style.display = "none";
    infoTooltip.style.display = "none";
    return false;
  }

  try {
    var result = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    var el = result.singleNodeValue;

    if (el && el.nodeType === Node.ELEMENT_NODE) {
      positionOverlay(highlightOverlay, el);
      var rect = el.getBoundingClientRect();
      var selector = getElementSelector(el);
      var dims =
        Math.round(rect.width) + "px × " + Math.round(rect.height) + "px";
      positionTooltip(el, selector + "  " + dims);
      return true;
    }
  } catch (e) {
    console.error("[Orgii Inspector] Invalid xpath:", e);
  }

  highlightOverlay.style.display = "none";
  infoTooltip.style.display = "none";
  return false;
};

// Select by XPath (click from React tree)
window.__ORGII_SELECT_BY_XPATH__ = function (xpath) {
  if (!xpath) return null;

  try {
    var result = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    var el = result.singleNodeValue;

    if (el && el.nodeType === Node.ELEMENT_NODE) {
      selectedElement = el;
      positionOverlay(selectedOverlay, el);
      window.__ORGII_SELECTED_ELEMENT_INFO__ = getElementInfo(el);

      // Scroll element into view
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      return JSON.stringify(window.__ORGII_SELECTED_ELEMENT_INFO__);
    }
  } catch (e) {
    console.error("[Orgii Inspector] Invalid xpath:", e);
  }
  return null;
};

// Set Element Style (live editing from React)
window.__ORGII_SET_ELEMENT_STYLE__ = function (xpath, property, value) {
  if (!xpath || !property) return false;

  try {
    var result = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    var el = result.singleNodeValue;

    if (el && el.nodeType === Node.ELEMENT_NODE) {
      // Convert camelCase to kebab-case for CSS
      var cssProperty = property.replace(/([A-Z])/g, "-$1").toLowerCase();
      el.style.setProperty(cssProperty, value);

      // Update overlay position if dimensions changed
      if (el === selectedElement) {
        positionOverlay(selectedOverlay, el);
        // Update stored info
        window.__ORGII_SELECTED_ELEMENT_INFO__ = getElementInfo(el);
      }
      return true;
    }
  } catch (e) {
    console.error("[Orgii Inspector] Failed to set style:", e);
  }
  return false;
};
