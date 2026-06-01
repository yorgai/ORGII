//! Pure formatters that turn typed `lsp_types::*` responses into
//! agent-readable text.
//!
//! Kept entirely separate from the `LspTool` so the tool impl in
//! `mod.rs` reads as a thin "send LSP request → format response"
//! pipeline and so tests / the post-edit hook can reuse the formatters
//! without spinning up a full tool. As of Phase 9 of the LSP plan,
//! these helpers consume the typed `lsp_types` structs directly — the
//! crate boundary, not these formatters, is now the JSON↔Rust seam.

use lsp::types::{
    Diagnostic, DiagnosticSeverity, GotoDefinitionResponse, Hover, HoverContents, Location,
    LocationLink, MarkedString,
};

/// Format LSP diagnostics into a human-readable string.
pub(super) fn format_diagnostics(diagnostics: &[Diagnostic]) -> String {
    if diagnostics.is_empty() {
        return "No diagnostics.".to_string();
    }

    let mut lines = Vec::new();
    for diag in diagnostics {
        let severity = severity_label(diag.severity);
        let message = diag.message.as_str();
        let source = diag.source.as_deref().unwrap_or("");
        // LSP positions are 0-indexed; humans expect 1-indexed.
        let line = diag.range.start.line + 1;
        let col = diag.range.start.character + 1;

        if source.is_empty() {
            lines.push(format!("  L{}:{} [{}] {}", line, col, severity, message));
        } else {
            lines.push(format!(
                "  L{}:{} [{}] {} ({})",
                line, col, severity, message, source
            ));
        }
    }

    lines.join("\n")
}

/// Format an `Option<GotoDefinitionResponse>` into readable text.
/// `None` (server replied `null`) and an empty array both render as
/// "No results found."
pub(super) fn format_locations(response: &Option<GotoDefinitionResponse>) -> String {
    match response {
        None => "No results found.".to_string(),
        Some(GotoDefinitionResponse::Scalar(loc)) => {
            format_location_lines(std::slice::from_ref(loc))
        }
        Some(GotoDefinitionResponse::Array(locs)) => format_location_lines(locs),
        Some(GotoDefinitionResponse::Link(links)) => format_location_link_lines(links),
    }
}

/// Format a `Vec<Location>` (textDocument/references response) into
/// readable text. `None` and `Some(empty)` both render as "No results
/// found."
pub(super) fn format_reference_locations(response: &Option<Vec<Location>>) -> String {
    match response.as_deref() {
        None | Some([]) => "No results found.".to_string(),
        Some(locs) => format_location_lines(locs),
    }
}

fn format_location_lines(locations: &[Location]) -> String {
    if locations.is_empty() {
        return "No results found.".to_string();
    }
    locations
        .iter()
        .map(|loc| {
            let path = uri_to_path(&loc.uri.to_string());
            let line = loc.range.start.line + 1;
            let col = loc.range.start.character + 1;
            format!("  {}:{}:{}", path, line, col)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn format_location_link_lines(links: &[LocationLink]) -> String {
    if links.is_empty() {
        return "No results found.".to_string();
    }
    links
        .iter()
        .map(|link| {
            let path = uri_to_path(&link.target_uri.to_string());
            let line = link.target_range.start.line + 1;
            format!("  {}:{}", path, line)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Format `Option<Hover>` into readable text. Empty / whitespace-only
/// hovers fall through to a stable "no info" string.
pub(super) fn format_hover(hover: &Option<Hover>) -> String {
    let Some(hover) = hover else {
        return "No hover information available.".to_string();
    };

    let text = match &hover.contents {
        HoverContents::Scalar(MarkedString::String(text)) => text.clone(),
        HoverContents::Scalar(MarkedString::LanguageString(ls)) => ls.value.clone(),
        HoverContents::Markup(markup) => markup.value.clone(),
        HoverContents::Array(items) => items
            .iter()
            .map(|item| match item {
                MarkedString::String(text) => text.clone(),
                MarkedString::LanguageString(ls) => ls.value.clone(),
            })
            .filter(|s| !s.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n\n"),
    };

    if text.trim().is_empty() {
        "No hover information available.".to_string()
    } else {
        text
    }
}

/// Wire-string severity label. We keep `unknown` for the `None` case
/// so the agent sees that the server didn't classify a diagnostic
/// rather than silently bucketing it as `info`.
fn severity_label(severity: Option<DiagnosticSeverity>) -> &'static str {
    match severity {
        Some(DiagnosticSeverity::ERROR) => "error",
        Some(DiagnosticSeverity::WARNING) => "warning",
        Some(DiagnosticSeverity::INFORMATION) => "info",
        Some(DiagnosticSeverity::HINT) => "hint",
        _ => "unknown",
    }
}

fn uri_to_path(uri: &str) -> String {
    uri.strip_prefix("file://").unwrap_or(uri).to_string()
}
