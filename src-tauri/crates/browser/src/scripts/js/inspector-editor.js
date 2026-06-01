// Element Inspector - DOM Editor CRUD, undo/redo, style wrapper
// Depends on: inspector-core.js, inspector-element-info.js, inspector-dom-tree.js

// Undo/Redo History
const undoStack = [];
const redoStack = [];
const MAX_HISTORY = 100;

// Record a mutation for undo
const recordMutation = (type, data) => {
  undoStack.push({ type, data, timestamp: Date.now() });
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0; // Clear redo on new action
};

// Insert a new element
window.__ORGII_INSERT_ELEMENT__ = function (
  parentXpath,
  position,
  tagName,
  attributes
) {
  try {
    const parent = getElementByXPath(parentXpath);
    if (!parent) {
      console.error("[Orgii DOM Editor] Parent not found:", parentXpath);
      return null;
    }

    const newElement = document.createElement(tagName);

    // Apply attributes
    if (attributes) {
      for (const [key, value] of Object.entries(attributes)) {
        if (key === "className") {
          newElement.className = value;
        } else if (key === "textContent") {
          newElement.textContent = value;
        } else if (key === "innerHTML") {
          newElement.innerHTML = value;
        } else if (key === "style" && typeof value === "object") {
          Object.assign(newElement.style, value);
        } else {
          newElement.setAttribute(key, value);
        }
      }
    }

    // Insert at position
    switch (position) {
      case "prepend":
        parent.prepend(newElement);
        break;
      case "append":
        parent.append(newElement);
        break;
      case "before":
        parent.before(newElement);
        break;
      case "after":
        parent.after(newElement);
        break;
      default:
        parent.append(newElement);
    }

    const newXpath = getXPath(newElement);

    // Record for undo
    recordMutation("insert", {
      xpath: newXpath,
      parentXpath: parentXpath,
      position: position,
    });
    return newXpath;
  } catch (e) {
    console.error("[Orgii DOM Editor] Insert failed:", e);
    return null;
  }
};

// Insert HTML string (for component templates)
window.__ORGII_INSERT_HTML__ = function (parentXpath, position, html) {
  try {
    const parent = getElementByXPath(parentXpath);
    if (!parent) {
      console.error("[Orgii DOM Editor] Parent not found:", parentXpath);
      return null;
    }

    // Create a temporary container to parse the HTML
    const temp = document.createElement("div");
    temp.innerHTML = html;

    // Get the first element (or create wrapper if multiple)
    let newElement;
    if (temp.children.length === 1) {
      newElement = temp.firstElementChild;
    } else if (temp.children.length > 1) {
      // Wrap multiple elements in a div
      newElement = temp;
      newElement.className = "component-wrapper";
    } else {
      console.error("[Orgii DOM Editor] No valid HTML elements in template");
      return null;
    }

    // Insert at position
    switch (position) {
      case "prepend":
        parent.prepend(newElement);
        break;
      case "append":
        parent.append(newElement);
        break;
      case "before":
        parent.before(newElement);
        break;
      case "after":
        parent.after(newElement);
        break;
      default:
        parent.append(newElement);
    }

    const newXpath = getXPath(newElement);

    // Record for undo
    recordMutation("insert", {
      xpath: newXpath,
      parentXpath: parentXpath,
      position: position,
    });
    return newXpath;
  } catch (e) {
    console.error("[Orgii DOM Editor] Insert HTML failed:", e);
    return null;
  }
};

// Delete an element
window.__ORGII_DELETE_ELEMENT__ = function (xpath) {
  try {
    const element = getElementByXPath(xpath);
    if (!element) {
      console.error("[Orgii DOM Editor] Element not found:", xpath);
      return false;
    }

    if (element === document.body || element === document.documentElement) {
      console.error("[Orgii DOM Editor] Cannot delete body or html");
      return false;
    }

    // Store for undo
    const parentXpath = getXPath(element.parentElement);
    const index = Array.from(element.parentElement.children).indexOf(element);
    const html = element.outerHTML;

    recordMutation("delete", {
      xpath: xpath,
      parentXpath: parentXpath,
      index: index,
      html: html,
    });

    // Clear selection if deleting selected element
    if (element === selectedElement) {
      selectedElement = null;
      window.__ORGII_SELECTED_ELEMENT_INFO__ = null;
      selectedOverlay.style.display = "none";
    }

    element.remove();
    return true;
  } catch (e) {
    console.error("[Orgii DOM Editor] Delete failed:", e);
    return false;
  }
};

// Update element attributes
window.__ORGII_UPDATE_ELEMENT__ = function (xpath, attributes) {
  try {
    const element = getElementByXPath(xpath);
    if (!element) {
      console.error("[Orgii DOM Editor] Element not found:", xpath);
      return false;
    }

    // Store old values for undo
    const oldValues = {};
    for (const key of Object.keys(attributes)) {
      if (key === "className") {
        oldValues[key] = element.className;
      } else if (key === "textContent") {
        oldValues[key] = element.textContent;
      } else if (key === "innerHTML") {
        oldValues[key] = element.innerHTML;
      } else {
        oldValues[key] = element.getAttribute(key);
      }
    }

    recordMutation("update", {
      xpath: xpath,
      oldValues: oldValues,
      newValues: attributes,
    });

    // Apply new values
    for (const [key, value] of Object.entries(attributes)) {
      if (value === null) {
        element.removeAttribute(key);
      } else if (key === "className") {
        element.className = value;
      } else if (key === "textContent") {
        element.textContent = value;
      } else if (key === "innerHTML") {
        element.innerHTML = value;
      } else {
        element.setAttribute(key, value);
      }
    }

    // Update selection overlay if needed
    if (element === selectedElement) {
      positionOverlay(selectedOverlay, element);
      window.__ORGII_SELECTED_ELEMENT_INFO__ = getElementInfo(element);
    }
    return true;
  } catch (e) {
    console.error("[Orgii DOM Editor] Update failed:", e);
    return false;
  }
};

// Clone an element
window.__ORGII_CLONE_ELEMENT__ = function (xpath, deep) {
  try {
    const element = getElementByXPath(xpath);
    if (!element) {
      console.error("[Orgii DOM Editor] Element not found:", xpath);
      return null;
    }

    const clone = element.cloneNode(deep !== false);
    element.after(clone);

    const cloneXpath = getXPath(clone);

    recordMutation("clone", {
      sourceXpath: xpath,
      cloneXpath: cloneXpath,
    });
    return cloneXpath;
  } catch (e) {
    console.error("[Orgii DOM Editor] Clone failed:", e);
    return null;
  }
};

// Move an element (expose internal moveElement)
window.__ORGII_MOVE_ELEMENT__ = function (sourceXpath, targetXpath, position) {
  try {
    const source = getElementByXPath(sourceXpath);
    const target = getElementByXPath(targetXpath);

    if (!source || !target) {
      console.error("[Orgii DOM Editor] Source or target not found");
      return false;
    }

    // Store original position for undo
    const originalParentXpath = getXPath(source.parentElement);
    const originalIndex = Array.from(source.parentElement.children).indexOf(
      source
    );

    recordMutation("move", {
      sourceXpath: sourceXpath,
      targetXpath: targetXpath,
      position: position,
      originalParentXpath: originalParentXpath,
      originalIndex: originalIndex,
    });

    // Use existing moveElement function
    const success = moveElement(source, target, position);

    return success;
  } catch (e) {
    console.error("[Orgii DOM Editor] Move failed:", e);
    return false;
  }
};

// Undo last operation
window.__ORGII_UNDO__ = function () {
  if (undoStack.length === 0) {
    return false;
  }

  const mutation = undoStack.pop();

  try {
    switch (mutation.type) {
      case "insert": {
        // Remove the inserted element
        const inserted = getElementByXPath(mutation.data.xpath);
        if (inserted) inserted.remove();
        break;
      }
      case "delete": {
        // Re-insert the deleted element
        const parent = getElementByXPath(mutation.data.parentXpath);
        if (parent) {
          const temp = document.createElement("div");
          temp.innerHTML = mutation.data.html;
          const restored = temp.firstElementChild;
          if (restored) {
            if (mutation.data.index >= parent.children.length) {
              parent.appendChild(restored);
            } else {
              parent.insertBefore(
                restored,
                parent.children[mutation.data.index]
              );
            }
          }
        }
        break;
      }
      case "update": {
        // Restore old values
        const el = getElementByXPath(mutation.data.xpath);
        if (el) {
          for (const [key, value] of Object.entries(mutation.data.oldValues)) {
            if (value === null) {
              el.removeAttribute(key);
            } else if (key === "className") {
              el.className = value;
            } else if (key === "textContent") {
              el.textContent = value;
            } else if (key === "innerHTML") {
              el.innerHTML = value;
            } else {
              el.setAttribute(key, value);
            }
          }
        }
        break;
      }
      case "clone": {
        // Remove the clone
        const clone = getElementByXPath(mutation.data.cloneXpath);
        if (clone) clone.remove();
        break;
      }
      case "move": {
        // Move back to original position
        const source = getElementByXPath(mutation.data.sourceXpath);
        const originalParent = getElementByXPath(
          mutation.data.originalParentXpath
        );
        if (source && originalParent) {
          if (mutation.data.originalIndex >= originalParent.children.length) {
            originalParent.appendChild(source);
          } else {
            originalParent.insertBefore(
              source,
              originalParent.children[mutation.data.originalIndex]
            );
          }
        }
        break;
      }
      case "style": {
        // Restore previous style
        const el = getElementByXPath(mutation.data.xpath);
        if (el) {
          el.style.setProperty(
            mutation.data.property,
            mutation.data.oldValue || ""
          );
        }
        break;
      }
    }

    redoStack.push(mutation);
    return true;
  } catch (e) {
    console.error("[Orgii DOM Editor] Undo failed:", e);
    return false;
  }
};

// Redo last undone operation
window.__ORGII_REDO__ = function () {
  if (redoStack.length === 0) {
    return false;
  }

  const mutation = redoStack.pop();

  try {
    switch (mutation.type) {
      case "insert": {
        // Re-insert (we can't easily recreate, but the xpath should help)
        console.warn("[Orgii DOM Editor] Redo insert not fully supported");
        break;
      }
      case "delete": {
        // Re-delete
        const el = getElementByXPath(mutation.data.xpath);
        if (el) el.remove();
        break;
      }
      case "update": {
        // Re-apply new values
        const el = getElementByXPath(mutation.data.xpath);
        if (el) {
          for (const [key, value] of Object.entries(mutation.data.newValues)) {
            if (value === null) {
              el.removeAttribute(key);
            } else if (key === "className") {
              el.className = value;
            } else if (key === "textContent") {
              el.textContent = value;
            } else if (key === "innerHTML") {
              el.innerHTML = value;
            } else {
              el.setAttribute(key, value);
            }
          }
        }
        break;
      }
      case "clone": {
        // Re-clone
        const source = getElementByXPath(mutation.data.sourceXpath);
        if (source) {
          const clone = source.cloneNode(true);
          source.after(clone);
        }
        break;
      }
      case "move": {
        // Re-move
        const source = getElementByXPath(mutation.data.sourceXpath);
        const target = getElementByXPath(mutation.data.targetXpath);
        if (source && target) {
          moveElement(source, target, mutation.data.position);
        }
        break;
      }
      case "style": {
        // Re-apply style
        const el = getElementByXPath(mutation.data.xpath);
        if (el) {
          el.style.setProperty(mutation.data.property, mutation.data.newValue);
        }
        break;
      }
    }

    undoStack.push(mutation);
    return true;
  } catch (e) {
    console.error("[Orgii DOM Editor] Redo failed:", e);
    return false;
  }
};

// Get undo/redo stack sizes
window.__ORGII_GET_HISTORY_STATE__ = function () {
  return JSON.stringify({
    undoCount: undoStack.length,
    redoCount: redoStack.length,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
  });
};

// Serialize DOM to HTML
window.__ORGII_SERIALIZE_TO_HTML__ = function (xpath) {
  try {
    const rootXpath = xpath || "/html/body";
    const element = getElementByXPath(rootXpath);
    if (!element) {
      console.error(
        "[Orgii DOM Editor] Element not found for serialization:",
        rootXpath
      );
      return "";
    }
    return element.outerHTML;
  } catch (e) {
    console.error("[Orgii DOM Editor] Serialization failed:", e);
    return "";
  }
};

// Wrap existing set_element_style to record for undo
window.__ORGII_SET_ELEMENT_STYLE__ = function (xpath, property, value) {
  try {
    const element = getElementByXPath(xpath);
    if (!element) return false;

    // Get old value for undo
    const cssProperty = property.replace(/([A-Z])/g, "-$1").toLowerCase();
    const oldValue = element.style.getPropertyValue(cssProperty) || "";

    recordMutation("style", {
      xpath: xpath,
      property: cssProperty,
      oldValue: oldValue,
      newValue: value,
    });

    // Apply new style
    element.style.setProperty(cssProperty, value);

    // Update selection overlay if needed
    if (element === selectedElement) {
      positionOverlay(selectedOverlay, element);
      window.__ORGII_SELECTED_ELEMENT_INFO__ = getElementInfo(element);
    }
    return true;
  } catch (e) {
    console.error("[Orgii DOM Editor] Failed to set style:", e);
    return false;
  }
};
