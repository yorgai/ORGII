//! Re-exports of the LSP message bodies we use, plus the small set of
//! ergonomic helpers we layer on top of `lsp_types`.
//!
//! This module used to hand-roll a handful of types (`TextDocumentItem`,
//! `ServerCapabilities`, …) that duplicated `lsp_types`. Phase 9 of the
//! LSP optimisation plan switched to the upstream crate so we get
//! schema-correct serde for every variant we don't currently bother
//! parsing (`MarkedString[]`, `LocationLink`, …) and so future LSP
//! methods can be added without writing more `serde_json::json!`
//! boilerplate.
//!
//! We still own the JSON-RPC envelope (`core_types::jsonrpc`) and the
//! stdio framing layer (`protocol::format_lsp_message`) — `lsp_types`
//! only models LSP-level payloads.

pub use lsp_types::{
    Diagnostic, DiagnosticSeverity, DidChangeTextDocumentParams, DidCloseTextDocumentParams,
    DidOpenTextDocumentParams, GotoDefinitionParams, GotoDefinitionResponse, Hover, HoverContents,
    HoverParams, InitializeParams, InitializeResult, LanguageString, Location, LocationLink,
    MarkedString, MarkupContent, MarkupKind, NumberOrString, Position, PublishDiagnosticsParams,
    Range, ReferenceContext, ReferenceParams, ServerCapabilities, TextDocumentContentChangeEvent,
    TextDocumentIdentifier, TextDocumentItem, TextDocumentPositionParams,
    TextDocumentSyncCapability, TextDocumentSyncKind, Uri, VersionedTextDocumentIdentifier,
    WorkspaceFolder,
};

/// Small ergonomic layer over `lsp_types::ServerCapabilities` so the
/// rest of the crate keeps a stable `supports_*` API across upstream
/// schema changes.
///
/// The LSP spec lets each `*Provider` field be either a bare `bool` or
/// a server-specific options object. `lsp_types` models this with
/// `Option<OneOf<bool, …Options>>`, so we wrap the variants once and
/// callers stay readable.
pub trait ServerCapabilitiesExt {
    fn supports_hover(&self) -> bool;
    fn supports_definition(&self) -> bool;
    fn supports_references(&self) -> bool;
    /// Resolved `textDocument/didChange` sync mode. Defaults to
    /// `None` (sync disabled) when the server didn't advertise the
    /// field — the LSP spec leaves the default open, so the safe
    /// stance is "don't ship change notifications until told to."
    /// `did_change` callers gate on this.
    fn text_document_sync_kind(&self) -> TextDocumentSyncKind;
}

impl ServerCapabilitiesExt for ServerCapabilities {
    fn supports_hover(&self) -> bool {
        match self.hover_provider.as_ref() {
            None => false,
            Some(lsp_types::HoverProviderCapability::Simple(b)) => *b,
            Some(lsp_types::HoverProviderCapability::Options(_)) => true,
        }
    }

    fn supports_definition(&self) -> bool {
        match self.definition_provider.as_ref() {
            None => false,
            Some(lsp_types::OneOf::Left(b)) => *b,
            Some(lsp_types::OneOf::Right(_)) => true,
        }
    }

    fn supports_references(&self) -> bool {
        match self.references_provider.as_ref() {
            None => false,
            Some(lsp_types::OneOf::Left(b)) => *b,
            Some(lsp_types::OneOf::Right(_)) => true,
        }
    }

    fn text_document_sync_kind(&self) -> TextDocumentSyncKind {
        match self.text_document_sync.as_ref() {
            None => TextDocumentSyncKind::NONE,
            Some(TextDocumentSyncCapability::Kind(kind)) => *kind,
            // `TextDocumentSyncOptions::change` is itself optional —
            // when absent the server is saying "I take didOpen/didClose
            // but no didChange." Treat that as `NONE` so callers skip.
            Some(TextDocumentSyncCapability::Options(opts)) => {
                opts.change.unwrap_or(TextDocumentSyncKind::NONE)
            }
        }
    }
}

#[cfg(test)]
mod capability_tests {
    use super::{ServerCapabilities, ServerCapabilitiesExt};
    use serde_json::json;

    fn parse(value: serde_json::Value) -> ServerCapabilities {
        serde_json::from_value(value).expect("ServerCapabilities should deserialize")
    }

    #[test]
    fn supports_when_bool_true() {
        let caps = parse(json!({
            "hoverProvider": true,
            "definitionProvider": true,
            "referencesProvider": true
        }));
        assert!(caps.supports_hover());
        assert!(caps.supports_definition());
        assert!(caps.supports_references());
    }

    #[test]
    fn supports_when_options_object() {
        // typescript-language-server style: options object instead of bare bool.
        let caps = parse(json!({
            "hoverProvider": { "workDoneProgress": false },
            "definitionProvider": { "linkSupport": true },
            "referencesProvider": { "workDoneProgress": false }
        }));
        assert!(caps.supports_hover());
        assert!(caps.supports_definition());
        assert!(caps.supports_references());
    }

    #[test]
    fn does_not_support_when_false() {
        let caps = parse(json!({
            "hoverProvider": false,
            "definitionProvider": false,
            "referencesProvider": false
        }));
        assert!(!caps.supports_hover());
        assert!(!caps.supports_definition());
        assert!(!caps.supports_references());
    }

    #[test]
    fn does_not_support_when_missing_or_null() {
        let caps = parse(json!({
            "hoverProvider": null
        }));
        assert!(!caps.supports_hover());
        assert!(!caps.supports_definition());
        assert!(!caps.supports_references());

        let caps = parse(json!({}));
        assert!(!caps.supports_hover());
        assert!(!caps.supports_definition());
        assert!(!caps.supports_references());
    }

    #[test]
    fn text_document_sync_kind_resolves_bare_kind_form() {
        // Older servers (and the LSP examples) ship `textDocumentSync`
        // as a bare integer kind instead of an options object.
        use super::TextDocumentSyncKind;

        let caps = parse(json!({ "textDocumentSync": 1 }));
        assert_eq!(caps.text_document_sync_kind(), TextDocumentSyncKind::FULL);

        let caps = parse(json!({ "textDocumentSync": 2 }));
        assert_eq!(
            caps.text_document_sync_kind(),
            TextDocumentSyncKind::INCREMENTAL
        );
    }

    #[test]
    fn text_document_sync_kind_resolves_options_form() {
        // Modern servers (rust-analyzer, pyright, gopls) ship the
        // options object. We only care about the `change` field for
        // dispatching `didChange`.
        use super::TextDocumentSyncKind;

        let caps = parse(json!({
            "textDocumentSync": { "openClose": true, "change": 2, "save": true }
        }));
        assert_eq!(
            caps.text_document_sync_kind(),
            TextDocumentSyncKind::INCREMENTAL
        );

        // Options form with `change` omitted means "no didChange".
        let caps = parse(json!({
            "textDocumentSync": { "openClose": true, "save": true }
        }));
        assert_eq!(caps.text_document_sync_kind(), TextDocumentSyncKind::NONE);
    }

    #[test]
    fn text_document_sync_kind_defaults_to_none_when_missing() {
        use super::TextDocumentSyncKind;

        let caps = parse(json!({}));
        assert_eq!(caps.text_document_sync_kind(), TextDocumentSyncKind::NONE);
    }

    #[test]
    fn ignores_unknown_top_level_fields() {
        // We only access the subset we use; arbitrary `experimental`
        // fields and well-typed siblings (`workspace`) must not break
        // parsing of the providers we care about.
        let caps = parse(json!({
            "hoverProvider": true,
            "workspace": { "workspaceFolders": { "supported": true } },
            "experimental": { "anything": 42 }
        }));
        assert!(caps.supports_hover());
        assert!(!caps.supports_definition());
    }
}
