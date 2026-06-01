//! Post-edit diagnostics hook called by `processor.rs` after every file
//! mutation tool. Spins up the LSP server on demand, opens / changes the
//! document, and returns the error/warning slice formatted for inline
//! injection into the assistant turn.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use lsp::types::{Diagnostic, DiagnosticSeverity};
use tauri::AppHandle;
use tokio::sync::Mutex;
use tracing::debug;

use lsp::LspManager;

use super::format::format_diagnostics;
use super::language::{
    document_language_id_for_file, infer_workspace_root, language_for_file, path_to_uri,
};

/// Fetch diagnostics for a file from the LSP manager.
/// Used by the post-edit diagnostics hook in `processor.rs`.
pub async fn get_post_edit_diagnostics(
    lsp_manager: &Arc<Mutex<LspManager>>,
    app_handle: &AppHandle,
    workspace_root: &Path,
    file_path: &str,
) -> Option<String> {
    let language = language_for_file(file_path)?;
    let document_language_id = document_language_id_for_file(file_path)?;
    let uri = path_to_uri(file_path);
    let manager = lsp_manager.lock().await;

    if !manager.is_server_running(language).await {
        let root_path = infer_workspace_root(file_path, workspace_root);
        let root_path_str = root_path.to_string_lossy().to_string();
        if manager
            .start_server(language, &root_path_str, app_handle.clone())
            .await
            .is_err()
        {
            return None;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }

    let content = match tokio::fs::read_to_string(file_path).await {
        Ok(text) => text,
        Err(err) => {
            debug!(
                "post-edit diagnostics: failed to read {}: {}",
                file_path, err
            );
            return None;
        }
    };

    // Pick a version that's almost certainly higher than whatever the
    // LspTool has tracked for this URI in the current session — the two
    // version sequences are independent (one per LspTool instance, one per
    // post-edit hook call) and rust-analyzer / pyright both refuse a
    // `did_change` with a non-monotonically-increasing version. We start
    // post-edit versions from `POST_EDIT_VERSION_BASE` so the LspTool
    // would have to fire >1B operations to clash. `did_open` is sent with
    // version 1 first because LSP servers reset the document's version
    // counter on every open.
    const POST_EDIT_VERSION_BASE: i32 = 1_000_000_001;
    if let Err(err) = manager
        .did_open(document_language_id, &uri, 1, &content)
        .await
    {
        debug!(
            "post-edit diagnostics: did_open failed ({}), trying did_change",
            err
        );
        if let Err(err) = manager
            .did_change(language, &uri, POST_EDIT_VERSION_BASE, &content)
            .await
        {
            debug!("post-edit diagnostics: did_change also failed: {}", err);
        }
    }

    drop(manager);
    tokio::time::sleep(Duration::from_millis(500)).await;

    let manager = lsp_manager.lock().await;
    let diagnostics = match manager.get_file_diagnostics(language, &uri).await {
        Ok(diag) => diag,
        Err(err) => {
            debug!(
                "post-edit diagnostics: get_file_diagnostics failed: {}",
                err
            );
            return None;
        }
    };

    let issues: Vec<Diagnostic> = diagnostics
        .into_iter()
        .filter(is_actionable_diagnostic)
        .collect();

    if issues.is_empty() {
        return None;
    }

    Some(format!(
        "\n\n[LSP diagnostics after edit]:\n{}",
        format_diagnostics(&issues)
    ))
}

/// Whether a diagnostic should be surfaced to the agent in the
/// post-edit hook. Only `Error` and `Warning` qualify — info and hint
/// would just bloat the assistant's context, and a missing severity
/// means the server didn't classify the issue, which we treat as
/// "don't surface".
///
/// Pure on the typed `Diagnostic` so it can be unit-tested without a
/// running LSP server.
pub(super) fn is_actionable_diagnostic(diagnostic: &Diagnostic) -> bool {
    matches!(
        diagnostic.severity,
        Some(DiagnosticSeverity::ERROR) | Some(DiagnosticSeverity::WARNING)
    )
}

#[cfg(test)]
mod tests {
    use super::{is_actionable_diagnostic, Diagnostic, DiagnosticSeverity};
    use lsp::types::{Position, Range};

    fn diag(severity: Option<DiagnosticSeverity>) -> Diagnostic {
        Diagnostic {
            range: Range {
                start: Position {
                    line: 0,
                    character: 0,
                },
                end: Position {
                    line: 0,
                    character: 0,
                },
            },
            severity,
            code: None,
            code_description: None,
            source: None,
            message: "test".to_string(),
            related_information: None,
            tags: None,
            data: None,
        }
    }

    #[test]
    fn surface_errors() {
        assert!(is_actionable_diagnostic(&diag(Some(
            DiagnosticSeverity::ERROR
        ))));
    }

    #[test]
    fn surface_warnings() {
        assert!(is_actionable_diagnostic(&diag(Some(
            DiagnosticSeverity::WARNING
        ))));
    }

    #[test]
    fn drop_info_and_hint() {
        // Info and hint are too noisy to inject into the assistant turn.
        assert!(!is_actionable_diagnostic(&diag(Some(
            DiagnosticSeverity::INFORMATION
        ))));
        assert!(!is_actionable_diagnostic(&diag(Some(
            DiagnosticSeverity::HINT
        ))));
    }

    #[test]
    fn drop_when_severity_missing() {
        // A server that didn't classify the issue: don't surface.
        assert!(!is_actionable_diagnostic(&diag(None)));
    }
}
