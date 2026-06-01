/**
 * Page Agent - DOM Automation for Tauri Inline Webviews
 *
 * This script provides:
 * - DOM tree extraction with interactive element detection
 * - Element highlighting with index labels
 * - Synthetic event dispatch for clicks, inputs, scrolls
 * - User takeover mask for blocking interaction during automation
 *
 * Exposed API on window.__PAGE_AGENT__
 */
(function () {
  "use strict";

  // Prevent double initialization
  if (window.__PAGE_AGENT__) return;

  // ============================================================================
  // Constants
  // ============================================================================

  const HIGHLIGHT_CONTAINER_ID = "page-agent-highlight-container";
  const MASK_CONTAINER_ID = "page-agent-mask";

  const HIGHLIGHT_COLORS = [
    "#FF0000",
    "#00FF00",
    "#0000FF",
    "#FFA500",
    "#800080",
    "#008080",
    "#FF69B4",
    "#4B0082",
    "#FF4500",
    "#2E8B57",
    "#DC143C",
    "#4682B4",
  ];

  const INTERACTIVE_ELEMENTS = new Set([
    "a",
    "button",
    "input",
    "select",
    "textarea",
    "details",
    "summary",
    "label",
    "option",
    "optgroup",
    "fieldset",
    "legend",
  ]);

  const INTERACTIVE_ROLES = new Set([
    "button",
    "link",
    "menu",
    "menubar",
    "menuitem",
    "menuitemradio",
    "menuitemcheckbox",
    "radio",
    "checkbox",
    "tab",
    "switch",
    "slider",
    "spinbutton",
    "combobox",
    "searchbox",
    "textbox",
    "listbox",
    "option",
    "scrollbar",
  ]);

  const INTERACTIVE_CURSORS = new Set([
    "pointer",
    "move",
    "text",
    "grab",
    "grabbing",
    "cell",
    "copy",
    "alias",
    "all-scroll",
    "col-resize",
    "context-menu",
    "crosshair",
    "e-resize",
    "ew-resize",
    "help",
    "n-resize",
    "ne-resize",
    "nesw-resize",
    "ns-resize",
    "nw-resize",
    "nwse-resize",
    "row-resize",
    "s-resize",
    "se-resize",
    "sw-resize",
    "vertical-text",
    "w-resize",
    "zoom-in",
    "zoom-out",
  ]);

  const NON_INTERACTIVE_CURSORS = new Set([
    "not-allowed",
    "no-drop",
    "wait",
    "progress",
    "initial",
    "inherit",
  ]);

  const DEFAULT_INCLUDE_ATTRIBUTES = [
    "title",
    "type",
    "checked",
    "name",
    "role",
    "value",
    "placeholder",
    "data-date-format",
    "alt",
    "aria-label",
    "aria-expanded",
    "data-state",
    "aria-checked",
    "id",
    "for",
    "target",
    "aria-haspopup",
    "aria-controls",
    "aria-owns",
    "contenteditable",
  ];

  // ============================================================================
  // State
  // ============================================================================

  let selectorMap = new Map(); // highlightIndex -> HTMLElement
  let elementTextMap = new Map(); // highlightIndex -> simplified text
  let highlightCleanupFns = [];
  let isPaused = false;
  let mask = null;

  // ============================================================================
  // Caching
  // ============================================================================

  const DOM_CACHE = {
    boundingRects: new WeakMap(),
    computedStyles: new WeakMap(),
    clientRects: new WeakMap(),
    clear() {
      this.boundingRects = new WeakMap();
      this.computedStyles = new WeakMap();
      this.clientRects = new WeakMap();
    },
  };

  function getCachedBoundingRect(element) {
    if (!element) return null;
    if (DOM_CACHE.boundingRects.has(element)) {
      return DOM_CACHE.boundingRects.get(element);
    }
    const rect = element.getBoundingClientRect();
    if (rect) DOM_CACHE.boundingRects.set(element, rect);
    return rect;
  }

  function getCachedComputedStyle(element) {
    if (!element) return null;
    if (DOM_CACHE.computedStyles.has(element)) {
      return DOM_CACHE.computedStyles.get(element);
    }
    const style = window.getComputedStyle(element);
    if (style) DOM_CACHE.computedStyles.set(element, style);
    return style;
  }

  function getCachedClientRects(element) {
    if (!element) return null;
    if (DOM_CACHE.clientRects.has(element)) {
      return DOM_CACHE.clientRects.get(element);
    }
    const rects = element.getClientRects();
    if (rects) DOM_CACHE.clientRects.set(element, rects);
    return rects;
  }

  // ============================================================================
  // Utility Functions
  // ============================================================================

  function waitFor(seconds) {
    return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  }

  function isHTMLElement(el) {
    return !!el && el.nodeType === 1;
  }

  function isInputElement(el) {
    return el?.nodeType === 1 && el.tagName === "INPUT";
  }

  function isTextAreaElement(el) {
    return el?.nodeType === 1 && el.tagName === "TEXTAREA";
  }

  function isSelectElement(el) {
    return el?.nodeType === 1 && el.tagName === "SELECT";
  }

  function isAnchorElement(el) {
    return el?.nodeType === 1 && el.tagName === "A";
  }

  function getNativeValueSetter(element) {
    return Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(element),
      "value"
    ).set;
  }

  function getIframeOffset(element) {
    const frame = element.ownerDocument.defaultView?.frameElement;
    if (!frame) return { x: 0, y: 0 };
    const rect = frame.getBoundingClientRect();
    return { x: rect.left, y: rect.top };
  }

  // ============================================================================
  // Element Visibility & Interactivity Detection
  // ============================================================================

  function isElementVisible(element) {
    const style = getCachedComputedStyle(element);
    return (
      element.offsetWidth > 0 &&
      element.offsetHeight > 0 &&
      style?.visibility !== "hidden" &&
      style?.display !== "none"
    );
  }

  function isElementAccepted(element) {
    if (!element || !element.tagName) return false;

    const alwaysAccept = new Set([
      "body",
      "div",
      "main",
      "article",
      "section",
      "nav",
      "header",
      "footer",
    ]);
    const tagName = element.tagName.toLowerCase();
    if (alwaysAccept.has(tagName)) return true;

    const denyList = new Set([
      "svg",
      "script",
      "style",
      "link",
      "meta",
      "noscript",
      "template",
    ]);
    return !denyList.has(tagName);
  }

  function isInteractiveElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;

    const tagName = element.tagName.toLowerCase();
    const style = getCachedComputedStyle(element);

    // Check cursor style
    if (style?.cursor && INTERACTIVE_CURSORS.has(style.cursor)) return true;

    // Check semantic tags
    if (INTERACTIVE_ELEMENTS.has(tagName)) {
      if (style?.cursor && NON_INTERACTIVE_CURSORS.has(style.cursor))
        return false;
      if (element.disabled || element.readOnly || element.inert) return false;
      if (element.hasAttribute("disabled") || element.hasAttribute("readonly"))
        return false;
      return true;
    }

    // Check ARIA roles
    const role = element.getAttribute("role");
    if (role && INTERACTIVE_ROLES.has(role)) return true;

    // Check contenteditable
    if (
      element.getAttribute("contenteditable") === "true" ||
      element.isContentEditable
    ) {
      return true;
    }

    // Check common interactive attributes
    if (
      element.hasAttribute("onclick") ||
      typeof element.onclick === "function"
    ) {
      return true;
    }

    // Check for dropdown patterns
    if (
      element.classList?.contains("button") ||
      element.classList?.contains("dropdown-toggle") ||
      element.getAttribute("aria-haspopup") === "true"
    ) {
      return true;
    }

    // Check scrollability
    if (isScrollableElement(element)) return true;

    return false;
  }

  function isScrollableElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;

    const style = getCachedComputedStyle(element);
    if (!style) return false;

    const display = style.display;
    if (display === "inline" || display === "inline-block") return false;

    const overflowX = style.overflowX;
    const overflowY = style.overflowY;

    const scrollableX = overflowX === "auto" || overflowX === "scroll";
    const scrollableY = overflowY === "auto" || overflowY === "scroll";

    if (!scrollableX && !scrollableY) return false;

    const scrollWidth = element.scrollWidth - element.clientWidth;
    const scrollHeight = element.scrollHeight - element.clientHeight;

    const threshold = 4;
    return scrollWidth >= threshold || scrollHeight >= threshold;
  }

  function isTopElement(element) {
    const rects = getCachedClientRects(element);
    if (!rects || rects.length === 0) return false;

    const rect = Array.from(rects).find((r) => r.width > 0 && r.height > 0);
    if (!rect) return false;

    // Check shadow DOM
    const shadowRoot = element.getRootNode();
    if (shadowRoot instanceof ShadowRoot) {
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      try {
        const topEl = shadowRoot.elementFromPoint(centerX, centerY);
        if (!topEl) return false;
        let current = topEl;
        while (current && current !== shadowRoot) {
          if (current === element) return true;
          current = current.parentElement;
        }
        return false;
      } catch (e) {
        return true;
      }
    }

    // Check multiple points
    const margin = 5;
    const checkPoints = [
      { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      { x: rect.left + margin, y: rect.top + margin },
      { x: rect.right - margin, y: rect.bottom - margin },
    ];

    return checkPoints.some(({ x, y }) => {
      try {
        const topEl = document.elementFromPoint(x, y);
        if (!topEl) return false;
        let current = topEl;
        while (current && current !== document.documentElement) {
          if (current === element) return true;
          current = current.parentElement;
        }
        return false;
      } catch (e) {
        return true;
      }
    });
  }

  // ============================================================================
  // DOM Tree Extraction & Highlighting
  // ============================================================================

  function cleanUpHighlights() {
    for (const cleanup of highlightCleanupFns) {
      if (typeof cleanup === "function") cleanup();
    }
    highlightCleanupFns = [];

    const container = document.getElementById(HIGHLIGHT_CONTAINER_ID);
    if (container) container.remove();
  }

  function highlightElement(element, index, parentIframe = null) {
    if (!element) return;

    const overlays = [];
    let label = null;
    let labelWidth = 20;
    let labelHeight = 16;

    // Create or get container
    let container = document.getElementById(HIGHLIGHT_CONTAINER_ID);
    if (!container) {
      container = document.createElement("div");
      container.id = HIGHLIGHT_CONTAINER_ID;
      container.style.cssText = `
        position: fixed;
        pointer-events: none;
        top: 0; left: 0;
        width: 100%; height: 100%;
        z-index: 2147483640;
        background-color: transparent;
      `;
      document.body.appendChild(container);
    }

    const rects = element.getClientRects();
    if (!rects || rects.length === 0) return;

    const colorIndex = index % HIGHLIGHT_COLORS.length;
    const baseColor = HIGHLIGHT_COLORS[colorIndex];
    const backgroundColor = baseColor + "1A"; // 10% opacity
    const borderColor = baseColor + "80"; // 50% opacity

    let iframeOffset = { x: 0, y: 0 };
    if (parentIframe) {
      const iframeRect = parentIframe.getBoundingClientRect();
      iframeOffset = { x: iframeRect.left, y: iframeRect.top };
    }

    const fragment = document.createDocumentFragment();

    // Create overlays
    for (const rect of rects) {
      if (rect.width === 0 || rect.height === 0) continue;

      const overlay = document.createElement("div");
      overlay.style.cssText = `
        position: fixed;
        border: 2px solid ${borderColor};
        background-color: ${backgroundColor};
        pointer-events: none;
        box-sizing: border-box;
        top: ${rect.top + iframeOffset.y}px;
        left: ${rect.left + iframeOffset.x}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
      `;
      fragment.appendChild(overlay);
      overlays.push({ element: overlay, initialRect: rect });
    }

    // Create label
    const firstRect = rects[0];
    label = document.createElement("div");
    label.className = "page-agent-highlight-label";
    label.style.cssText = `
      position: fixed;
      background: ${borderColor};
      color: white;
      padding: 1px 4px;
      border-radius: 4px;
      font-size: ${Math.min(12, Math.max(8, firstRect.height / 2))}px;
      font-family: monospace;
      z-index: 2147483641;
    `;
    label.textContent = index.toString();

    let labelTop = firstRect.top + iframeOffset.y + 2;
    let labelLeft =
      firstRect.left + iframeOffset.x + firstRect.width - labelWidth - 2;

    if (
      firstRect.width < labelWidth + 4 ||
      firstRect.height < labelHeight + 4
    ) {
      labelTop = firstRect.top + iframeOffset.y - labelHeight - 2;
      labelLeft =
        firstRect.left + iframeOffset.x + firstRect.width - labelWidth;
    }

    labelTop = Math.max(
      0,
      Math.min(labelTop, window.innerHeight - labelHeight)
    );
    labelLeft = Math.max(
      0,
      Math.min(labelLeft, window.innerWidth - labelWidth)
    );

    label.style.top = `${labelTop}px`;
    label.style.left = `${labelLeft}px`;
    fragment.appendChild(label);

    container.appendChild(fragment);

    // Update on scroll/resize
    const throttle = (fn, delay) => {
      let lastCall = 0;
      return (...args) => {
        const now = performance.now();
        if (now - lastCall < delay) return;
        lastCall = now;
        return fn(...args);
      };
    };

    const updatePositions = () => {
      const newRects = element.getClientRects();
      let newIframeOffset = { x: 0, y: 0 };
      if (parentIframe) {
        const iframeRect = parentIframe.getBoundingClientRect();
        newIframeOffset = { x: iframeRect.left, y: iframeRect.top };
      }

      overlays.forEach((overlayData, i) => {
        if (i < newRects.length) {
          const newRect = newRects[i];
          overlayData.element.style.top = `${newRect.top + newIframeOffset.y}px`;
          overlayData.element.style.left = `${newRect.left + newIframeOffset.x}px`;
          overlayData.element.style.width = `${newRect.width}px`;
          overlayData.element.style.height = `${newRect.height}px`;
          overlayData.element.style.display =
            newRect.width === 0 || newRect.height === 0 ? "none" : "block";
        } else {
          overlayData.element.style.display = "none";
        }
      });

      if (label && newRects.length > 0) {
        const firstNewRect = newRects[0];
        let newLabelTop = firstNewRect.top + newIframeOffset.y + 2;
        let newLabelLeft =
          firstNewRect.left +
          newIframeOffset.x +
          firstNewRect.width -
          labelWidth -
          2;

        if (
          firstNewRect.width < labelWidth + 4 ||
          firstNewRect.height < labelHeight + 4
        ) {
          newLabelTop = firstNewRect.top + newIframeOffset.y - labelHeight - 2;
          newLabelLeft =
            firstNewRect.left +
            newIframeOffset.x +
            firstNewRect.width -
            labelWidth;
        }

        newLabelTop = Math.max(
          0,
          Math.min(newLabelTop, window.innerHeight - labelHeight)
        );
        newLabelLeft = Math.max(
          0,
          Math.min(newLabelLeft, window.innerWidth - labelWidth)
        );

        label.style.top = `${newLabelTop}px`;
        label.style.left = `${newLabelLeft}px`;
        label.style.display = "block";
      } else if (label) {
        label.style.display = "none";
      }
    };

    const throttledUpdate = throttle(updatePositions, 16);
    window.addEventListener("scroll", throttledUpdate, true);
    window.addEventListener("resize", throttledUpdate);

    const cleanupFn = () => {
      window.removeEventListener("scroll", throttledUpdate, true);
      window.removeEventListener("resize", throttledUpdate);
      overlays.forEach((o) => o.element.remove());
      if (label) label.remove();
    };

    highlightCleanupFns.push(cleanupFn);
  }

  function buildDomTree(options = {}) {
    const {
      doHighlightElements = true,
      viewportExpansion = -1, // -1 = full page
    } = options;

    cleanUpHighlights();
    selectorMap.clear();
    elementTextMap.clear();
    DOM_CACHE.clear();

    let highlightIndex = 0;
    const DOM_HASH_MAP = {};
    const ID = { current: 0 };

    function processNode(
      node,
      parentIframe = null,
      isParentHighlighted = false
    ) {
      if (
        !node ||
        node.id === HIGHLIGHT_CONTAINER_ID ||
        node.id === MASK_CONTAINER_ID
      ) {
        return null;
      }

      if (
        node.nodeType !== Node.ELEMENT_NODE &&
        node.nodeType !== Node.TEXT_NODE
      ) {
        return null;
      }

      // Skip ignored elements
      if (
        node.dataset?.browserUseIgnore === "true" ||
        node.dataset?.pageAgentIgnore === "true"
      ) {
        return null;
      }
      if (node.getAttribute?.("aria-hidden") === "true") {
        return null;
      }

      // Handle text nodes
      if (node.nodeType === Node.TEXT_NODE) {
        const textContent = node.textContent?.trim();
        if (!textContent) return null;
        const parentElement = node.parentElement;
        if (!parentElement || parentElement.tagName?.toLowerCase() === "script")
          return null;

        const id = `${ID.current++}`;
        DOM_HASH_MAP[id] = {
          type: "TEXT_NODE",
          text: textContent,
          isVisible: true,
        };
        return id;
      }

      // Handle element nodes
      if (!isElementAccepted(node)) return null;

      const nodeData = {
        tagName: node.tagName.toLowerCase(),
        attributes: {},
        children: [],
      };

      // Collect attributes for interactive candidates
      const tagName = node.tagName.toLowerCase();
      if (INTERACTIVE_ELEMENTS.has(tagName) || tagName === "iframe") {
        const attributeNames = node.getAttributeNames?.() || [];
        for (const name of attributeNames) {
          nodeData.attributes[name] = node.getAttribute(name);
        }
        // Handle checkbox/radio checked state
        if (
          tagName === "input" &&
          (node.type === "checkbox" || node.type === "radio")
        ) {
          nodeData.attributes.checked = node.checked ? "true" : "false";
        }
      }

      let nodeWasHighlighted = false;

      if (node.nodeType === Node.ELEMENT_NODE) {
        nodeData.isVisible = isElementVisible(node);

        if (nodeData.isVisible) {
          nodeData.isTopElement = isTopElement(node);

          const role = node.getAttribute("role");
          const isMenuContainer =
            role === "menu" || role === "menubar" || role === "listbox";

          if (nodeData.isTopElement || isMenuContainer) {
            nodeData.isInteractive = isInteractiveElement(node);

            if (nodeData.isInteractive && !isParentHighlighted) {
              nodeData.highlightIndex = highlightIndex;
              selectorMap.set(highlightIndex, node);

              if (doHighlightElements) {
                highlightElement(node, highlightIndex, parentIframe);
              }

              highlightIndex++;
              nodeWasHighlighted = true;

              // Ensure attributes are collected
              if (Object.keys(nodeData.attributes).length === 0) {
                const attributeNames = node.getAttributeNames?.() || [];
                for (const name of attributeNames) {
                  nodeData.attributes[name] = node.getAttribute(name);
                }
              }
            }
          }
        }
      }

      // Process children
      if (tagName === "iframe") {
        try {
          const iframeDoc =
            node.contentDocument || node.contentWindow?.document;
          if (iframeDoc) {
            for (const child of iframeDoc.childNodes) {
              const childId = processNode(child, node, false);
              if (childId) nodeData.children.push(childId);
            }
          }
        } catch (e) {
          // Cross-origin iframe
        }
      } else {
        // Handle shadow DOM
        if (node.shadowRoot) {
          nodeData.shadowRoot = true;
          for (const child of node.shadowRoot.childNodes) {
            const childId = processNode(
              child,
              parentIframe,
              nodeWasHighlighted
            );
            if (childId) nodeData.children.push(childId);
          }
        }
        // Regular children
        for (const child of node.childNodes) {
          const passHighlight = nodeWasHighlighted || isParentHighlighted;
          const childId = processNode(child, parentIframe, passHighlight);
          if (childId) nodeData.children.push(childId);
        }
      }

      const id = `${ID.current++}`;
      DOM_HASH_MAP[id] = nodeData;
      return id;
    }

    const rootId = processNode(document.body);
    return { rootId, map: DOM_HASH_MAP };
  }

  function flatTreeToString(flatTree) {
    const result = [];

    function processNode(nodeId, depth) {
      const node = flatTree.map[nodeId];
      if (!node) return;

      const depthStr = "\t".repeat(depth);

      if (node.type === "TEXT_NODE") {
        if (node.isVisible && node.text) {
          result.push(`${depthStr}${node.text}`);
        }
        return;
      }

      if (typeof node.highlightIndex === "number") {
        let line = `${depthStr}[${node.highlightIndex}]<${node.tagName}`;

        // Add relevant attributes
        const attrs = [];
        for (const key of DEFAULT_INCLUDE_ATTRIBUTES) {
          const value = node.attributes?.[key];
          if (value && value.trim()) {
            attrs.push(`${key}=${value.substring(0, 20)}`);
          }
        }
        if (attrs.length > 0) {
          line += ` ${attrs.join(" ")}`;
        }

        // Add inner text
        const text = getNodeText(node, flatTree.map);
        if (text) {
          line += `>${text.substring(0, 50)}`;
        }

        line += " />";
        result.push(line);
        elementTextMap.set(node.highlightIndex, line);
      }

      // Process children
      if (node.children) {
        for (const childId of node.children) {
          processNode(
            childId,
            node.highlightIndex !== undefined ? depth + 1 : depth
          );
        }
      }
    }

    function getNodeText(node, map, maxDepth = 3) {
      if (maxDepth <= 0) return "";
      const texts = [];

      if (node.children) {
        for (const childId of node.children) {
          const child = map[childId];
          if (!child) continue;

          if (child.type === "TEXT_NODE" && child.text) {
            texts.push(child.text);
          } else if (child.highlightIndex === undefined) {
            // Not a highlighted element, recurse
            texts.push(getNodeText(child, map, maxDepth - 1));
          }
        }
      }

      return texts.join(" ").trim();
    }

    if (flatTree.rootId) {
      processNode(flatTree.rootId, 0);
    }

    return result.join("\n");
  }

  // ============================================================================
  // Page Info
  // ============================================================================

  function getPageInfo() {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const pageWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0
    );
    const pageHeight = Math.max(
      document.documentElement.scrollHeight,
      document.body?.scrollHeight || 0
    );
    const scrollX =
      window.scrollX ||
      window.pageXOffset ||
      document.documentElement.scrollLeft ||
      0;
    const scrollY =
      window.scrollY ||
      window.pageYOffset ||
      document.documentElement.scrollTop ||
      0;
    const pixelsBelow = Math.max(0, pageHeight - (viewportHeight + scrollY));
    const pixelsRight = Math.max(0, pageWidth - (viewportWidth + scrollX));

    return {
      viewport_width: viewportWidth,
      viewport_height: viewportHeight,
      page_width: pageWidth,
      page_height: pageHeight,
      scroll_x: scrollX,
      scroll_y: scrollY,
      pixels_above: scrollY,
      pixels_below: pixelsBelow,
      pages_above: viewportHeight > 0 ? scrollY / viewportHeight : 0,
      pages_below: viewportHeight > 0 ? pixelsBelow / viewportHeight : 0,
      total_pages: viewportHeight > 0 ? pageHeight / viewportHeight : 0,
      current_page_position: scrollY / Math.max(1, pageHeight - viewportHeight),
    };
  }

  // ============================================================================
  // Actions
  // ============================================================================

  async function scrollIntoViewIfNeeded(element) {
    if (typeof element.scrollIntoViewIfNeeded === "function") {
      element.scrollIntoViewIfNeeded();
    } else {
      element.scrollIntoView({
        behavior: "auto",
        block: "center",
        inline: "nearest",
      });
    }
  }

  async function clickElement(index) {
    const element = selectorMap.get(index);
    if (!element) {
      return { success: false, message: `Element at index ${index} not found` };
    }

    try {
      await scrollIntoViewIfNeeded(element);
      await waitFor(0.1);

      // Dispatch full click sequence
      element.dispatchEvent(
        new MouseEvent("mouseenter", { bubbles: true, cancelable: true })
      );
      element.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true, cancelable: true })
      );
      element.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true })
      );
      element.focus();
      element.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, cancelable: true })
      );
      element.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );

      await waitFor(0.2);

      const elemText = elementTextMap.get(index) || `element ${index}`;

      if (isAnchorElement(element) && element.target === "_blank") {
        return {
          success: true,
          message: `Clicked ${elemText}. Link opened in new tab.`,
        };
      }

      return { success: true, message: `Clicked ${elemText}` };
    } catch (error) {
      return { success: false, message: `Click failed: ${error}` };
    }
  }

  async function inputText(index, text) {
    const element = selectorMap.get(index);
    if (!element) {
      return { success: false, message: `Element at index ${index} not found` };
    }

    const isContentEditable = element.isContentEditable;
    if (
      !isInputElement(element) &&
      !isTextAreaElement(element) &&
      !isContentEditable
    ) {
      return {
        success: false,
        message: "Element is not an input, textarea, or contenteditable",
      };
    }

    try {
      await scrollIntoViewIfNeeded(element);
      element.focus();
      await waitFor(0.1);

      if (isContentEditable) {
        // Clear and insert for contenteditable
        element.innerText = "";
        element.dispatchEvent(
          new InputEvent("input", { bubbles: true, inputType: "deleteContent" })
        );
        element.innerText = text;
        element.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: text,
          })
        );
        element.dispatchEvent(new Event("change", { bubbles: true }));
        element.blur();
      } else {
        // Use native setter for React compatibility
        getNativeValueSetter(element).call(element, text);
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      }

      await waitFor(0.1);
      element.blur();

      const elemText = elementTextMap.get(index) || `element ${index}`;
      return { success: true, message: `Input "${text}" into ${elemText}` };
    } catch (error) {
      return { success: false, message: `Input failed: ${error}` };
    }
  }

  async function selectOption(index, optionText) {
    const element = selectorMap.get(index);
    if (!element || !isSelectElement(element)) {
      return {
        success: false,
        message: `Element at index ${index} is not a select element`,
      };
    }

    try {
      const options = Array.from(element.options);
      const option = options.find(
        (opt) => opt.textContent?.trim() === optionText.trim()
      );

      if (!option) {
        return { success: false, message: `Option "${optionText}" not found` };
      }

      element.value = option.value;
      element.dispatchEvent(new Event("change", { bubbles: true }));

      await waitFor(0.1);

      const elemText = elementTextMap.get(index) || `element ${index}`;
      return {
        success: true,
        message: `Selected "${optionText}" in ${elemText}`,
      };
    } catch (error) {
      return { success: false, message: `Select failed: ${error}` };
    }
  }

  async function scroll(direction, numPages = 1, elementIndex = null) {
    try {
      const amount = numPages * window.innerHeight;

      let dy = 0,
        dx = 0;
      switch (direction) {
        case "down":
          dy = amount;
          break;
        case "up":
          dy = -amount;
          break;
        case "right":
          dx = amount;
          break;
        case "left":
          dx = -amount;
          break;
      }

      if (elementIndex !== null) {
        const element = selectorMap.get(elementIndex);
        if (element) {
          element.scrollBy({ top: dy, left: dx, behavior: "smooth" });
          await waitFor(0.3);
          return {
            success: true,
            message: `Scrolled element ${elementIndex} ${direction}`,
          };
        }
      }

      window.scrollBy({ top: dy, left: dx, behavior: "smooth" });
      await waitFor(0.3);

      return { success: true, message: `Scrolled page ${direction}` };
    } catch (error) {
      return { success: false, message: `Scroll failed: ${error}` };
    }
  }

  // ============================================================================
  // Mask (User Takeover Blocking)
  // ============================================================================

  function createMask() {
    if (mask) return mask;

    const wrapper = document.createElement("div");
    wrapper.id = MASK_CONTAINER_ID;
    wrapper.setAttribute("data-page-agent-ignore", "true");
    wrapper.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 2147483641;
      cursor: wait;
      overflow: hidden;
      display: none;
      background: rgba(0, 0, 0, 0.1);
    `;

    // Block all events
    const blockEvent = (e) => {
      e.stopPropagation();
      e.preventDefault();
    };

    [
      "click",
      "mousedown",
      "mouseup",
      "mousemove",
      "wheel",
      "keydown",
      "keyup",
      "touchstart",
      "touchend",
      "touchmove",
    ].forEach((event) => {
      wrapper.addEventListener(event, blockEvent);
    });

    // Create AI cursor indicator
    const cursor = document.createElement("div");
    cursor.style.cssText = `
      position: absolute;
      width: 40px;
      height: 40px;
      pointer-events: none;
      z-index: 10000;
      border-radius: 50%;
      border: 3px solid rgba(57, 182, 255, 0.8);
      background: rgba(57, 182, 255, 0.2);
      transform: translate(-50%, -50%);
      left: 50%;
      top: 50%;
      transition: left 0.2s ease-out, top 0.2s ease-out;
    `;
    wrapper.appendChild(cursor);

    // Cursor movement listener
    window.addEventListener("PageAgent::MovePointerTo", (event) => {
      const { x, y } = event.detail;
      cursor.style.left = `${x}px`;
      cursor.style.top = `${y}px`;
    });

    document.body.appendChild(wrapper);

    mask = {
      element: wrapper,
      cursor: cursor,
      show() {
        wrapper.style.display = "block";
        cursor.style.left = `${window.innerWidth / 2}px`;
        cursor.style.top = `${window.innerHeight / 2}px`;
      },
      hide() {
        wrapper.style.display = "none";
      },
      dispose() {
        wrapper.remove();
        mask = null;
      },
    };

    return mask;
  }

  function showMask() {
    const m = createMask();
    m.show();
    isPaused = false;
  }

  function hideMask() {
    if (mask) {
      mask.hide();
    }
    isPaused = true;
  }

  // ============================================================================
  // Main API
  // ============================================================================

  function getBrowserState() {
    const flatTree = buildDomTree({ doHighlightElements: true });
    const content = flatTreeToString(flatTree);
    const pi = getPageInfo();

    const url = window.location.href;
    const title = document.title;

    const titleLine = `Current Page: [${title}](${url})`;
    const pageInfoLine = `Page info: ${pi.viewport_width}x${pi.viewport_height}px viewport, ${pi.page_width}x${pi.page_height}px total, ${pi.pages_above.toFixed(1)} pages above, ${pi.pages_below.toFixed(1)} pages below`;

    const hasContentAbove = pi.pixels_above > 4;
    const scrollHintAbove = hasContentAbove
      ? `... ${pi.pixels_above} pixels above (${pi.pages_above.toFixed(1)} pages) - scroll to see more ...`
      : "[Start of page]";

    const hasContentBelow = pi.pixels_below > 4;
    const scrollHintBelow = hasContentBelow
      ? `... ${pi.pixels_below} pixels below (${pi.pages_below.toFixed(1)} pages) - scroll to see more ...`
      : "[End of page]";

    const header = `${titleLine}\n${pageInfoLine}\n\nInteractive elements:\n\n${scrollHintAbove}`;

    return {
      url,
      title,
      header,
      content,
      footer: scrollHintBelow,
    };
  }

  // ============================================================================
  // Expose API
  // ============================================================================

  window.__PAGE_AGENT__ = {
    // State
    getBrowserState,
    cleanUpHighlights,

    // Actions
    clickElement,
    inputText,
    selectOption,
    scroll,

    // Mask
    showMask,
    hideMask,
    isPaused: () => isPaused,

    // Utils
    getPageInfo,

    // Version
    version: "1.0.0",
  };

  // Listen for URL changes to clean up highlights
  window.addEventListener("popstate", cleanUpHighlights);
  window.addEventListener("hashchange", cleanUpHighlights);
  window.addEventListener("beforeunload", cleanUpHighlights);

  // Navigation API if available
  if (
    window.navigation &&
    typeof window.navigation.addEventListener === "function"
  ) {
    window.navigation.addEventListener("navigate", cleanUpHighlights);
  }

  console.log("[PageAgent] Initialized");
})();
