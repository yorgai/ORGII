//! Internal Browser Tauri Commands
//!
//! Direct frontend access to internal browser automation for testing and debugging.
//! These commands expose the `window.__PAGE_AGENT__` API injected into inline webviews.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use super::logging::eval_js_with_result;

// ============================================================================
// Types
// ============================================================================

/// Browser state returned by internal browser automation
#[derive(Debug, Serialize, Deserialize)]
pub struct InternalBrowserState {
    pub url: String,
    pub title: String,
    pub header: String,
    pub content: String,
    pub footer: String,
}

/// Result from internal browser actions
#[derive(Debug, Serialize, Deserialize)]
pub struct InternalBrowserActionResult {
    pub success: bool,
    pub message: String,
}

// ============================================================================
// Commands
// ============================================================================

/// Get the browser state from a webview using Page Agent.
///
/// Returns the DOM tree with interactive elements highlighted and indexed.
#[tauri::command]
pub async fn internal_browser_get_state(
    app: AppHandle,
    label: String,
) -> Result<InternalBrowserState, String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    // Execute the getBrowserState function
    let _ = webview.eval(
        r#"
        if (window.__PAGE_AGENT__) {
            window.__PAGE_AGENT_RESULT__ = JSON.stringify(window.__PAGE_AGENT__.getBrowserState());
        } else {
            window.__PAGE_AGENT_RESULT__ = JSON.stringify({
                url: window.location.href,
                title: document.title,
                header: "Page Agent not initialized",
                content: "",
                footer: ""
            });
        }
        "#,
    );

    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    let result = eval_js_with_result(&webview, "window.__PAGE_AGENT_RESULT__ || '{}'", "{}").await;

    serde_json::from_str(&result).map_err(|e| format!("Failed to parse result: {}", e))
}

/// Click an element by its highlight index.
#[tauri::command]
pub async fn internal_browser_click(
    app: AppHandle,
    label: String,
    index: i64,
) -> Result<InternalBrowserActionResult, String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    let script = format!(
        r#"
        (async () => {{
            if (window.__PAGE_AGENT__) {{
                window.__PAGE_AGENT_RESULT__ = JSON.stringify(await window.__PAGE_AGENT__.clickElement({}));
            }} else {{
                window.__PAGE_AGENT_RESULT__ = JSON.stringify({{
                    success: false,
                    message: "Page Agent not initialized"
                }});
            }}
        }})();
        "#,
        index
    );

    let _ = webview.eval(&script);
    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;

    let result = eval_js_with_result(&webview, "window.__PAGE_AGENT_RESULT__ || '{}'", "{}").await;

    serde_json::from_str(&result).map_err(|e| format!("Failed to parse result: {}", e))
}

/// Input text into an element by its highlight index.
#[tauri::command]
pub async fn internal_browser_input(
    app: AppHandle,
    label: String,
    index: i64,
    text: String,
) -> Result<InternalBrowserActionResult, String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    // Escape the text for JavaScript
    let escaped_text = text
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r");

    let script = format!(
        r#"
        (async () => {{
            if (window.__PAGE_AGENT__) {{
                window.__PAGE_AGENT_RESULT__ = JSON.stringify(await window.__PAGE_AGENT__.inputText({}, "{}"));
            }} else {{
                window.__PAGE_AGENT_RESULT__ = JSON.stringify({{
                    success: false,
                    message: "Page Agent not initialized"
                }});
            }}
        }})();
        "#,
        index, escaped_text
    );

    let _ = webview.eval(&script);
    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

    let result = eval_js_with_result(&webview, "window.__PAGE_AGENT_RESULT__ || '{}'", "{}").await;

    serde_json::from_str(&result).map_err(|e| format!("Failed to parse result: {}", e))
}

/// Select an option from a dropdown by its highlight index.
#[tauri::command]
pub async fn internal_browser_select(
    app: AppHandle,
    label: String,
    index: i64,
    option: String,
) -> Result<InternalBrowserActionResult, String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    let escaped_option = option.replace('\\', "\\\\").replace('"', "\\\"");

    let script = format!(
        r#"
        (async () => {{
            if (window.__PAGE_AGENT__) {{
                window.__PAGE_AGENT_RESULT__ = JSON.stringify(await window.__PAGE_AGENT__.selectOption({}, "{}"));
            }} else {{
                window.__PAGE_AGENT_RESULT__ = JSON.stringify({{
                    success: false,
                    message: "Page Agent not initialized"
                }});
            }}
        }})();
        "#,
        index, escaped_option
    );

    let _ = webview.eval(&script);
    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

    let result = eval_js_with_result(&webview, "window.__PAGE_AGENT_RESULT__ || '{}'", "{}").await;

    serde_json::from_str(&result).map_err(|e| format!("Failed to parse result: {}", e))
}

/// Scroll the page or an element.
#[tauri::command]
pub async fn internal_browser_scroll(
    app: AppHandle,
    label: String,
    direction: String,
    pages: Option<f64>,
    element_index: Option<i64>,
) -> Result<InternalBrowserActionResult, String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    let pages_val = pages.unwrap_or(1.0);
    let element_arg = match element_index {
        Some(idx) => idx.to_string(),
        None => "null".to_string(),
    };

    let script = format!(
        r#"
        (async () => {{
            if (window.__PAGE_AGENT__) {{
                window.__PAGE_AGENT_RESULT__ = JSON.stringify(await window.__PAGE_AGENT__.scroll("{}", {}, {}));
            }} else {{
                window.__PAGE_AGENT_RESULT__ = JSON.stringify({{
                    success: false,
                    message: "Page Agent not initialized"
                }});
            }}
        }})();
        "#,
        direction, pages_val, element_arg
    );

    let _ = webview.eval(&script);
    tokio::time::sleep(tokio::time::Duration::from_millis(400)).await;

    let result = eval_js_with_result(&webview, "window.__PAGE_AGENT_RESULT__ || '{}'", "{}").await;

    serde_json::from_str(&result).map_err(|e| format!("Failed to parse result: {}", e))
}

/// Show the user takeover mask (blocks user interaction).
#[tauri::command]
pub async fn internal_browser_show_mask(app: AppHandle, label: String) -> Result<(), String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    let _ = webview.eval(
        r#"
        if (window.__PAGE_AGENT__) {
            window.__PAGE_AGENT__.showMask();
        }
        "#,
    );

    Ok(())
}

/// Hide the user takeover mask (allows user interaction).
#[tauri::command]
pub async fn internal_browser_hide_mask(app: AppHandle, label: String) -> Result<(), String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    let _ = webview.eval(
        r#"
        if (window.__PAGE_AGENT__) {
            window.__PAGE_AGENT__.hideMask();
        }
        "#,
    );

    Ok(())
}

/// Clean up element highlights.
#[tauri::command]
pub async fn internal_browser_clean_up(app: AppHandle, label: String) -> Result<(), String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    let _ = webview.eval(
        r#"
        if (window.__PAGE_AGENT__) {
            window.__PAGE_AGENT__.cleanUpHighlights();
        }
        "#,
    );

    Ok(())
}

/// Check if Page Agent is initialized in a webview.
#[tauri::command]
pub async fn internal_browser_is_ready(app: AppHandle, label: String) -> Result<bool, String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    let _ = webview.eval(
        r#"
        window.__PAGE_AGENT_READY__ = (typeof window.__PAGE_AGENT__ !== 'undefined').toString();
        "#,
    );

    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    let result =
        eval_js_with_result(&webview, "window.__PAGE_AGENT_READY__ || 'false'", "false").await;

    Ok(result == "true")
}
