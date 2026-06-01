//! DOM Editor Commands
//!
//! Provides CRUD operations for DOM manipulation in webviews.
//! This enables DOM-based design editing as an alternative to custom canvas rendering.
//!
//! ## Operations
//! - Insert: Add new elements to the DOM
//! - Delete: Remove elements from the DOM
//! - Update: Modify element attributes
//! - Clone: Duplicate elements
//! - Move: Reorder elements in the DOM tree
//! - Undo/Redo: History management for all operations
//! - Serialize: Export DOM to HTML

use tauri::{AppHandle, Manager};

use super::logging::eval_js_with_result;

// ============================================
// Element CRUD Commands
// ============================================

/// Insert a new element into the DOM.
///
/// Creates a new element with the specified tag and attributes,
/// and inserts it relative to the parent element.
///
/// # Arguments
/// - `label`: The webview label
/// - `parent_xpath`: XPath to the parent/reference element
/// - `position`: Where to insert: "prepend", "append", "before", "after"
/// - `tag_name`: HTML tag name (e.g., "div", "button", "section")
/// - `attributes`: JSON object of attributes to set
///
/// # Returns
/// The XPath of the newly created element, or null on failure
#[tauri::command]
pub async fn insert_element(
    app: AppHandle,
    label: String,
    parent_xpath: String,
    position: String,
    tag_name: String,
    attributes: serde_json::Value,
) -> Result<Option<String>, String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    // Escape strings for JavaScript
    let escaped_xpath = parent_xpath.replace('\\', "\\\\").replace('\'', "\\'");
    let escaped_position = position.replace('\\', "\\\\").replace('\'', "\\'");
    let escaped_tag = tag_name.replace('\\', "\\\\").replace('\'', "\\'");
    let attributes_json = attributes.to_string();

    let script = format!(
        r#"
        if (typeof window.__ORGII_INSERT_ELEMENT__ === 'function') {{
            window.__ORGII_INSERT_RESULT__ = window.__ORGII_INSERT_ELEMENT__('{}', '{}', '{}', {});
        }} else {{
            window.__ORGII_INSERT_RESULT__ = null;
        }}
        "#,
        escaped_xpath, escaped_position, escaped_tag, attributes_json
    );

    let _ = webview.eval(&script);
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    let result =
        eval_js_with_result(&webview, "window.__ORGII_INSERT_RESULT__ || 'null'", "null").await;

    if result == "null" || result.is_empty() {
        Ok(None)
    } else {
        Ok(Some(result))
    }
}

/// Insert HTML string into the DOM (for component templates).
///
/// Parses the HTML string and inserts it into the DOM.
///
/// # Arguments
/// - `label`: The webview label
/// - `parent_xpath`: XPath to the parent element
/// - `position`: Where to insert ("prepend", "append", "before", "after")
/// - `html`: HTML string to insert
///
/// # Returns
/// The XPath of the inserted element, or None if failed
#[tauri::command]
pub async fn insert_html(
    app: AppHandle,
    label: String,
    parent_xpath: String,
    position: String,
    html: String,
) -> Result<Option<String>, String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    let escaped_parent = parent_xpath.replace('\\', "\\\\").replace('\'', "\\'");
    let escaped_position = position.replace('\\', "\\\\").replace('\'', "\\'");
    // Escape the HTML for JavaScript string
    let escaped_html = html
        .replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace('\n', "\\n")
        .replace('\r', "\\r");

    let script = format!(
        r#"
        if (typeof window.__ORGII_INSERT_HTML__ === 'function') {{
            window.__ORGII_INSERT_HTML_RESULT__ = window.__ORGII_INSERT_HTML__('{}', '{}', '{}');
        }} else {{
            window.__ORGII_INSERT_HTML_RESULT__ = null;
        }}
        "#,
        escaped_parent, escaped_position, escaped_html
    );

    let _ = webview.eval(&script);
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    let result = eval_js_with_result(
        &webview,
        "window.__ORGII_INSERT_HTML_RESULT__ || 'null'",
        "null",
    )
    .await;

    if result == "null" || result.is_empty() {
        Ok(None)
    } else {
        Ok(Some(result))
    }
}

/// Delete an element from the DOM.
///
/// Removes the element at the specified XPath.
/// Cannot delete body or html elements.
///
/// # Arguments
/// - `label`: The webview label
/// - `xpath`: XPath to the element to delete
///
/// # Returns
/// true if deletion was successful
#[tauri::command]
pub async fn delete_element(app: AppHandle, label: String, xpath: String) -> Result<bool, String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    let escaped_xpath = xpath.replace('\\', "\\\\").replace('\'', "\\'");

    let script = format!(
        r#"
        if (typeof window.__ORGII_DELETE_ELEMENT__ === 'function') {{
            window.__ORGII_DELETE_RESULT__ = window.__ORGII_DELETE_ELEMENT__('{}');
        }} else {{
            window.__ORGII_DELETE_RESULT__ = false;
        }}
        "#,
        escaped_xpath
    );

    let _ = webview.eval(&script);
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    let result = eval_js_with_result(
        &webview,
        "String(window.__ORGII_DELETE_RESULT__ || false)",
        "false",
    )
    .await;

    Ok(result == "true")
}

/// Update element attributes.
///
/// Modifies attributes on the element at the specified XPath.
/// Set a value to null to remove the attribute.
///
/// # Arguments
/// - `label`: The webview label
/// - `xpath`: XPath to the element
/// - `attributes`: JSON object of attributes to set/update
///
/// # Returns
/// true if update was successful
#[tauri::command]
pub async fn update_element(
    app: AppHandle,
    label: String,
    xpath: String,
    attributes: serde_json::Value,
) -> Result<bool, String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    let escaped_xpath = xpath.replace('\\', "\\\\").replace('\'', "\\'");
    let attributes_json = attributes.to_string();

    let script = format!(
        r#"
        if (typeof window.__ORGII_UPDATE_ELEMENT__ === 'function') {{
            window.__ORGII_UPDATE_RESULT__ = window.__ORGII_UPDATE_ELEMENT__('{}', {});
        }} else {{
            window.__ORGII_UPDATE_RESULT__ = false;
        }}
        "#,
        escaped_xpath, attributes_json
    );

    let _ = webview.eval(&script);
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    let result = eval_js_with_result(
        &webview,
        "String(window.__ORGII_UPDATE_RESULT__ || false)",
        "false",
    )
    .await;

    Ok(result == "true")
}

/// Clone an element.
///
/// Creates a copy of the element and inserts it immediately after.
///
/// # Arguments
/// - `label`: The webview label
/// - `xpath`: XPath to the element to clone
/// - `deep`: Whether to clone children (default: true)
///
/// # Returns
/// The XPath of the cloned element, or null on failure
#[tauri::command]
pub async fn clone_element(
    app: AppHandle,
    label: String,
    xpath: String,
    deep: Option<bool>,
) -> Result<Option<String>, String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    let escaped_xpath = xpath.replace('\\', "\\\\").replace('\'', "\\'");
    let deep_val = deep.unwrap_or(true);

    let script = format!(
        r#"
        if (typeof window.__ORGII_CLONE_ELEMENT__ === 'function') {{
            window.__ORGII_CLONE_RESULT__ = window.__ORGII_CLONE_ELEMENT__('{}', {});
        }} else {{
            window.__ORGII_CLONE_RESULT__ = null;
        }}
        "#,
        escaped_xpath, deep_val
    );

    let _ = webview.eval(&script);
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    let result =
        eval_js_with_result(&webview, "window.__ORGII_CLONE_RESULT__ || 'null'", "null").await;

    if result == "null" || result.is_empty() {
        Ok(None)
    } else {
        Ok(Some(result))
    }
}

/// Move an element to a new position in the DOM.
///
/// # Arguments
/// - `label`: The webview label
/// - `source_xpath`: XPath to the element to move
/// - `target_xpath`: XPath to the target/reference element
/// - `position`: Where to place: "before" or "after"
///
/// # Returns
/// true if move was successful
#[tauri::command]
pub async fn move_element(
    app: AppHandle,
    label: String,
    source_xpath: String,
    target_xpath: String,
    position: String,
) -> Result<bool, String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    let escaped_source = source_xpath.replace('\\', "\\\\").replace('\'', "\\'");
    let escaped_target = target_xpath.replace('\\', "\\\\").replace('\'', "\\'");
    let escaped_position = position.replace('\\', "\\\\").replace('\'', "\\'");

    let script = format!(
        r#"
        if (typeof window.__ORGII_MOVE_ELEMENT__ === 'function') {{
            window.__ORGII_MOVE_RESULT__ = window.__ORGII_MOVE_ELEMENT__('{}', '{}', '{}');
        }} else {{
            window.__ORGII_MOVE_RESULT__ = false;
        }}
        "#,
        escaped_source, escaped_target, escaped_position
    );

    let _ = webview.eval(&script);
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    let result = eval_js_with_result(
        &webview,
        "String(window.__ORGII_MOVE_RESULT__ || false)",
        "false",
    )
    .await;

    Ok(result == "true")
}

// ============================================
// Undo/Redo Commands
// ============================================

/// Undo the last DOM operation.
///
/// # Returns
/// true if undo was successful
#[tauri::command]
pub async fn undo_dom_operation(app: AppHandle, label: String) -> Result<bool, String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    let script = r#"
        if (typeof window.__ORGII_UNDO__ === 'function') {
            window.__ORGII_UNDO_RESULT__ = window.__ORGII_UNDO__();
        } else {
            window.__ORGII_UNDO_RESULT__ = false;
        }
    "#;

    let _ = webview.eval(script);
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    let result = eval_js_with_result(
        &webview,
        "String(window.__ORGII_UNDO_RESULT__ || false)",
        "false",
    )
    .await;

    Ok(result == "true")
}

/// Redo the last undone DOM operation.
///
/// # Returns
/// true if redo was successful
#[tauri::command]
pub async fn redo_dom_operation(app: AppHandle, label: String) -> Result<bool, String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    let script = r#"
        if (typeof window.__ORGII_REDO__ === 'function') {
            window.__ORGII_REDO_RESULT__ = window.__ORGII_REDO__();
        } else {
            window.__ORGII_REDO_RESULT__ = false;
        }
    "#;

    let _ = webview.eval(script);
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    let result = eval_js_with_result(
        &webview,
        "String(window.__ORGII_REDO_RESULT__ || false)",
        "false",
    )
    .await;

    Ok(result == "true")
}

/// History state for undo/redo
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HistoryState {
    pub undo_count: u32,
    pub redo_count: u32,
    pub can_undo: bool,
    pub can_redo: bool,
}

/// Get the current undo/redo history state.
///
/// # Returns
/// HistoryState with counts and availability
#[tauri::command]
pub async fn get_dom_history_state(app: AppHandle, label: String) -> Result<HistoryState, String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    let script = r#"
        if (typeof window.__ORGII_GET_HISTORY_STATE__ === 'function') {
            window.__ORGII_HISTORY_STATE__ = window.__ORGII_GET_HISTORY_STATE__();
        } else {
            window.__ORGII_HISTORY_STATE__ = '{"undoCount":0,"redoCount":0,"canUndo":false,"canRedo":false}';
        }
    "#;

    let _ = webview.eval(script);
    tokio::time::sleep(tokio::time::Duration::from_millis(30)).await;

    let result =
        eval_js_with_result(&webview, "window.__ORGII_HISTORY_STATE__ || '{}'", "{}").await;

    serde_json::from_str(&result).map_err(|e| format!("Failed to parse history state: {}", e))
}

// ============================================
// Serialization Commands
// ============================================

/// Serialize a portion of the DOM to HTML.
///
/// # Arguments
/// - `label`: The webview label
/// - `root_xpath`: XPath to the root element (default: "/html/body")
///
/// # Returns
/// The HTML string of the element and its descendants
#[tauri::command]
pub async fn serialize_dom_to_html(
    app: AppHandle,
    label: String,
    root_xpath: Option<String>,
) -> Result<String, String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    let xpath = root_xpath.unwrap_or_else(|| "/html/body".to_string());
    let escaped_xpath = xpath.replace('\\', "\\\\").replace('\'', "\\'");

    let script = format!(
        r#"
        if (typeof window.__ORGII_SERIALIZE_TO_HTML__ === 'function') {{
            window.__ORGII_SERIALIZE_RESULT__ = window.__ORGII_SERIALIZE_TO_HTML__('{}');
        }} else {{
            window.__ORGII_SERIALIZE_RESULT__ = '';
        }}
        "#,
        escaped_xpath
    );

    let _ = webview.eval(&script);
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    let result = eval_js_with_result(&webview, "window.__ORGII_SERIALIZE_RESULT__ || ''", "").await;

    Ok(result)
}

// ============================================
// Multi-Select Commands
// ============================================

/// Add an element to multi-selection.
#[tauri::command]
pub async fn multi_select_add(
    app: AppHandle,
    label: String,
    xpath: String,
) -> Result<bool, String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    let escaped_xpath = xpath.replace('\\', "\\\\").replace('\'', "\\'");
    let script = format!(
        "window.__ORGII_MULTI_SELECT_ADD__('{}') ? 'true' : 'false'",
        escaped_xpath
    );

    let result = eval_js_with_result(&webview, &script, "false").await;
    Ok(result == "true")
}

/// Remove an element from multi-selection.
#[tauri::command]
pub async fn multi_select_remove(
    app: AppHandle,
    label: String,
    xpath: String,
) -> Result<bool, String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    let escaped_xpath = xpath.replace('\\', "\\\\").replace('\'', "\\'");
    let script = format!(
        "window.__ORGII_MULTI_SELECT_REMOVE__('{}') ? 'true' : 'false'",
        escaped_xpath
    );

    let result = eval_js_with_result(&webview, &script, "false").await;
    Ok(result == "true")
}

/// Toggle an element in multi-selection.
#[tauri::command]
pub async fn multi_select_toggle(
    app: AppHandle,
    label: String,
    xpath: String,
) -> Result<bool, String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    let escaped_xpath = xpath.replace('\\', "\\\\").replace('\'', "\\'");
    let script = format!(
        "window.__ORGII_MULTI_SELECT_TOGGLE__('{}') ? 'true' : 'false'",
        escaped_xpath
    );

    let result = eval_js_with_result(&webview, &script, "false").await;
    Ok(result == "true")
}

/// Get all multi-selected elements.
#[tauri::command]
pub async fn get_multi_selection(
    app: AppHandle,
    label: String,
) -> Result<Vec<serde_json::Value>, String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    let result =
        eval_js_with_result(&webview, "window.__ORGII_GET_MULTI_SELECTION__()", "[]").await;

    serde_json::from_str(&result).map_err(|e| format!("Failed to parse multi-selection: {}", e))
}

/// Clear all multi-selections.
#[tauri::command]
pub async fn clear_multi_selection(app: AppHandle, label: String) -> Result<bool, String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    let result = eval_js_with_result(
        &webview,
        "window.__ORGII_CLEAR_MULTI_SELECTION__() ? 'true' : 'false'",
        "false",
    )
    .await;
    Ok(result == "true")
}

// ============================================
// Element Bounds Commands
// ============================================

/// Bounding rectangle of an element.
#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct ElementBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
}

/// Get the bounding rectangle of an element.
#[tauri::command]
pub async fn get_element_bounds(
    app: AppHandle,
    label: String,
    xpath: String,
) -> Result<Option<ElementBounds>, String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    let escaped_xpath = xpath.replace('\\', "\\\\").replace('\'', "\\'");
    let script = format!("window.__ORGII_GET_ELEMENT_BOUNDS__('{}')", escaped_xpath);

    let result = eval_js_with_result(&webview, &script, "null").await;

    if result == "null" {
        Ok(None)
    } else {
        let bounds: ElementBounds =
            serde_json::from_str(&result).map_err(|e| format!("Failed to parse bounds: {}", e))?;
        Ok(Some(bounds))
    }
}

/// Get bounding rectangles for multiple elements.
#[tauri::command]
pub async fn get_multiple_bounds(
    app: AppHandle,
    label: String,
    xpaths: Vec<String>,
) -> Result<std::collections::HashMap<String, ElementBounds>, String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    let xpaths_json =
        serde_json::to_string(&xpaths).map_err(|e| format!("Failed to serialize xpaths: {}", e))?;

    let escaped_json = xpaths_json.replace('\\', "\\\\").replace('\'', "\\'");
    let script = format!("window.__ORGII_GET_MULTIPLE_BOUNDS__('{}')", escaped_json);

    let result = eval_js_with_result(&webview, &script, "{}").await;

    serde_json::from_str(&result).map_err(|e| format!("Failed to parse bounds map: {}", e))
}

// ============================================
// Resize/Position Commands
// ============================================

/// Resize an element.
#[tauri::command]
pub async fn resize_element(
    app: AppHandle,
    label: String,
    xpath: String,
    width: Option<f64>,
    height: Option<f64>,
) -> Result<bool, String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    let escaped_xpath = xpath.replace('\\', "\\\\").replace('\'', "\\'");
    let width_arg = width
        .map(|w| w.to_string())
        .unwrap_or_else(|| "null".to_string());
    let height_arg = height
        .map(|h| h.to_string())
        .unwrap_or_else(|| "null".to_string());

    let script = format!(
        "window.__ORGII_RESIZE_ELEMENT__('{}', {}, {}) ? 'true' : 'false'",
        escaped_xpath, width_arg, height_arg
    );

    let result = eval_js_with_result(&webview, &script, "false").await;
    Ok(result == "true")
}

/// Set element position (for absolute/relative positioning).
#[tauri::command]
pub async fn set_element_position(
    app: AppHandle,
    label: String,
    xpath: String,
    x: Option<f64>,
    y: Option<f64>,
) -> Result<bool, String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    let escaped_xpath = xpath.replace('\\', "\\\\").replace('\'', "\\'");
    let x_arg = x
        .map(|v| v.to_string())
        .unwrap_or_else(|| "null".to_string());
    let y_arg = y
        .map(|v| v.to_string())
        .unwrap_or_else(|| "null".to_string());

    let script = format!(
        "window.__ORGII_SET_ELEMENT_POSITION__('{}', {}, {}) ? 'true' : 'false'",
        escaped_xpath, x_arg, y_arg
    );

    let result = eval_js_with_result(&webview, &script, "false").await;
    Ok(result == "true")
}

// ============================================
// Save HTML to File
// ============================================

/// Save the serialized HTML to a file.
///
/// Serializes the DOM starting from the specified root XPath
/// and saves it to the given file path.
///
/// # Arguments
/// - `label`: The webview label
/// - `file_path`: Path where to save the HTML file
/// - `root_xpath`: XPath to the root element (default: document root)
/// - `include_doctype`: Whether to include <!DOCTYPE html> (default: true)
///
/// # Returns
/// The number of bytes written
#[tauri::command]
pub async fn save_html_to_file(
    app: AppHandle,
    label: String,
    file_path: String,
    root_xpath: Option<String>,
    include_doctype: Option<bool>,
) -> Result<usize, String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    // Determine what to serialize
    let xpath = root_xpath.unwrap_or_else(|| "/html".to_string());
    let escaped_xpath = xpath.replace('\\', "\\\\").replace('\'', "\\'");

    // Get the HTML content
    let script = format!(
        r#"
        (function() {{
            var xpath = '{}';
            var el;
            if (xpath === '/html' || xpath === '') {{
                el = document.documentElement;
            }} else {{
                var result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                el = result.singleNodeValue;
            }}
            return el ? el.outerHTML : '';
        }})()
        "#,
        escaped_xpath
    );

    let html_content = eval_js_with_result(&webview, &script, "").await;

    if html_content.is_empty() {
        return Err("Failed to serialize HTML: empty result".to_string());
    }

    // Build final content
    let include_doctype = include_doctype.unwrap_or(true);
    let final_content = if include_doctype && xpath == "/html" {
        format!("<!DOCTYPE html>\n{}", html_content)
    } else {
        html_content
    };

    // Write to file
    std::fs::write(&file_path, &final_content)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(final_content.len())
}

/// Get the full HTML document (including doctype) ready for saving.
///
/// This is useful for previewing what will be saved.
#[tauri::command]
pub async fn get_full_html_document(app: AppHandle, label: String) -> Result<String, String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    let script = r#"
        (function() {
            return '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
        })()
    "#;

    let html_content = eval_js_with_result(&webview, script, "").await;

    if html_content.is_empty() {
        return Err("Failed to get HTML document".to_string());
    }

    Ok(html_content)
}
