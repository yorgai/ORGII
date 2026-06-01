//! Local SSE sanitizer reverse-proxy for third-party Anthropic-compatible proxies.
//!
//! Some proxies append garbage bytes (trailing whitespace + extra braces) to SSE
//! `data:` lines, breaking downstream consumers like OpenCode. This module spins
//! up a lightweight local HTTP server that forwards Anthropic API requests to the
//! real upstream, sanitizing each SSE `data:` line on the fly.
//!
//! The sanitizer is transparent: all headers (except Host) are forwarded, and
//! non-SSE responses pass through untouched.

use axum::body::Body;
use axum::extract::State;
use axum::http::{HeaderMap, Method, StatusCode, Uri};
use axum::response::IntoResponse;
use bytes::Bytes;
use futures_util::StreamExt;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::Mutex;

struct SanitizerInstance {
    port: u16,
    _shutdown: tokio::sync::oneshot::Sender<()>,
}

static INSTANCES: std::sync::LazyLock<Arc<Mutex<HashMap<String, SanitizerInstance>>>> =
    std::sync::LazyLock::new(|| Arc::new(Mutex::new(HashMap::new())));

#[derive(Clone)]
struct ProxyState {
    upstream: String,
    client: reqwest::Client,
}

/// Ensure a sanitizer proxy is running for the given upstream URL.
/// Returns `http://127.0.0.1:{port}` as the local base URL to use in configs.
pub async fn ensure_running(upstream_base_url: &str) -> Result<String, String> {
    let mut instances = INSTANCES.lock().await;

    if let Some(inst) = instances.get(upstream_base_url) {
        return Ok(format!("http://127.0.0.1:{}", inst.port));
    }

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind SSE sanitizer: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get addr: {}", e))?
        .port();

    let state = ProxyState {
        upstream: upstream_base_url.trim_end_matches('/').to_string(),
        client: reqwest::Client::builder()
            .no_proxy()
            .build()
            .unwrap_or_default(),
    };

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    let app = axum::Router::new()
        .fallback(proxy_handler)
        .with_state(state);

    tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            })
            .await
            .ok();
    });

    tracing::info!(
        "[SSE-Sanitizer] Started on port {} → {}",
        port,
        upstream_base_url
    );

    instances.insert(
        upstream_base_url.to_string(),
        SanitizerInstance {
            port,
            _shutdown: shutdown_tx,
        },
    );

    Ok(format!("http://127.0.0.1:{}", port))
}

async fn proxy_handler(
    State(state): State<ProxyState>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    let path = uri.path_and_query().map(|pq| pq.as_str()).unwrap_or("/");
    let url = format!("{}{}", state.upstream, path);

    let reqwest_method =
        reqwest::Method::from_bytes(method.as_str().as_bytes()).unwrap_or(reqwest::Method::POST);

    let mut builder = state.client.request(reqwest_method, &url);

    for (name, value) in &headers {
        if name == "host" || name == "content-length" {
            continue;
        }
        if let Ok(v) = value.to_str() {
            builder = builder.header(name.as_str(), v);
        }
    }

    if !body.is_empty() {
        builder = builder.body(body.to_vec());
    }

    let response = match builder.send().await {
        Ok(r) => r,
        Err(err) => {
            tracing::warn!("[SSE-Sanitizer] Upstream error: {}", err);
            return (StatusCode::BAD_GATEWAY, format!("Upstream error: {}", err)).into_response();
        }
    };

    let status = StatusCode::from_u16(response.status().as_u16()).unwrap_or(StatusCode::OK);
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let is_sse = content_type.contains("text/event-stream");

    if is_sse {
        let byte_stream = response.bytes_stream();
        let sanitized = byte_stream.map(move |chunk| match chunk {
            Ok(bytes) => Ok(sanitize_sse_chunk(&bytes)),
            Err(e) => Err(std::io::Error::other(e)),
        });
        let body = Body::from_stream(sanitized);

        axum::response::Response::builder()
            .status(status)
            .header("content-type", "text/event-stream")
            .header("cache-control", "no-cache")
            .body(body)
            .unwrap()
            .into_response()
    } else {
        let resp_bytes = response.bytes().await.unwrap_or_default();
        let mut builder = axum::response::Response::builder().status(status);
        if !content_type.is_empty() {
            builder = builder.header("content-type", &content_type);
        }
        builder
            .body(Body::from(resp_bytes))
            .unwrap()
            .into_response()
    }
}

/// Sanitize a chunk of SSE data by stripping trailing garbage after JSON on `data:` lines.
fn sanitize_sse_chunk(raw: &[u8]) -> Bytes {
    let text = String::from_utf8_lossy(raw);
    let mut output = String::with_capacity(text.len());

    for line in text.split('\n') {
        if let Some(json_part) = line.strip_prefix("data: ") {
            if let Some(clean) = extract_balanced_json(json_part) {
                output.push_str("data: ");
                output.push_str(clean);
            } else {
                output.push_str(line.trim_end());
            }
        } else {
            output.push_str(line.trim_end());
        }
        output.push('\n');
    }

    Bytes::from(output)
}

/// Extract the first balanced JSON object from a string.
fn extract_balanced_json(s: &str) -> Option<&str> {
    let s = s.trim_start();
    if !s.starts_with('{') {
        return None;
    }

    let mut depth = 0i32;
    let mut in_string = false;
    let mut escape_next = false;

    for (idx, ch) in s.char_indices() {
        if escape_next {
            escape_next = false;
            continue;
        }
        match ch {
            '\\' if in_string => {
                escape_next = true;
            }
            '"' => {
                in_string = !in_string;
            }
            '{' if !in_string => {
                depth += 1;
            }
            '}' if !in_string => {
                depth -= 1;
                if depth == 0 {
                    return Some(&s[..idx + 1]);
                }
            }
            _ => {}
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_balanced_json_trailing_garbage() {
        assert_eq!(
            extract_balanced_json(r#"{"type":"message_start"}       }"#),
            Some(r#"{"type":"message_start"}"#)
        );
    }

    #[test]
    fn test_extract_balanced_json_nested() {
        assert_eq!(
            extract_balanced_json(r#"{"a":{"b":1}}            }"#),
            Some(r#"{"a":{"b":1}}"#)
        );
    }

    #[test]
    fn test_sanitize_sse_chunk() {
        let input =
            b"event: content_block_delta\ndata: {\"delta\":{\"text\":\"hi\"}}            }\n\n";
        let output = sanitize_sse_chunk(input);
        let text = String::from_utf8(output.to_vec()).unwrap();
        assert!(text.contains(r#"data: {"delta":{"text":"hi"}}"#));
        assert!(!text.contains("            }"));
    }
}
