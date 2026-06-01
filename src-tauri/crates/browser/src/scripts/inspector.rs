//! Element Inspector Script
//!
//! Provides Chrome DevTools-like element inspection:
//! - Hover highlighting with element info overlay
//! - Click to select/lock element
//! - Drag-to-reorder elements (visual only, resets on refresh)
//! - Stores selected element info for retrieval
//! - DOM tree export for React panel
//! - Bidirectional selection (React ↔ Webview)
//! - Live style editing
//!
//! Implementation is split under [`js/`](js/) and assembled at compile time via [`include_str!`].

/// JavaScript for element inspection in webviews
///
/// Provides Chrome DevTools-like element inspection:
/// - Hover highlighting with element info overlay
/// - Click to select/lock element
/// - Drag-to-reorder elements within the page
/// - Stores selected element info for retrieval
/// - DOM tree export for React panel (get_webview_dom_tree)
/// - Highlight/select by xpath (from React panel)
/// - Live CSS editing (set_element_style)
/// - Full computed styles export
pub const ELEMENT_INSPECTOR_SCRIPT: &str = concat!(
    "(function() {\n",
    "    if (window.__ORGII_ELEMENT_INSPECTOR__) return;\n",
    "    window.__ORGII_ELEMENT_INSPECTOR__ = true;\n\n",
    include_str!("js/inspector-core.js"),
    "\n",
    include_str!("js/inspector-source-loc.js"),
    "\n",
    include_str!("js/inspector-element-info.js"),
    "\n",
    include_str!("js/inspector-drag.js"),
    "\n",
    include_str!("js/inspector-mode.js"),
    "\n",
    include_str!("js/inspector-dom-tree.js"),
    "\n",
    include_str!("js/inspector-editor.js"),
    "\n",
    include_str!("js/inspector-multi-select.js"),
    "\n",
    "})();\n",
);

#[cfg(test)]
#[path = "tests/inspector_tests.rs"]
mod tests;
