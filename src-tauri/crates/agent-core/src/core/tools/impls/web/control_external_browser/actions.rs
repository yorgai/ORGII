//! Action handlers for the external-browser control tool.
//!
//! One `execute_*` function per tool action (`start`, `stop`, `navigate`, ...).
//! Each handler is a thin shim that translates parsed args into a controller
//! HTTP request and re-shapes the response into the agent's tool-result
//! envelope. Routing from action name to handler lives in the parent module.

use serde_json::{json, Value};

use crate::tools::traits::{optional_string, required_string, ToolError};
use shared_state::AgentBrowserController;

pub(super) async fn execute_start(
    controller: &AgentBrowserController,
) -> Result<String, ToolError> {
    let result = controller
        .request("POST", "/start", None)
        .await
        .map_err(|err| ToolError::ExecutionFailed(format!("Failed to start browser: {}", err)))?;

    tracing::info!("[browser-tool] Browser started");
    Ok(format_json_result("Browser started", &result))
}

pub(super) async fn execute_stop(controller: &AgentBrowserController) -> Result<String, ToolError> {
    if !controller.is_running() {
        return Ok("Browser is not running.".to_string());
    }

    let result = controller
        .request("POST", "/stop", None)
        .await
        .map_err(|err| ToolError::ExecutionFailed(format!("Failed to stop browser: {}", err)))?;

    tracing::info!("[browser-tool] Browser stopped");
    Ok(format_json_result("Browser stopped", &result))
}

pub(super) async fn execute_navigate(
    controller: &AgentBrowserController,
    params: &Value,
) -> Result<String, ToolError> {
    let url = required_string(params, "targetUrl")?;
    let target_id = optional_string(params, "targetId");

    let mut body = json!({ "url": url });
    if let Some(ref tid) = target_id {
        body["targetId"] = json!(tid);
    }

    let result = controller
        .request("POST", "/navigate", Some(body))
        .await
        .map_err(|err| ToolError::ExecutionFailed(format!("Navigation failed: {}", err)))?;

    let nav_url = result
        .get("url")
        .and_then(|val| val.as_str())
        .unwrap_or(&url);

    Ok(format!("Navigated to: {}", nav_url))
}

pub(super) async fn execute_snapshot(
    controller: &AgentBrowserController,
    params: &Value,
) -> Result<String, ToolError> {
    let mut query: Vec<(String, String)> = Vec::new();

    // Map parameters to query string
    let query_params = [
        ("targetId", "targetId"),
        ("snapshotFormat", "format"),
        ("mode", "mode"),
        ("refs", "refs"),
        ("selector", "selector"),
    ];

    for (param_key, query_key) in &query_params {
        if let Some(val) = optional_string(params, param_key) {
            query.push((query_key.to_string(), val));
        }
    }

    // Boolean params
    for key in &["interactive", "compact"] {
        if let Some(val) = params.get(*key).and_then(|val| val.as_bool()) {
            if val {
                query.push((key.to_string(), "true".to_string()));
            }
        }
    }

    // Default to AI format if not specified
    if !query.iter().any(|(key, _)| key == "format") {
        query.push(("format".to_string(), "ai".to_string()));
    }

    let result = controller
        .get_with_query("/snapshot", &query)
        .await
        .map_err(|err| ToolError::ExecutionFailed(format!("Snapshot failed: {}", err)))?;

    // Extract the snapshot text
    let snapshot = result
        .get("snapshot")
        .and_then(|val| val.as_str())
        .or_else(|| result.get("tree").and_then(|val| val.as_str()))
        .unwrap_or("(empty snapshot)");

    let url = result
        .get("url")
        .and_then(|val| val.as_str())
        .unwrap_or("unknown");

    Ok(format!("Page: {}\n\n{}", url, snapshot))
}

/// Execute screenshot and return (display_text, base64_screenshot, url).
pub(super) async fn execute_screenshot_with_data(
    controller: &AgentBrowserController,
    params: &Value,
    target_id: Option<&str>,
) -> Result<(String, String, String), ToolError> {
    let mut body = json!({});

    if let Some(tid) = target_id {
        body["targetId"] = json!(tid);
    }
    if let Some(full_page) = params.get("fullPage").and_then(|val| val.as_bool()) {
        body["fullPage"] = json!(full_page);
    }

    let result = controller
        .request("POST", "/screenshot", Some(body))
        .await
        .map_err(|err| ToolError::ExecutionFailed(format!("Screenshot failed: {}", err)))?;

    let screenshot_b64 = result
        .get("screenshot")
        .and_then(|val| val.as_str())
        .unwrap_or("")
        .to_string();
    let url = result
        .get("url")
        .and_then(|val| val.as_str())
        .unwrap_or("unknown")
        .to_string();

    let display = format!(
        "Screenshot captured.\nURL: {}\nSize: {} bytes (base64)",
        url,
        screenshot_b64.len()
    );

    Ok((display, screenshot_b64, url))
}

pub(super) async fn execute_act(
    controller: &AgentBrowserController,
    params: &Value,
    target_id: Option<&str>,
) -> Result<String, ToolError> {
    let request = params
        .get("request")
        .ok_or_else(|| {
            ToolError::InvalidParams("'request' object is required for act action".to_string())
        })?
        .clone();

    let kind = request
        .get("kind")
        .and_then(|val| val.as_str())
        .ok_or_else(|| {
            ToolError::InvalidParams("'request.kind' is required for act action".to_string())
        })?
        .to_string();

    let mut body = request;
    if let Some(tid) = target_id {
        body.as_object_mut()
            .map(|obj| obj.insert("targetId".to_string(), json!(tid)));
    }

    let result = controller
        .request("POST", "/act", Some(body))
        .await
        .map_err(|err| ToolError::ExecutionFailed(format!("Act '{}' failed: {}", kind, err)))?;

    // Format the result based on kind
    let action_ref = result.get("ref").and_then(|val| val.as_str()).unwrap_or("");
    let url = result.get("url").and_then(|val| val.as_str()).unwrap_or("");

    match kind.as_str() {
        "evaluate" => {
            let eval_result = result
                .get("result")
                .map(|val| {
                    serde_json::to_string_pretty(val).expect("Value serialization is infallible")
                })
                .unwrap_or_else(|| "(no result)".to_string());
            Ok(format!("Evaluated JavaScript:\n{}", eval_result))
        }
        "click" => Ok(format!(
            "Clicked {} {}",
            action_ref,
            if url.is_empty() {
                String::new()
            } else {
                format!("(page: {})", url)
            }
        )),
        "type" => {
            let text = params
                .get("request")
                .and_then(|req| req.get("text"))
                .and_then(|val| val.as_str())
                .unwrap_or("");
            Ok(format!("Typed \"{}\" into {}", text, action_ref))
        }
        "press" => {
            let key = params
                .get("request")
                .and_then(|req| req.get("key"))
                .and_then(|val| val.as_str())
                .unwrap_or("unknown");
            Ok(format!("Pressed {}", key))
        }
        "hover" => Ok(format!("Hovered over {}", action_ref)),
        "wait" => Ok("Wait completed.".to_string()),
        "fill" => Ok("Form filled.".to_string()),
        "select" => Ok(format!("Selected value in {}", action_ref)),
        "close" => Ok("Tab closed.".to_string()),
        _ => {
            let summary =
                serde_json::to_string_pretty(&result).expect("Value serialization is infallible");
            Ok(format!("Action '{}' completed:\n{}", kind, summary))
        }
    }
}

pub(super) async fn execute_tabs(controller: &AgentBrowserController) -> Result<String, ToolError> {
    let result = controller
        .request("GET", "/tabs", None)
        .await
        .map_err(|err| ToolError::ExecutionFailed(format!("Failed to list tabs: {}", err)))?;

    let tabs = result
        .get("tabs")
        .and_then(|val| val.as_array())
        .map(|arr| {
            arr.iter()
                .enumerate()
                .map(|(idx, tab)| {
                    let title = tab
                        .get("title")
                        .and_then(|val| val.as_str())
                        .unwrap_or("(untitled)");
                    let url = tab.get("url").and_then(|val| val.as_str()).unwrap_or("");
                    let target_id = tab
                        .get("targetId")
                        .and_then(|val| val.as_str())
                        .unwrap_or("");
                    format!("{}. {} - {} [targetId={}]", idx + 1, title, url, target_id)
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_else(|| "(no tabs)".to_string());

    Ok(format!("Open tabs:\n{}", tabs))
}

pub(super) async fn execute_console(
    controller: &AgentBrowserController,
    target_id: Option<&str>,
) -> Result<String, ToolError> {
    let mut query: Vec<(String, String)> = Vec::new();
    if let Some(tid) = target_id {
        query.push(("targetId".to_string(), tid.to_string()));
    }

    let result = controller
        .get_with_query("/console", &query)
        .await
        .map_err(|err| ToolError::ExecutionFailed(format!("Failed to get console: {}", err)))?;

    let messages = result
        .get("messages")
        .and_then(|val| val.as_array())
        .map(|arr| {
            arr.iter()
                .map(|msg| {
                    let level = msg
                        .get("level")
                        .and_then(|val| val.as_str())
                        .unwrap_or("log");
                    let text = msg.get("text").and_then(|val| val.as_str()).unwrap_or("");
                    format!("[{}] {}", level, text)
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_else(|| "(no messages)".to_string());

    Ok(format!("Console output:\n{}", messages))
}

/// Format a JSON result with a prefix message.
pub(super) fn format_json_result(prefix: &str, result: &Value) -> String {
    let details = serde_json::to_string_pretty(result).expect("Value serialization is infallible");
    if details.len() > 200 {
        format!("{}\n{}", prefix, truncate_on_char_boundary(&details, 200))
    } else {
        format!("{}\n{}", prefix, details)
    }
}

/// Truncate `s` to at most `max_bytes`, snapping back to the nearest UTF-8
/// char boundary so multi-byte sequences (e.g. emoji, CJK) are not split.
fn truncate_on_char_boundary(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

#[cfg(test)]
mod tests {
    use super::truncate_on_char_boundary;

    #[test]
    fn truncate_below_limit_returns_full_string() {
        assert_eq!(truncate_on_char_boundary("hello", 200), "hello");
    }

    #[test]
    fn truncate_ascii_truncates_at_exact_byte() {
        let s = "a".repeat(250);
        let out = truncate_on_char_boundary(&s, 200);
        assert_eq!(out.len(), 200);
    }

    #[test]
    fn truncate_does_not_split_multibyte_char() {
        // Each CJK character here is 3 bytes; 200 ASCII bytes plus three
        // CJK characters puts byte-boundary tests at offsets 200..=205.
        // Truncating at 201 must not split a character.
        let mut s = "a".repeat(199);
        s.push_str("中中中"); // 9 bytes, total 208
        let out = truncate_on_char_boundary(&s, 201);
        assert!(
            out.is_char_boundary(out.len()),
            "result must end on a char boundary"
        );
        assert!(out.len() <= 201);
        assert!(
            out.ends_with('a') || out.ends_with('中'),
            "should end at the 'a' boundary or after a complete 中, got: {:?}",
            out
        );
    }
}
