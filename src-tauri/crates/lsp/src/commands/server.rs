//! LSP Server Lifecycle Commands
//!
//! Tauri commands for managing LSP server processes:
//! - Starting/stopping servers per language
//! - Document notifications (open/change/close)
//! - Retrieving diagnostics and server status
//! - Global LSP configuration

use serde::{Deserialize, Serialize};
use tauri::State;

use super::LspManagerState;
use crate::config::{self, CustomServerDef, LspConfig, ServerOverride};
use crate::workspace_scan::types::WorkspaceDiagnostic;

/// Start an LSP server for a specific language
#[tauri::command]
pub async fn lsp_start_server(
    language: String,
    root_path: String,
    app_handle: tauri::AppHandle,
    lsp_manager: State<'_, LspManagerState>,
) -> Result<(), String> {
    let manager = lsp_manager.lock().await;
    manager
        .start_server(&language, &root_path, app_handle)
        .await
}

/// Stop an LSP server for a specific language
#[tauri::command]
pub async fn lsp_stop_server(
    language: String,
    lsp_manager: State<'_, LspManagerState>,
) -> Result<(), String> {
    let manager = lsp_manager.lock().await;
    manager.stop_server(&language).await
}

/// Notify LSP that a document was opened
#[tauri::command]
pub async fn lsp_did_open(
    language: String,
    uri: String,
    version: i32,
    text: String,
    lsp_manager: State<'_, LspManagerState>,
) -> Result<(), String> {
    let manager = lsp_manager.lock().await;
    manager.did_open(&language, &uri, version, &text).await
}

/// Notify LSP that a document changed
#[tauri::command]
pub async fn lsp_did_change(
    language: String,
    uri: String,
    version: i32,
    text: String,
    lsp_manager: State<'_, LspManagerState>,
) -> Result<(), String> {
    let manager = lsp_manager.lock().await;
    manager.did_change(&language, &uri, version, &text).await
}

/// Notify LSP that a document was closed
#[tauri::command]
pub async fn lsp_did_close(
    language: String,
    uri: String,
    lsp_manager: State<'_, LspManagerState>,
) -> Result<(), String> {
    let manager = lsp_manager.lock().await;
    manager.did_close(&language, &uri).await
}

/// Get cached diagnostics from a running LSP server.
/// Returns WorkspaceDiagnostic-compatible entries parsed from
/// the server's publishDiagnostics cache.
#[tauri::command]
pub async fn lsp_get_cached_diagnostics(
    language: String,
    lsp_manager: State<'_, LspManagerState>,
) -> Result<Vec<WorkspaceDiagnostic>, String> {
    let manager = lsp_manager.lock().await;
    let cache = manager.get_cached_diagnostics(&language).await?;

    let mut diagnostics = Vec::new();

    for (uri_str, params) in cache.iter() {
        let file_path = uri_to_path(uri_str);

        for diag in &params.diagnostics {
            diagnostics.push(WorkspaceDiagnostic {
                file_path: file_path.clone(),
                // LSP is 0-indexed, the workspace-scan layer is 1-indexed.
                line: diag.range.start.line + 1,
                column: diag.range.start.character + 1,
                end_line: Some(diag.range.end.line + 1),
                end_column: Some(diag.range.end.character + 1),
                severity: severity_label(diag.severity),
                message: diag.message.clone(),
                source: diag.source.clone().unwrap_or_else(|| "lsp".to_string()),
                code: diag.code.as_ref().map(|c| match c {
                    lsp_types::NumberOrString::Number(n) => n.to_string(),
                    lsp_types::NumberOrString::String(s) => s.clone(),
                }),
            });
        }
    }

    log::info!(
        "[LSP] Returning {} cached diagnostics for {}",
        diagnostics.len(),
        language
    );
    Ok(diagnostics)
}

/// Decode a `file://` URI back into a filesystem path. Non-`file://`
/// schemes (rare in LSP traffic but possible for `untitled:` buffers)
/// are returned verbatim so the frontend can still display them.
fn uri_to_path(uri: &str) -> String {
    if let Some(path) = uri.strip_prefix("file://") {
        urlencoding::decode(path)
            .unwrap_or_else(|_| path.into())
            .into_owned()
    } else {
        uri.to_string()
    }
}

/// Map an LSP severity to the wire string the frontend expects.
/// `None` (server didn't classify) and unknown variants both fall
/// through to `info` to match the prior raw-JSON behaviour.
fn severity_label(severity: Option<lsp_types::DiagnosticSeverity>) -> String {
    match severity {
        Some(lsp_types::DiagnosticSeverity::ERROR) => "error",
        Some(lsp_types::DiagnosticSeverity::WARNING) => "warning",
        Some(lsp_types::DiagnosticSeverity::INFORMATION) => "info",
        Some(lsp_types::DiagnosticSeverity::HINT) => "info",
        _ => "info",
    }
    .to_string()
}

/// Shutdown all LSP servers
#[tauri::command]
pub async fn lsp_shutdown(lsp_manager: State<'_, LspManagerState>) -> Result<(), String> {
    let manager = lsp_manager.lock().await;
    manager.shutdown().await
}

/// One row of the broken-cooldown snapshot returned to the frontend.
/// Used by the Language Servers page and the Problems panel to show
/// which servers are currently in cooldown so the user can hit
/// "Revive" instead of waiting the full `BROKEN_COOLDOWN`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokenServerInfo {
    pub server_id: String,
    pub error: String,
    pub seconds_in_cooldown: u64,
}

/// Snapshot of every server currently in broken-cooldown. Servers whose
/// cooldown has already expired are filtered out by the manager.
#[tauri::command]
pub async fn lsp_list_broken_servers(
    lsp_manager: State<'_, LspManagerState>,
) -> Result<Vec<BrokenServerInfo>, String> {
    let manager = lsp_manager.lock().await;
    Ok(manager
        .broken_snapshot()
        .await
        .into_iter()
        .map(|(server_id, error, seconds_in_cooldown)| BrokenServerInfo {
            server_id,
            error,
            seconds_in_cooldown,
        })
        .collect())
}

/// Clear the broken-cooldown entry for a single server (any root) so
/// the next `start_server` call will retry instead of being rejected
/// by the cooldown short-circuit. Returns the number of entries
/// cleared.
#[tauri::command]
pub async fn lsp_revive_server(
    server_id: String,
    lsp_manager: State<'_, LspManagerState>,
) -> Result<usize, String> {
    let manager = lsp_manager.lock().await;
    Ok(manager.revive_server(&server_id).await)
}

/// Clear every broken-cooldown entry. Returns the count cleared.
#[tauri::command]
pub async fn lsp_revive_all(lsp_manager: State<'_, LspManagerState>) -> Result<usize, String> {
    let manager = lsp_manager.lock().await;
    Ok(manager.revive_all().await)
}

/// Snapshot of the per-server stdio ring buffer.
///
/// Returns the most recent `MAX_LOG_LINES` (=500) of inbound,
/// outbound, and stderr activity for the running server matching
/// `language`. An empty `Vec` is returned when no server is running
/// for that language — the frontend treats it as "open the drawer on
/// an inactive row" rather than an error.
#[tauri::command]
pub async fn lsp_get_server_log(
    language: String,
    lsp_manager: State<'_, LspManagerState>,
) -> Result<Vec<crate::log_buffer::LogLine>, String> {
    let manager = lsp_manager.lock().await;
    Ok(manager.get_server_log(&language).await)
}

// ============================================
// Global Configuration Commands
// ============================================

/// Global LSP configuration response.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalLspConfig {
    /// Whether auto-install is enabled.
    pub auto_install: bool,

    /// Per-server overrides.
    pub servers: std::collections::HashMap<String, ServerOverride>,

    /// Custom server definitions.
    pub custom_servers: Vec<CustomServerDef>,
}

impl From<LspConfig> for GlobalLspConfig {
    fn from(config: LspConfig) -> Self {
        Self {
            auto_install: config.auto_install,
            servers: config.servers,
            custom_servers: config.custom_servers,
        }
    }
}

/// Get the global LSP configuration.
#[tauri::command]
pub async fn lsp_get_global_config() -> Result<GlobalLspConfig, String> {
    let config = config::global_config().read().await;
    Ok(GlobalLspConfig::from(config.clone()))
}

/// Update the global LSP configuration.
#[tauri::command]
pub async fn lsp_set_global_config(config: GlobalLspConfig) -> Result<(), String> {
    config::update_config(|cfg| {
        cfg.auto_install = config.auto_install;
        cfg.servers = config.servers;
        cfg.custom_servers = config.custom_servers;
    })
    .await
    .map_err(|e| e.to_string())
}

/// Set the auto-install toggle.
#[tauri::command]
pub async fn lsp_set_auto_install(enabled: bool) -> Result<(), String> {
    config::update_config(|cfg| {
        cfg.auto_install = enabled;
    })
    .await
    .map_err(|e| e.to_string())
}

/// Enable or disable a specific server.
#[tauri::command]
pub async fn lsp_set_server_enabled_global(server_id: String, enabled: bool) -> Result<(), String> {
    config::update_config(|cfg| {
        let override_config = cfg
            .servers
            .entry(server_id)
            .or_insert_with(|| ServerOverride {
                enabled: true,
                binary_path: None,
                args: None,
                env: std::collections::HashMap::new(),
                init_options: None,
            });
        override_config.enabled = enabled;
    })
    .await
    .map_err(|e| e.to_string())
}

/// Reload the global config from disk.
#[tauri::command]
pub async fn lsp_reload_global_config() -> Result<GlobalLspConfig, String> {
    config::reload_config().await.map_err(|e| e.to_string())?;
    let config = config::global_config().read().await;
    Ok(GlobalLspConfig::from(config.clone()))
}
