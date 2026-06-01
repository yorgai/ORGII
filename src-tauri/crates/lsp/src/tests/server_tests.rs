//! Unit tests for pure-logic helpers in `crate::server`.
//!
//! These cover the three Phase-1-through-Phase-13 changes that are
//! pure functions / value types, so they run without spawning a real
//! LSP child process:
//!
//! 1. `DiagnosticsCache` (Phase 4 — bounded LRU + empty-array eviction)
//! 2. `strip_framing_prefix` (Phase 13 — outbound logging helper)
//! 3. `parse_uri` (Phase 9 — `lsp-types::Uri` adoption)
//! 4. `resolve_sync_kind` (Phase 11 — capability-gated `did_change`)
//!
//! The end-to-end concurrency surfaces (`shutdown`, `mark_broken`,
//! `drain_pending_on_close`) live in
//! `tests/server_integration_tests.rs` and use a `tokio::io::duplex`
//! stub server.

use lsp_types::{
    Diagnostic, DiagnosticSeverity, Position, PublishDiagnosticsParams, Range, SaveOptions,
    ServerCapabilities, TextDocumentSyncCapability, TextDocumentSyncKind, TextDocumentSyncOptions,
    TextDocumentSyncSaveOptions,
};

use crate::server::{parse_uri, resolve_sync_kind, strip_framing_prefix, DiagnosticsCache};

// ---------- DiagnosticsCache ---------------------------------------------

fn dummy_diag(line: u32) -> Diagnostic {
    Diagnostic {
        range: Range {
            start: Position { line, character: 0 },
            end: Position {
                line,
                character: 10,
            },
        },
        severity: Some(DiagnosticSeverity::ERROR),
        message: format!("err on line {}", line),
        ..Default::default()
    }
}

fn diag_params(uri_str: &str, lines: &[u32]) -> PublishDiagnosticsParams {
    PublishDiagnosticsParams {
        uri: parse_uri(uri_str).expect("test uri must parse"),
        diagnostics: lines.iter().copied().map(dummy_diag).collect(),
        version: None,
    }
}

#[test]
fn diagnostics_cache_inserts_and_replaces() {
    let mut cache = DiagnosticsCache::default();
    let uri = "file:///a.rs".to_string();

    cache.upsert(uri.clone(), diag_params(&uri, &[1]));
    assert_eq!(cache.get(&uri).unwrap().diagnostics.len(), 1);

    // Replacing an existing URI must NOT evict the slot or grow the
    // ordering deque — that's the path that bug 4 ("infinite cache
    // growth on noisy servers") used to follow.
    cache.upsert(uri.clone(), diag_params(&uri, &[1, 2, 3]));
    assert_eq!(cache.get(&uri).unwrap().diagnostics.len(), 3);
    assert_eq!(cache.snapshot().len(), 1);
}

#[test]
fn diagnostics_cache_empty_array_evicts_existing() {
    // Phase 4 contract: when the server reports "this file is now
    // clean", we drop the entry rather than store an empty Vec. Keeps
    // the bounded cache focused on files that actually have problems.
    let mut cache = DiagnosticsCache::default();
    let uri = "file:///a.rs".to_string();

    cache.upsert(uri.clone(), diag_params(&uri, &[1]));
    assert!(cache.get(&uri).is_some());

    cache.upsert(uri.clone(), diag_params(&uri, &[]));
    assert!(
        cache.get(&uri).is_none(),
        "empty diagnostics array should evict the URI"
    );
    assert!(cache.snapshot().is_empty());
}

#[test]
fn diagnostics_cache_empty_array_for_unknown_uri_is_noop() {
    // We must not panic or insert an empty entry when the server
    // reports clean for a URI we never cached. The original code
    // path was a `remove(&uri); push_back(uri.clone())` — which would
    // have leaked an entry into the order deque without a matching
    // map slot.
    let mut cache = DiagnosticsCache::default();
    cache.upsert(
        "file:///never.rs".into(),
        diag_params("file:///never.rs", &[]),
    );
    assert!(cache.snapshot().is_empty());
}

#[test]
fn diagnostics_cache_evict_explicit_drops_entry() {
    let mut cache = DiagnosticsCache::default();
    let uri = "file:///a.rs".to_string();

    cache.upsert(uri.clone(), diag_params(&uri, &[1]));
    cache.evict(&uri);
    assert!(cache.get(&uri).is_none());

    // Evicting a missing URI is a no-op, not a panic.
    cache.evict("file:///missing.rs");
}

#[test]
fn diagnostics_cache_caps_at_max_diagnostic_files() {
    // Walk past the cap; oldest insertion order entry must drop. We
    // can't read the cap constant directly (it's private to
    // `server.rs`) so we exercise it by inserting more than 500 URIs
    // and asserting `snapshot().len()` plateaus at 500.
    let mut cache = DiagnosticsCache::default();
    for index in 0..550 {
        let uri = format!("file:///f{}.rs", index);
        cache.upsert(uri.clone(), diag_params(&uri, &[1]));
    }
    let snap = cache.snapshot();
    assert_eq!(snap.len(), 500);

    // Earliest entries must be the ones that survived eviction —
    // i.e. files 50..549.
    assert!(!snap.contains_key("file:///f0.rs"));
    assert!(!snap.contains_key("file:///f49.rs"));
    assert!(snap.contains_key("file:///f50.rs"));
    assert!(snap.contains_key("file:///f549.rs"));
}

// ---------- strip_framing_prefix -----------------------------------------

#[test]
fn strip_framing_prefix_removes_lsp_header() {
    let framed = "Content-Length: 17\r\n\r\n{\"jsonrpc\":\"2.0\"}";
    assert_eq!(strip_framing_prefix(framed), "{\"jsonrpc\":\"2.0\"}");
}

#[test]
fn strip_framing_prefix_handles_extra_headers() {
    // LSP allows `Content-Type` between Content-Length and the body
    // separator. The single CRLF inside the header block must not
    // split the body off prematurely; only the double CRLF does.
    let framed = "Content-Length: 4\r\nContent-Type: application/vscode-jsonrpc\r\n\r\nBODY";
    assert_eq!(strip_framing_prefix(framed), "BODY");
}

#[test]
fn strip_framing_prefix_returns_input_when_no_separator() {
    // Defensive fallback: an unframed debug write (or a corrupted
    // payload) must still produce *something* in the log buffer
    // rather than vanish silently.
    let raw = "garbage no separator";
    assert_eq!(strip_framing_prefix(raw), raw);
}

#[test]
fn strip_framing_prefix_round_trips_with_format_lsp_message() {
    use crate::protocol::format_lsp_message;
    let body = r#"{"jsonrpc":"2.0","method":"textDocument/hover"}"#;
    let framed = format_lsp_message(body);
    assert_eq!(strip_framing_prefix(&framed), body);
}

// ---------- parse_uri ----------------------------------------------------

#[test]
fn parse_uri_accepts_well_formed_file_uri() {
    let uri = parse_uri("file:///Users/dev/project/main.rs").unwrap();
    // `lsp_types::Uri` exposes the parsed string via Display; the
    // important guarantee is the round-trip, not the implementation
    // type.
    assert_eq!(uri.to_string(), "file:///Users/dev/project/main.rs");
}

#[test]
fn parse_uri_rejects_malformed_input() {
    let err = parse_uri("not a uri").unwrap_err();
    assert!(
        err.contains("Invalid URI"),
        "error must mention the bad input, got: {}",
        err
    );
}

#[test]
fn parse_uri_rejects_input_with_spaces() {
    // Whitespace inside a URI is invalid per RFC 3986 and
    // `lsp_types::Uri` rejects it. The error string contains the
    // original input so debugging an LLM-generated bad URI is
    // tractable.
    let err = parse_uri("file:///path with spaces/main.rs").unwrap_err();
    assert!(err.contains("Invalid URI"));
    assert!(err.contains("path with spaces"));
}

// ---------- resolve_sync_kind --------------------------------------------

fn caps_with_sync_kind(kind: TextDocumentSyncKind) -> ServerCapabilities {
    ServerCapabilities {
        text_document_sync: Some(TextDocumentSyncCapability::Kind(kind)),
        ..Default::default()
    }
}

#[test]
fn resolve_sync_kind_defaults_to_full_when_capabilities_unknown() {
    // Phase 11 contract: before `initialize` completes we have no
    // capability snapshot. Default to `Full` so we never accidentally
    // skip a `did_change` for a server that genuinely needs it.
    assert_eq!(resolve_sync_kind(None), TextDocumentSyncKind::FULL);
}

#[test]
fn resolve_sync_kind_honours_advertised_none() {
    let caps = caps_with_sync_kind(TextDocumentSyncKind::NONE);
    assert_eq!(resolve_sync_kind(Some(&caps)), TextDocumentSyncKind::NONE);
}

#[test]
fn resolve_sync_kind_honours_advertised_full() {
    let caps = caps_with_sync_kind(TextDocumentSyncKind::FULL);
    assert_eq!(resolve_sync_kind(Some(&caps)), TextDocumentSyncKind::FULL);
}

#[test]
fn resolve_sync_kind_honours_advertised_incremental() {
    let caps = caps_with_sync_kind(TextDocumentSyncKind::INCREMENTAL);
    assert_eq!(
        resolve_sync_kind(Some(&caps)),
        TextDocumentSyncKind::INCREMENTAL
    );
}

#[test]
fn resolve_sync_kind_resolves_options_form() {
    // Real-world servers (rust-analyzer, gopls) advertise the
    // options form rather than the bare kind. The resolver must
    // still pull the `change` field out of the wrapper.
    let caps = ServerCapabilities {
        text_document_sync: Some(TextDocumentSyncCapability::Options(
            TextDocumentSyncOptions {
                open_close: Some(true),
                change: Some(TextDocumentSyncKind::INCREMENTAL),
                will_save: None,
                will_save_wait_until: None,
                save: Some(TextDocumentSyncSaveOptions::Supported(true)),
            },
        )),
        ..Default::default()
    };
    assert_eq!(
        resolve_sync_kind(Some(&caps)),
        TextDocumentSyncKind::INCREMENTAL
    );
}

#[test]
fn resolve_sync_kind_treats_options_without_change_as_none() {
    // When the server advertises the options form but omits the
    // `change` discriminant, the LSP spec treats it as "no document
    // sync". The resolver must propagate that — sending didChange
    // would be a protocol violation.
    let caps = ServerCapabilities {
        text_document_sync: Some(TextDocumentSyncCapability::Options(
            TextDocumentSyncOptions {
                open_close: Some(true),
                change: None,
                will_save: None,
                will_save_wait_until: None,
                save: Some(TextDocumentSyncSaveOptions::SaveOptions(SaveOptions {
                    include_text: Some(false),
                })),
            },
        )),
        ..Default::default()
    };
    assert_eq!(resolve_sync_kind(Some(&caps)), TextDocumentSyncKind::NONE);
}
