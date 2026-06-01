//! Shared types for the browser module.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Console log entry from webview.
///
/// Captured by the injected console capture script and retrieved
/// via `get_webview_console_logs`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsoleLogEntry {
    /// Log level: "log", "warn", "error", "info", "debug", "trace"
    pub level: String,
    /// The log message (concatenated arguments)
    pub message: String,
    /// Unix timestamp in milliseconds
    pub timestamp: i64,
    /// URL where the log was generated
    pub url: String,
    /// Stack trace (for errors and traces)
    pub stack: Option<String>,
}

/// Network log entry from webview.
///
/// Captured by the injected network capture script and retrieved
/// via `get_webview_network_logs`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkLogEntry {
    /// Unique request ID
    pub id: String,
    /// Request type: "fetch" or "xhr"
    #[serde(rename = "type")]
    pub request_type: String,
    /// HTTP method: "GET", "POST", etc.
    pub method: String,
    /// Request URL
    pub url: String,
    /// Start time (Unix timestamp in ms)
    #[serde(rename = "startTime")]
    pub start_time: i64,
    /// HTTP status code (if completed)
    pub status: Option<i32>,
    /// Duration in milliseconds (if completed)
    pub duration: Option<i64>,
    /// Response size from Content-Length header
    pub size: Option<String>,
    /// Error message (if failed)
    pub error: Option<String>,
}

/// Cookie information returned from native cookie store.
///
/// Includes HttpOnly cookies that JavaScript cannot access.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CookieInfo {
    /// Cookie name
    pub name: String,
    /// Cookie value
    pub value: String,
    /// Domain the cookie is valid for
    pub domain: Option<String>,
    /// Path the cookie is valid for
    pub path: Option<String>,
    /// Whether the cookie is HttpOnly (inaccessible to JS)
    pub http_only: bool,
    /// Whether the cookie requires HTTPS
    pub secure: bool,
    /// Expiration timestamp (Unix time)
    pub expires: Option<i64>,
    /// SameSite attribute
    pub same_site: Option<String>,
}

/// Element bounding rect.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ElementRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// Computed style subset for an element.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElementComputedStyle {
    pub display: Option<String>,
    pub position: Option<String>,
    pub color: Option<String>,
    pub background_color: Option<String>,
    pub font_size: Option<String>,
    pub font_family: Option<String>,
}

// ============================================
// Source Location Types (for DOM-to-Source mapping)
// ============================================

/// Simple source location (path and line only)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleSourceLocation {
    /// File path
    pub path: String,
    /// Line number (1-indexed)
    pub line: u32,
}

/// Component stack entry (for React component hierarchy)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentStackEntry {
    /// Component name
    pub name: String,
    /// Source location (if available)
    pub source: Option<SimpleSourceLocation>,
}

/// Source location information for an element.
///
/// Detected from various methods:
/// - code-inspector: Uses data-insp-path attribute
/// - debug-attr: Uses common debug data attributes
/// - react-fiber: Uses React's _debugSource from JSX transform
/// - vue-file: Uses Vue's __file property on components
/// - svelte: Uses Svelte inspector annotations
/// - styled: Uses styled-components/emotion class patterns
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceLocation {
    /// Detection method used ("code-inspector", "debug-attr", "react-fiber", "vue-file", "svelte", "styled")
    pub method: String,
    /// File path (may be absolute or relative)
    pub path: Option<String>,
    /// Line number (1-indexed)
    pub line: Option<u32>,
    /// Column number (0-indexed)
    pub column: Option<u32>,
    /// Component name (if detected)
    pub component_name: Option<String>,
    /// Component stack (for React - shows component hierarchy)
    pub component_stack: Option<Vec<ComponentStackEntry>>,
    /// Search hint for finding the file (component name or pattern)
    pub search_hint: Option<String>,
}

/// Information about a selected/inspected element.
///
/// Captured by the element inspector script and retrieved
/// via `get_selected_element_info`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElementInfo {
    /// HTML tag name (lowercase)
    pub tag_name: String,
    /// CSS selector representation (tag#id.class)
    pub selector: String,
    /// Element ID attribute
    pub id: Option<String>,
    /// Element class attribute
    pub class_name: Option<String>,
    /// Important attributes (id, class, href, src, etc.)
    pub attributes: HashMap<String, String>,
    /// Inner text content (truncated)
    pub inner_text: String,
    /// Inner HTML (truncated)
    #[serde(rename = "innerHTML")]
    pub inner_html: String,
    /// Bounding rectangle
    pub rect: ElementRect,
    /// Computed style subset
    pub computed_style: ElementComputedStyle,
    /// ARIA role or tag name
    pub role: String,
    /// XPath to element
    pub xpath: String,
    /// Source code location (if detected)
    pub source_location: Option<SourceLocation>,
}

// ============================================
// DOM Tree Types (for React inspector panel)
// ============================================

/// A node in the DOM tree.
///
/// Used to represent the DOM hierarchy for the React inspector panel.
/// Each node contains basic info and its children.
///
/// `node_kind` distinguishes real elements from synthetic boundary markers
/// (`shadow-root`, `iframe-document`) that the JS walker inserts when it
/// crosses into an open Shadow DOM or a same-origin iframe.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DOMTreeNode {
    /// HTML tag name (lowercase), or `#shadow-root` / `#document` for pseudo-nodes
    pub tag_name: String,
    /// Element ID attribute
    pub id: Option<String>,
    /// Element class attribute (space-separated)
    pub class_name: Option<String>,
    /// XPath to this element (pseudo-nodes carry synthetic `__shadow__` / `__iframedoc__` suffixes)
    pub xpath: String,
    /// Bounding rectangle
    pub rect: ElementRect,
    /// Number of child elements
    pub child_count: usize,
    /// Child nodes (recursive)
    pub children: Vec<DOMTreeNode>,
    /// `"element"` (default), `"shadow-root"`, or `"iframe-document"`.
    /// Optional for forward/backward compatibility with older JS.
    #[serde(default)]
    pub node_kind: Option<String>,
}

/// Full computed styles for an element.
///
/// Contains comprehensive style information for the Design/CSS panels.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FullComputedStyles {
    // Box model
    pub width: String,
    pub height: String,
    pub padding_top: String,
    pub padding_right: String,
    pub padding_bottom: String,
    pub padding_left: String,
    pub margin_top: String,
    pub margin_right: String,
    pub margin_bottom: String,
    pub margin_left: String,
    pub border_top_width: String,
    pub border_right_width: String,
    pub border_bottom_width: String,
    pub border_left_width: String,

    // Position
    pub position: String,
    pub top: String,
    pub right: String,
    pub bottom: String,
    pub left: String,
    pub z_index: String,

    // Layout
    pub display: String,
    pub flex_direction: String,
    pub justify_content: String,
    pub align_items: String,
    pub align_content: String,
    pub flex_wrap: String,
    pub gap: String,
    pub grid_template_columns: String,
    pub grid_template_rows: String,

    // Typography
    pub font_size: String,
    pub font_weight: String,
    pub font_family: String,
    pub line_height: String,
    pub letter_spacing: String,
    pub text_align: String,
    pub text_decoration: String,
    pub color: String,

    // Background & Borders
    pub background_color: String,
    pub background_image: String,
    pub border_radius: String,
    pub border_top_left_radius: String,
    pub border_top_right_radius: String,
    pub border_bottom_left_radius: String,
    pub border_bottom_right_radius: String,
    pub border_color: String,
    pub border_style: String,
    pub box_shadow: String,

    // Effects
    pub opacity: String,
    pub overflow: String,
    pub overflow_x: String,
    pub overflow_y: String,
    pub transform: String,
    pub transition: String,
    pub cursor: String,
    pub visibility: String,

    // Computed rect (actual position on screen)
    pub rect: ElementRect,
}
