//! `/agent/test/lsp/*` endpoints (debug-only).
//!
//! Caller-path probes for the `LspManager` lifecycle without requiring
//! an LLM turn. Mirrors the `lsp_*` Tauri commands but reaches them
//! over HTTP so the standalone `e2e-test` binary can exercise:
//!
//! - **Lifecycle**: `start` → `running` → `did-open` → `log` → `stop`,
//!   asserting each step lands on the live `LspManagerState` the
//!   production runtime owns (not a parallel test instance).
//! - **Cooldown short-circuit**: `seed-broken` writes directly into the
//!   private cooldown map via `LspManager::seed_broken_for_test`
//!   (gated `#[cfg(debug_assertions)]`), then a follow-up `start` must
//!   return the cooldown error rather than re-spawning. This proves
//!   the consumer of the broken map honours its own contract — the
//!   producer (`mark_broken` after `LspServer::new_with_binary` or
//!   `initialize` failure) is harder to provoke deterministically
//!   without a real binary that crashes on init, so we test the two
//!   halves separately: production code drives the producer through
//!   real failures (covered by manual smoke), and these E2E scenarios
//!   drive the consumer through a synthetic seed.
//! - **Negative path**: `start` with an unknown language id returns the
//!   documented "No LSP server available for language: X" error
//!   without panicking or hanging.
//!
//! All endpoints are `#[cfg(debug_assertions)]`. They are wired in
//! `api/agent/mod.rs::create_routes`.

#![cfg(debug_assertions)]

use axum::extract::Path;
use axum::Json;
use serde_json::json;
use tauri::Manager;

use lsp::{server_key_for_language, LspManagerState};

/// Clone the `Arc<Mutex<LspManager>>` out of Tauri-managed state.
/// All endpoints below call this first; the helper centralises the
/// `AppHandle not initialized` error so handlers stay readable.
fn lsp_manager_arc() -> Result<LspManagerState, String> {
    let handle =
        crate::api::get_app_handle().ok_or_else(|| "AppHandle not initialized.".to_string())?;
    let state = handle.state::<LspManagerState>();
    Ok(state.inner().clone())
}

fn err(msg: impl Into<String>) -> Json<serde_json::Value> {
    Json(json!({"ok": false, "error": msg.into()}))
}

/// `POST /agent/test/lsp/start`
/// Body: `{ "language": "typescript", "root_path": "/abs/path" }`
/// Response: `{ "ok": true }` or `{ "ok": false, "error": "..." }`
pub async fn test_lsp_start(Json(body): Json<serde_json::Value>) -> Json<serde_json::Value> {
    let language = match body.get("language").and_then(|v| v.as_str()) {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => return err("language is required (non-empty string)"),
    };
    let root_path = match body.get("root_path").and_then(|v| v.as_str()) {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => return err("root_path is required (non-empty string)"),
    };

    let handle = match crate::api::get_app_handle() {
        Some(h) => h.clone(),
        None => return err("AppHandle not initialized."),
    };
    let manager_arc = match lsp_manager_arc() {
        Ok(arc) => arc,
        Err(error) => return err(error),
    };

    let manager = manager_arc.lock().await;
    match manager.start_server(&language, &root_path, handle).await {
        Ok(()) => Json(json!({"ok": true})),
        Err(error) => Json(json!({"ok": false, "error": error})),
    }
}

/// `POST /agent/test/lsp/stop`
/// Body: `{ "language": "typescript" }`
pub async fn test_lsp_stop(Json(body): Json<serde_json::Value>) -> Json<serde_json::Value> {
    let language = match body.get("language").and_then(|v| v.as_str()) {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => return err("language is required (non-empty string)"),
    };
    let manager_arc = match lsp_manager_arc() {
        Ok(arc) => arc,
        Err(error) => return err(error),
    };
    let manager = manager_arc.lock().await;
    match manager.stop_server(&language).await {
        Ok(()) => Json(json!({"ok": true})),
        Err(error) => Json(json!({"ok": false, "error": error})),
    }
}

/// `GET /agent/test/lsp/running`
/// Response: `{ "ok": true, "languages": ["typescript", ...] }`
pub async fn test_lsp_running() -> Json<serde_json::Value> {
    let manager_arc = match lsp_manager_arc() {
        Ok(arc) => arc,
        Err(error) => return err(error),
    };
    let manager = manager_arc.lock().await;
    let languages = manager.get_running_servers().await;
    Json(json!({"ok": true, "languages": languages}))
}

/// `POST /agent/test/lsp/did-open`
/// Body: `{ "language": "...", "uri": "file://...", "version": 1, "text": "..." }`
pub async fn test_lsp_did_open(Json(body): Json<serde_json::Value>) -> Json<serde_json::Value> {
    let Some(obj) = body.as_object() else {
        return err("body must be an object");
    };
    let language = match obj.get("language").and_then(|v| v.as_str()) {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => return err("language is required"),
    };
    let uri = match obj.get("uri").and_then(|v| v.as_str()) {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => return err("uri is required"),
    };
    let version = obj.get("version").and_then(|v| v.as_i64()).unwrap_or(1) as i32;
    let text = obj
        .get("text")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let manager_arc = match lsp_manager_arc() {
        Ok(arc) => arc,
        Err(error) => return err(error),
    };
    let manager = manager_arc.lock().await;
    match manager.did_open(&language, &uri, version, &text).await {
        Ok(()) => Json(json!({"ok": true})),
        Err(error) => Json(json!({"ok": false, "error": error})),
    }
}

/// `GET /agent/test/lsp/log/{language}`
/// Response shape:
/// ```json
/// {
///   "ok": true,
///   "line_count": 42,
///   "kinds": { "std_in": 5, "std_out": 35, "std_err": 2 },
///   "sample": [{ "tsMs": 1700..., "kind": "std_out", "line": "..." }]
/// }
/// ```
pub async fn test_lsp_log(Path(language): Path<String>) -> Json<serde_json::Value> {
    let manager_arc = match lsp_manager_arc() {
        Ok(arc) => arc,
        Err(error) => return err(error),
    };
    let manager = manager_arc.lock().await;
    let lines = manager.get_server_log(&language).await;

    let mut std_in = 0u32;
    let mut std_out = 0u32;
    let mut std_err = 0u32;
    for line in &lines {
        match line.kind {
            lsp::log_buffer::IoKind::StdIn => std_in += 1,
            lsp::log_buffer::IoKind::StdOut => std_out += 1,
            lsp::log_buffer::IoKind::StdErr => std_err += 1,
        }
    }

    let sample: Vec<serde_json::Value> = lines
        .iter()
        .take(3)
        .map(|line| serde_json::to_value(line).unwrap_or(serde_json::Value::Null))
        .collect();

    Json(json!({
        "ok": true,
        "line_count": lines.len(),
        "kinds": {"std_in": std_in, "std_out": std_out, "std_err": std_err},
        "sample": sample,
    }))
}

/// `POST /agent/test/lsp/seed-broken`
/// Body: `{ "language": "typescript", "root_path": "/abs/path", "error": "synthetic" }`
///
/// Writes directly into `LspManager::broken` via the debug-only
/// `seed_broken_for_test` helper. The next `start_server(language,
/// root_path)` call must hit the `BROKEN_COOLDOWN` short-circuit and
/// return an error containing the seeded message.
pub async fn test_lsp_seed_broken(Json(body): Json<serde_json::Value>) -> Json<serde_json::Value> {
    let Some(obj) = body.as_object() else {
        return err("body must be an object");
    };
    let language = match obj.get("language").and_then(|v| v.as_str()) {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => return err("language is required"),
    };
    let root_path = match obj.get("root_path").and_then(|v| v.as_str()) {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => return err("root_path is required"),
    };
    let error_msg = obj
        .get("error")
        .and_then(|v| v.as_str())
        .unwrap_or("seeded by /agent/test/lsp/seed-broken")
        .to_string();

    let key = match server_key_for_language(&language, &root_path) {
        Some(k) => k,
        None => {
            return err(format!(
                "No LSP server available for language: {}",
                language
            ));
        }
    };

    let manager_arc = match lsp_manager_arc() {
        Ok(arc) => arc,
        Err(error) => return err(error),
    };
    let manager = manager_arc.lock().await;
    manager.seed_broken_for_test(key, error_msg).await;
    Json(json!({"ok": true}))
}
