//! `web_fetch` tool — HTTP GET + readable-text extraction for a single URL.

use async_trait::async_trait;
use reqwest::Client;
use serde_json::Value;

use crate::tools::categories as tool_categories;
use crate::tools::names as tool_names;
use crate::tools::traits::{optional_int, required_string, Tool, ToolError};

const MAX_FETCH_CHARS: usize = 50_000;

pub struct WebFetchTool {
    client: Client,
}

impl Default for WebFetchTool {
    fn default() -> Self {
        Self::new()
    }
}

impl WebFetchTool {
    pub fn new() -> Self {
        Self {
            client: Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .redirect(reqwest::redirect::Policy::limited(5))
                .build()
                .expect("TLS backend initialization failed"),
        }
    }
}

#[async_trait]
impl Tool for WebFetchTool {
    fn name(&self) -> &str {
        tool_names::WEB_FETCH
    }

    fn category(&self) -> &str {
        tool_categories::WEB
    }

    fn is_read_only(&self) -> bool {
        true
    }

    fn description(&self) -> &str {
        "Fetch a web page and return its text content. Strips HTML and returns readable text."
    }

    fn parameters(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "URL to fetch"
                },
                "max_chars": {
                    "type": "integer",
                    "description": "Maximum characters to return (default 50000)"
                }
            },
            "required": ["url"]
        })
    }

    async fn execute_text(
        &self,
        params: Value,
        _ctx: &crate::tools::traits::CallContext,
    ) -> Result<String, ToolError> {
        let url = required_string(&params, "url")?;
        let max_chars = optional_int(&params, "max_chars")
            .map(|v| v as usize)
            .unwrap_or(MAX_FETCH_CHARS);

        if !url.starts_with("http://") && !url.starts_with("https://") {
            return Err(ToolError::InvalidParams(format!(
                "URL must start with http:// or https:// (got: {url}). \
                 For local files use `read_file` (with `offset`/`limit` for large files) \
                 or `code_search` (action: grep) — not a web tool.",
            )));
        }

        let response = self
            .client
            .get(&url)
            .header("User-Agent", "orgii-agent/1.0")
            .send()
            .await
            .map_err(|err| ToolError::ExecutionFailed(format!("Fetch failed: {}", err)))?;

        let _status = response.status();
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        let body = response.text().await.map_err(|err| {
            ToolError::ExecutionFailed(format!("Failed to read response body: {}", err))
        })?;

        if content_type.contains("json") {
            let truncated: String = crate::utils::safe_truncate_chars(body, max_chars).to_string();
            return Ok(truncated);
        }

        let text = if content_type.contains("html") {
            html_to_readable_text(&body)
        } else {
            body
        };

        let truncated: String = crate::utils::safe_truncate_chars(text, max_chars).to_string();
        let was_truncated = text.len() > max_chars;

        if was_truncated {
            Ok(format!(
                "{}\n\n[...truncated, {} total chars]",
                truncated,
                text.len()
            ))
        } else {
            Ok(truncated)
        }
    }
}

/// Convert HTML to readable plain text preserving structure (headings, links, lists).
/// Strips `<script>`, `<style>`, `<nav>`, `<footer>` before conversion.
fn html_to_readable_text(html: &str) -> String {
    let cleaned = strip_noisy_tags(html);
    html2text::from_read(cleaned.as_bytes(), 120).unwrap_or(cleaned)
}

/// Remove script/style/nav/footer blocks before HTML-to-text conversion.
fn strip_noisy_tags(html: &str) -> String {
    let tag_patterns = ["script", "style", "nav", "footer", "noscript", "svg"];
    let mut result = html.to_string();
    for tag in &tag_patterns {
        loop {
            let open = format!("<{}", tag);
            let close = format!("</{}>", tag);
            let Some(start) = result.to_lowercase().find(&open) else {
                break;
            };
            let end_pos = result.to_lowercase()[start..]
                .find(&close)
                .map(|pos| start + pos + close.len())
                .unwrap_or_else(|| {
                    result[start..]
                        .find('>')
                        .map(|p| start + p + 1)
                        .unwrap_or(result.len())
                });
            result.replace_range(start..end_pos, "");
        }
    }
    result
}
