// Element Inspector - Source Location Detection
// Provides DOM-to-Source mapping for React, Vue, Svelte, and styled-components

// Get source location from multiple detection methods
const getSourceLocation = (el) => {
  if (!el) return null;

  // Method 1: code-inspector's data-insp-path attribute (highest priority)
  const inspPath = el.getAttribute && el.getAttribute("data-insp-path");
  if (inspPath) {
    try {
      const segments = inspPath.split(":");
      if (segments.length >= 4) {
        const name = segments[segments.length - 1];
        const column = Number(segments[segments.length - 2]);
        const line = Number(segments[segments.length - 3]);
        const path = segments.slice(0, segments.length - 3).join(":");
        return {
          method: "code-inspector",
          path: path,
          line: line,
          column: column,
          componentName: name || null,
          componentStack: null,
          searchHint: null,
        };
      }
    } catch (e) {
      console.warn("[Orgii Inspector] Failed to parse data-insp-path:", e);
    }
  }

  // Method 2: Check common debug data attributes
  const debugAttrSource = getDebugAttributeSource(el);
  if (debugAttrSource && debugAttrSource.path) {
    return {
      method: "debug-attr",
      ...debugAttrSource,
    };
  }

  // Method 3: React fiber _debugSource
  const reactSource = getReactFiberSource(el);
  if (reactSource) {
    return {
      method: "react-fiber",
      ...reactSource,
    };
  }

  // Method 4: Vue __file (for Vue SFC)
  const vueSource = getVueComponentSource(el);
  if (vueSource) {
    return {
      method: "vue-file",
      ...vueSource,
    };
  }

  // Method 5: Svelte component source
  const svelteSource = getSvelteComponentSource(el);
  if (svelteSource) {
    return {
      method: "svelte",
      ...svelteSource,
    };
  }

  // Method 6: styled-components / emotion
  const styledSource = getStyledComponentSource(el);
  if (styledSource) {
    return {
      method: "styled",
      ...styledSource,
    };
  }

  return null;
};

// Check for common debug data attributes
const getDebugAttributeSource = (el) => {
  if (!el.getAttribute) return null;

  // Common debug attribute patterns
  const debugAttrs = [
    // click-to-component, react-dev-inspector
    "data-click-to-component-source",
    "data-source",
    "data-source-file",
    "data-file",
    // locatorjs
    "data-locatorjs",
    // custom patterns
    "data-debug-source",
    "data-component-source",
  ];

  for (const attr of debugAttrs) {
    const value = el.getAttribute(attr);
    if (value) {
      // Try to parse "file:line:column" or "file:line" or just "file"
      const parts = value.split(":");
      if (parts.length >= 1) {
        // Handle Windows paths (C:\...)
        let path,
          line = 1,
          column = 0;
        if (parts[0].length === 1 && parts.length >= 2) {
          // Windows path like C:\path\file.tsx:10:5
          path = parts[0] + ":" + parts[1];
          line = parseInt(parts[2], 10) || 1;
          column = parseInt(parts[3], 10) || 0;
        } else {
          path = parts[0];
          line = parseInt(parts[1], 10) || 1;
          column = parseInt(parts[2], 10) || 0;
        }
        return {
          path: path,
          line: line,
          column: column,
          componentName: null,
          componentStack: null,
          searchHint: null,
        };
      }
    }
  }

  return null;
};

// React fiber source extraction (enhanced)
const getReactFiberSource = (el) => {
  try {
    // Find React fiber key
    const fiberKey = Object.keys(el).find(
      (key) =>
        key.startsWith("__reactFiber") ||
        key.startsWith("__reactInternalInstance")
    );

    if (!fiberKey) return null;

    let fiber = el[fiberKey];
    let source = null;
    let componentName = null;
    let componentStack = [];
    let searchHint = null;

    // Walk up the fiber tree (go deeper to find source)
    let depth = 0;
    while (fiber && depth < 50) {
      depth++;

      // Get _debugSource (injected by babel jsx-source plugin)
      if (!source && fiber._debugSource) {
        source = {
          path: fiber._debugSource.fileName,
          line: fiber._debugSource.lineNumber,
          column: fiber._debugSource.columnNumber || 0,
        };
      }

      // Alternative: Check elementType._payload for lazy components
      if (!source && fiber.elementType && fiber.elementType._payload) {
        const payload = fiber.elementType._payload;
        if (payload._debugSource) {
          source = {
            path: payload._debugSource.fileName,
            line: payload._debugSource.lineNumber,
            column: payload._debugSource.columnNumber || 0,
          };
        }
      }

      // Alternative: Check type.__source (some bundlers add this)
      if (!source && fiber.type && fiber.type.__source) {
        source = {
          path: fiber.type.__source.fileName || fiber.type.__source.file,
          line: fiber.type.__source.lineNumber || fiber.type.__source.line || 1,
          column: fiber.type.__source.columnNumber || 0,
        };
      }

      // Alternative: Check for __NEXT_DATA__ style source maps
      if (!source && fiber.type && fiber.type.__module) {
        source = {
          path: fiber.type.__module,
          line: 1,
          column: 0,
        };
      }

      // Get component name from various sources
      if (fiber.type) {
        let name = null;

        // Standard function/class component
        if (typeof fiber.type === "function") {
          name = fiber.type.displayName || fiber.type.name;
        }
        // Memo wrapped
        else if (fiber.type.$$typeof && fiber.type.type) {
          const inner = fiber.type.type;
          name = inner.displayName || inner.name;
        }
        // ForwardRef
        else if (fiber.type.render) {
          name =
            fiber.type.displayName ||
            fiber.type.render.displayName ||
            fiber.type.render.name;
        }

        if (name && typeof name === "string" && !name.startsWith("_")) {
          if (!componentName) componentName = name;

          // Build search hint from component name
          if (!searchHint && name.length > 2) {
            // Convert PascalCase to potential file patterns
            searchHint = name;
          }

          componentStack.push({
            name: name,
            source: fiber._debugSource
              ? {
                  path: fiber._debugSource.fileName,
                  line: fiber._debugSource.lineNumber,
                }
              : null,
          });
        }
      }

      // Try multiple paths up the tree
      fiber = fiber._debugOwner || fiber.return;
      if (componentStack.length > 15) break;
    }

    // If we still don't have source, try to extract from function toString
    // Some bundlers include source map comments
    if (!source && componentName) {
      source = tryExtractSourceFromFunction(fiber);
    }

    if (!source && !componentName) return null;

    return {
      path: source ? source.path : null,
      line: source ? source.line : null,
      column: source ? source.column : null,
      componentName: componentName,
      componentStack: componentStack.slice(0, 8),
      searchHint: searchHint,
    };
  } catch (e) {
    return null;
  }
};

// Try to extract source from function definition or React DevTools
const tryExtractSourceFromFunction = (fiber) => {
  try {
    // Method 1: Check React DevTools global hook
    const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (hook && hook.renderers) {
      // DevTools might have source info we can access
      for (const [, renderer] of hook.renderers) {
        if (renderer.findFiberByHostInstance) {
          // This is a React renderer
          try {
            const owner = renderer.currentDispatcherRef;
            if (owner && owner.current && owner.current._debugSource) {
              return {
                path: owner.current._debugSource.fileName,
                line: owner.current._debugSource.lineNumber,
                column: 0,
              };
            }
          } catch (e) {}
        }
      }
    }

    // Method 2: Parse function toString for source hints
    // Vite adds comments like /* @__PURE__ */ or source URLs
    if (fiber.type && typeof fiber.type === "function") {
      const funcString = fiber.type.toString();

      // Look for sourceURL comment
      const sourceUrlMatch = funcString.match(/\/\/[#@]\s*sourceURL=([^\s]+)/);
      if (sourceUrlMatch) {
        return {
          path: sourceUrlMatch[1],
          line: 1,
          column: 0,
        };
      }

      // Look for sourceMappingURL
      const sourceMappingMatch = funcString.match(
        /\/\/[#@]\s*sourceMappingURL=([^\s]+)/
      );
      if (sourceMappingMatch) {
        // This is a source map URL, not the actual source
        // But we can extract the base path
        const mapUrl = sourceMappingMatch[1];
        if (mapUrl.endsWith(".map")) {
          return {
            path: mapUrl.replace(".map", ""),
            line: 1,
            column: 0,
          };
        }
      }
    }

    return null;
  } catch (e) {
    return null;
  }
};

// styled-components / emotion source extraction
const getStyledComponentSource = (el) => {
  try {
    // Check for styled-components class pattern
    const className = el.className;
    if (typeof className !== "string") return null;

    // styled-components: sc-* classes contain component info
    const scMatch = className.match(/sc-([a-zA-Z0-9_-]+)/);
    if (scMatch) {
      return {
        path: null,
        line: null,
        column: null,
        componentName: scMatch[1],
        componentStack: null,
        searchHint: scMatch[1],
      };
    }

    // emotion: css-* or e* classes
    const emotionMatch = className.match(/css-([a-zA-Z0-9]+)/);
    if (emotionMatch) {
      // Emotion doesn't expose component name in class
      return null;
    }

    return null;
  } catch (e) {
    return null;
  }
};

// Vue component source extraction
const getVueComponentSource = (el) => {
  try {
    // Vue 3: __vueParentComponent
    let vnode = el.__vueParentComponent;
    while (vnode) {
      const component = vnode.type;
      if (component && component.__file) {
        return {
          path: component.__file,
          line: 1, // Vue SFC doesn't provide line numbers by default
          column: 0,
          componentName: component.name || component.__name || null,
          componentStack: null,
        };
      }
      vnode = vnode.parent;
    }

    // Vue 2: __vue__
    if (el.__vue__) {
      const vm = el.__vue__;
      if (vm.$options && vm.$options.__file) {
        return {
          path: vm.$options.__file,
          line: 1,
          column: 0,
          componentName: vm.$options.name || null,
          componentStack: null,
        };
      }
    }

    return null;
  } catch (e) {
    return null;
  }
};

// Svelte component source extraction
const getSvelteComponentSource = (el) => {
  try {
    // Svelte 4/5: Check for $$
    if (el.$$ && el.$$.ctx) {
      // Svelte doesn't expose file path by default
      // Check for dev mode annotations
      const ctor = el.constructor;
      if (ctor && ctor.__svelte_component_file) {
        return {
          path: ctor.__svelte_component_file,
          line: 1,
          column: 0,
          componentName: ctor.name || null,
          componentStack: null,
        };
      }
    }

    // Check for svelte-inspector data attributes
    const svelteFile = el.getAttribute && el.getAttribute("data-svelte-file");
    if (svelteFile) {
      const svelteLine = parseInt(
        el.getAttribute("data-svelte-line") || "1",
        10
      );
      return {
        path: svelteFile,
        line: svelteLine,
        column: 0,
        componentName: null,
        componentStack: null,
      };
    }

    return null;
  } catch (e) {
    return null;
  }
};
