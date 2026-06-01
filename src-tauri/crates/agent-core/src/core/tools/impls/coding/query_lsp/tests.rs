use crate::tools::impls::coding::query_lsp::*;
use lsp::types::{
    Diagnostic, DiagnosticSeverity, GotoDefinitionResponse, Hover, HoverContents, Location,
    LocationLink, MarkedString, MarkupContent, MarkupKind, Position, Range, Uri,
};
use serde_json::json;
use std::str::FromStr;

// Helpers — these keep the formatter tests readable. The fields we
// don't exercise are filled with `Default::default()` / `None`.
fn diag(
    severity: Option<DiagnosticSeverity>,
    line: u32,
    character: u32,
    message: &str,
    source: Option<&str>,
) -> Diagnostic {
    Diagnostic {
        range: Range {
            start: Position { line, character },
            end: Position {
                line,
                character: character + 1,
            },
        },
        severity,
        code: None,
        code_description: None,
        source: source.map(str::to_string),
        message: message.to_string(),
        related_information: None,
        tags: None,
        data: None,
    }
}

fn loc(uri: &str, line: u32, character: u32) -> Location {
    Location {
        uri: Uri::from_str(uri).unwrap(),
        range: Range {
            start: Position { line, character },
            end: Position {
                line,
                character: character + 1,
            },
        },
    }
}

// -- language_for_file --

#[test]
fn language_for_file_ts() {
    assert_eq!(super::language_for_file("foo.ts"), Some("typescript"));
}

#[test]
fn language_for_file_tsx() {
    assert_eq!(super::language_for_file("foo.tsx"), Some("typescript"));
}

#[test]
fn language_for_file_js() {
    assert_eq!(super::language_for_file("foo.js"), Some("javascript"));
}

#[test]
fn language_for_file_jsx() {
    assert_eq!(super::language_for_file("foo.jsx"), Some("javascript"));
}

#[test]
fn language_for_file_mjs() {
    assert_eq!(super::language_for_file("foo.mjs"), Some("javascript"));
}

#[test]
fn language_for_file_cjs() {
    assert_eq!(super::language_for_file("foo.cjs"), Some("javascript"));
}

#[test]
fn language_for_file_rs() {
    assert_eq!(super::language_for_file("foo.rs"), Some("rust"));
}

#[test]
fn language_for_file_py() {
    assert_eq!(super::language_for_file("foo.py"), Some("python"));
}

#[test]
fn language_for_file_pyi() {
    assert_eq!(super::language_for_file("foo.pyi"), Some("python"));
}

#[test]
fn language_for_file_go() {
    assert_eq!(super::language_for_file("foo.go"), Some("go"));
}

#[test]
fn language_for_file_java() {
    assert_eq!(super::language_for_file("foo.java"), Some("java"));
}

#[test]
fn language_for_file_swift() {
    assert_eq!(super::language_for_file("foo.swift"), Some("swift"));
}

#[test]
fn language_for_file_html() {
    assert_eq!(super::language_for_file("foo.html"), Some("html"));
}

#[test]
fn language_for_file_css() {
    assert_eq!(super::language_for_file("foo.css"), Some("css"));
}

#[test]
fn language_for_file_scss() {
    assert_eq!(super::language_for_file("foo.scss"), Some("css"));
}

#[test]
fn language_for_file_json() {
    assert_eq!(super::language_for_file("foo.json"), Some("json"));
}

#[test]
fn language_for_file_yaml() {
    assert_eq!(super::language_for_file("foo.yaml"), Some("yaml"));
}

#[test]
fn language_for_file_md() {
    assert_eq!(super::language_for_file("foo.md"), Some("markdown"));
}

#[test]
fn language_for_file_sh() {
    assert_eq!(super::language_for_file("foo.sh"), Some("shellscript"));
}

#[test]
fn language_for_file_vue() {
    assert_eq!(super::language_for_file("foo.vue"), Some("vue"));
}

#[test]
fn language_for_file_svelte() {
    assert_eq!(super::language_for_file("foo.svelte"), Some("svelte"));
}

#[test]
fn language_for_file_zig() {
    assert_eq!(super::language_for_file("foo.zig"), Some("zig"));
}

#[test]
fn language_for_file_unknown_returns_none() {
    assert_eq!(super::language_for_file("foo.unknown"), None);
}

#[test]
fn language_for_file_no_ext_returns_none() {
    assert_eq!(super::language_for_file("noext"), None);
}

#[test]
fn document_language_id_for_tsx() {
    assert_eq!(
        super::document_language_id_for_file("foo.tsx"),
        Some("typescriptreact")
    );
}

#[test]
fn document_language_id_for_jsx() {
    assert_eq!(
        super::document_language_id_for_file("foo.jsx"),
        Some("javascriptreact")
    );
}

#[test]
fn infer_workspace_root_prefers_nearest_marker() {
    let fallback = std::path::Path::new("/workspace");
    let root = super::infer_workspace_root("/workspace/apps/web/src/main.tsx", fallback);
    assert_eq!(root, std::path::PathBuf::from("/workspace"));
}

// -- path_to_uri --

#[test]
fn path_to_uri_absolute_path() {
    assert_eq!(
        super::path_to_uri("/Users/me/file.rs"),
        "file:///Users/me/file.rs"
    );
}

#[test]
fn path_to_uri_passthrough_already_uri() {
    assert_eq!(
        super::path_to_uri("file:///already/uri"),
        "file:///already/uri"
    );
}

// -- format_diagnostics --

#[test]
fn format_diagnostics_empty() {
    let diags: Vec<Diagnostic> = vec![];
    assert_eq!(format_diagnostics(&diags), "No diagnostics.");
}

#[test]
fn format_diagnostics_single_error() {
    let diags = vec![diag(
        Some(DiagnosticSeverity::ERROR),
        0,
        5,
        "err",
        Some("rust"),
    )];
    let out = format_diagnostics(&diags);
    assert!(out.contains("L1:6"), "0-indexed line 0, char 5 -> L1:6");
    assert!(out.contains("[error]"));
    assert!(out.contains("err"));
    assert!(out.contains("(rust)"));
}

#[test]
fn format_diagnostics_without_source() {
    let diags = vec![diag(
        Some(DiagnosticSeverity::ERROR),
        2,
        0,
        "no source",
        None,
    )];
    let out = format_diagnostics(&diags);
    assert!(out.contains("L3:1"));
    assert!(out.contains("[error]"));
    assert!(out.contains("no source"));
    assert!(
        !out.contains('('),
        "no parenthesized source when source empty"
    );
}

#[test]
fn format_diagnostics_multiple() {
    let diags = vec![
        diag(Some(DiagnosticSeverity::ERROR), 0, 0, "first", None),
        diag(Some(DiagnosticSeverity::WARNING), 1, 3, "second", None),
    ];
    let out = format_diagnostics(&diags);
    assert!(out.contains("first"));
    assert!(out.contains("second"));
    assert!(
        out.contains('\n'),
        "multiple diagnostics produce multiple lines"
    );
}

// ----------------------------------------------------------------------
// Case-insensitive extension matching (was a bug: `foo.TS` returned None)
// ----------------------------------------------------------------------

#[test]
fn language_for_file_uppercase_ts() {
    assert_eq!(super::language_for_file("foo.TS"), Some("typescript"));
}

#[test]
fn language_for_file_uppercase_rs() {
    assert_eq!(super::language_for_file("FOO.RS"), Some("rust"));
}

#[test]
fn language_for_file_mixedcase_py() {
    assert_eq!(super::language_for_file("Foo.Py"), Some("python"));
}

#[test]
fn document_language_id_uppercase_tsx() {
    assert_eq!(
        super::document_language_id_for_file("Component.TSX"),
        Some("typescriptreact")
    );
}

#[test]
fn language_for_file_mts_cts() {
    assert_eq!(super::language_for_file("foo.mts"), Some("typescript"));
    assert_eq!(super::language_for_file("foo.cts"), Some("typescript"));
}

// ----------------------------------------------------------------------
// Special filenames (Dockerfile has no extension; was a bug — fell through)
// ----------------------------------------------------------------------

#[test]
fn language_for_file_dockerfile_basename() {
    assert_eq!(super::language_for_file("Dockerfile"), Some("dockerfile"));
    assert_eq!(
        super::language_for_file("/repo/Dockerfile"),
        Some("dockerfile")
    );
}

#[test]
fn language_for_file_dockerfile_dev_variant() {
    assert_eq!(
        super::language_for_file("Dockerfile.dev"),
        Some("dockerfile")
    );
    assert_eq!(
        super::language_for_file("Dockerfile.production"),
        Some("dockerfile")
    );
}

#[test]
fn language_for_file_dockerfile_lowercase() {
    assert_eq!(super::language_for_file("dockerfile"), Some("dockerfile"));
}

#[test]
fn language_for_file_containerfile_basename() {
    assert_eq!(
        super::language_for_file("Containerfile"),
        Some("dockerfile")
    );
}

#[test]
fn document_language_id_dockerfile_basename() {
    assert_eq!(
        super::document_language_id_for_file("Dockerfile"),
        Some("dockerfile")
    );
}

// ----------------------------------------------------------------------
// Path edge cases
// ----------------------------------------------------------------------

#[test]
fn language_for_file_dotted_directory() {
    // `foo.bar/baz.rs` — extension is `rs` not `bar`. The original
    // `rsplit` impl was wrong here; the file-name based reading should
    // still find the trailing `.rs`.
    assert_eq!(
        super::language_for_file("/path/foo.bar/baz.rs"),
        Some("rust")
    );
}

#[test]
fn language_for_file_path_with_spaces() {
    assert_eq!(
        super::language_for_file("/Users/me/My Documents/main.py"),
        Some("python")
    );
}

#[test]
fn path_to_uri_path_with_spaces_kept_literal() {
    // File URIs technically need percent-encoding, but the existing
    // implementation passes the raw path through — locking the contract
    // here so a future "fix" to URL-encode is at least intentional and
    // updates every call site.
    assert_eq!(
        super::path_to_uri("/Users/me/My Documents/main.py"),
        "file:///Users/me/My Documents/main.py"
    );
}

// ----------------------------------------------------------------------
// extract_position 0/1-indexed conversion
// ----------------------------------------------------------------------

#[test]
fn extract_position_rejects_line_zero() {
    let params = json!({ "line": 0, "character": 1 });
    let err = super::extract_position(&params).unwrap_err();
    let msg = format!("{:?}", err);
    assert!(msg.contains("line"), "error mentions 'line'");
    assert!(msg.contains("1-indexed"), "error explains the convention");
}

#[test]
fn extract_position_rejects_character_zero() {
    let params = json!({ "line": 1, "character": 0 });
    let err = super::extract_position(&params).unwrap_err();
    let msg = format!("{:?}", err);
    assert!(msg.contains("character"));
}

#[test]
fn extract_position_converts_to_zero_indexed() {
    let params = json!({ "line": 5, "character": 10 });
    let (line, character) = super::extract_position(&params).unwrap();
    assert_eq!(line, 4, "1-indexed line 5 -> 0-indexed line 4");
    assert_eq!(character, 9, "1-indexed char 10 -> 0-indexed char 9");
}

#[test]
fn extract_position_missing_line_is_invalid() {
    let params = json!({ "character": 1 });
    let err = super::extract_position(&params).unwrap_err();
    let msg = format!("{:?}", err);
    assert!(msg.contains("line"));
}

#[test]
fn extract_position_missing_character_is_invalid() {
    let params = json!({ "line": 1 });
    let err = super::extract_position(&params).unwrap_err();
    let msg = format!("{:?}", err);
    assert!(msg.contains("character"));
}

// ----------------------------------------------------------------------
// format_locations — covers null, empty, Scalar, Array, and Link
// variants of `GotoDefinitionResponse`. textDocument/definition can
// return any of these.
// ----------------------------------------------------------------------

#[test]
fn format_locations_null_returns_no_results() {
    let response: Option<GotoDefinitionResponse> = None;
    assert_eq!(format_locations(&response), "No results found.");
}

#[test]
fn format_locations_empty_array() {
    let response = Some(GotoDefinitionResponse::Array(vec![]));
    assert_eq!(format_locations(&response), "No results found.");
}

#[test]
fn format_locations_single_location_object() {
    let response = Some(GotoDefinitionResponse::Scalar(loc(
        "file:///path/foo.rs",
        9,
        4,
    )));
    let out = format_locations(&response);
    assert!(out.contains("/path/foo.rs"));
    assert!(out.contains(":10:5"), "0-indexed (9,4) -> (10,5) in output");
}

#[test]
fn format_locations_array_of_locations() {
    let response = Some(GotoDefinitionResponse::Array(vec![
        loc("file:///a.rs", 0, 0),
        loc("file:///b.rs", 5, 2),
    ]));
    let out = format_locations(&response);
    assert!(out.contains("/a.rs:1:1"));
    assert!(out.contains("/b.rs:6:3"));
}

#[test]
fn format_locations_location_link_variant() {
    // textDocument/definition can return a LocationLink, which uses
    // `target_uri` / `target_range` instead of the plain Location
    // fields.
    let link = LocationLink {
        origin_selection_range: None,
        target_uri: Uri::from_str("file:///link/target.rs").unwrap(),
        target_range: Range {
            start: Position {
                line: 12,
                character: 0,
            },
            end: Position {
                line: 12,
                character: 5,
            },
        },
        target_selection_range: Range {
            start: Position {
                line: 12,
                character: 0,
            },
            end: Position {
                line: 12,
                character: 5,
            },
        },
    };
    let response = Some(GotoDefinitionResponse::Link(vec![link]));
    let out = format_locations(&response);
    assert!(out.contains("/link/target.rs"));
    assert!(out.contains(":13"));
}

#[test]
fn format_locations_strips_file_uri_prefix() {
    let response = Some(GotoDefinitionResponse::Scalar(loc("file:///x.rs", 0, 0)));
    let out = format_locations(&response);
    assert!(
        !out.contains("file://"),
        "agent-facing output strips file:// prefix"
    );
}

// ----------------------------------------------------------------------
// format_hover — Hover.contents is one of MarkupContent, MarkedString,
// or MarkedString[]. Empty / whitespace content must fall back to a
// stable "No hover information" message.
// ----------------------------------------------------------------------

#[test]
fn format_hover_null() {
    let hover: Option<Hover> = None;
    assert_eq!(format_hover(&hover), "No hover information available.");
}

#[test]
fn format_hover_markup_content() {
    let hover = Some(Hover {
        contents: HoverContents::Markup(MarkupContent {
            kind: MarkupKind::Markdown,
            value: "fn foo()".to_string(),
        }),
        range: None,
    });
    assert_eq!(format_hover(&hover), "fn foo()");
}

#[test]
fn format_hover_marked_string_plain() {
    let hover = Some(Hover {
        contents: HoverContents::Scalar(MarkedString::String("raw string".to_string())),
        range: None,
    });
    assert_eq!(format_hover(&hover), "raw string");
}

#[test]
fn format_hover_marked_string_array() {
    use lsp::types::*;
    let hover = Some(Hover {
        contents: HoverContents::Array(vec![
            MarkedString::LanguageString(LanguageString {
                language: "rust".to_string(),
                value: "fn foo()".to_string(),
            }),
            MarkedString::String("extra docs".to_string()),
        ]),
        range: None,
    });
    let out = format_hover(&hover);
    assert!(out.contains("fn foo()"));
    assert!(out.contains("extra docs"));
}

#[test]
fn format_hover_empty_value_falls_back() {
    // Was a bug pre-Phase-9: a plaintext hover with an empty value
    // leaked through. Now we trim and fall back.
    let hover = Some(Hover {
        contents: HoverContents::Markup(MarkupContent {
            kind: MarkupKind::PlainText,
            value: String::new(),
        }),
        range: None,
    });
    assert_eq!(
        format_hover(&hover),
        "No hover information available.",
        "empty hover content should not show empty string to agent"
    );
}

// ----------------------------------------------------------------------
// Workspace root inference edge cases
//
// The walker also `fs::exists`-checks each ancestor for `.git`/`Cargo.toml`
// etc., so we can only assert behavior that does NOT depend on what's on
// the test runner's filesystem above the fallback workspace.
// ----------------------------------------------------------------------

#[test]
fn infer_workspace_root_uses_fallback_when_inside_workspace() {
    // File is inside the fallback workspace but no marker between the two.
    // Doesn't touch the filesystem because the loop short-circuits at
    // `dir == fallback_workspace_root` once `within_workspace` is set.
    let fallback = std::path::Path::new("/nonexistent/workspace");
    let root = super::infer_workspace_root("/nonexistent/workspace/src/main.rs", fallback);
    assert_eq!(root, fallback.to_path_buf());
}

// ----------------------------------------------------------------------
// expand_diagnostic_paths — multi-path / directory expansion
// ----------------------------------------------------------------------

#[test]
fn expand_diagnostic_paths_single_file_passthrough() {
    let dir = tempfile::tempdir().unwrap();
    let file_path = dir.path().join("main.ts");
    std::fs::write(&file_path, "export const x = 1;").unwrap();

    let expanded =
        super::expand_diagnostic_paths(&[file_path.to_string_lossy().into_owned()]).unwrap();
    assert_eq!(expanded.len(), 1);
    assert!(expanded[0].ends_with("main.ts"));
}

#[test]
fn expand_diagnostic_paths_directory_walks_supported_files() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("a.ts"), "").unwrap();
    std::fs::write(dir.path().join("b.rs"), "").unwrap();
    std::fs::write(dir.path().join("README"), "").unwrap();
    std::fs::create_dir(dir.path().join("nested")).unwrap();
    std::fs::write(dir.path().join("nested").join("c.py"), "").unwrap();

    let expanded =
        super::expand_diagnostic_paths(&[dir.path().to_string_lossy().into_owned()]).unwrap();
    let basenames: std::collections::HashSet<String> = expanded
        .iter()
        .filter_map(|path| {
            std::path::Path::new(path)
                .file_name()?
                .to_str()
                .map(String::from)
        })
        .collect();
    assert!(basenames.contains("a.ts"));
    assert!(basenames.contains("b.rs"));
    assert!(basenames.contains("c.py"));
    assert!(
        !basenames.contains("README"),
        "files without a supported language must be filtered"
    );
}

#[test]
fn expand_diagnostic_paths_mixed_inputs_dedupe() {
    let dir = tempfile::tempdir().unwrap();
    let file_path = dir.path().join("a.ts");
    std::fs::write(&file_path, "").unwrap();

    let expanded = super::expand_diagnostic_paths(&[
        file_path.to_string_lossy().into_owned(),
        dir.path().to_string_lossy().into_owned(),
    ])
    .unwrap();
    assert_eq!(
        expanded.len(),
        1,
        "the same file listed via explicit path and via dir walk dedupes"
    );
}

#[test]
fn expand_diagnostic_paths_rejects_missing_path() {
    let err = super::expand_diagnostic_paths(&["/nonexistent/path/x.ts".to_string()]).unwrap_err();
    let msg = format!("{:?}", err);
    assert!(
        msg.contains("does not exist"),
        "error mentions missing path"
    );
}

#[test]
fn expand_diagnostic_paths_empty_dir_returns_empty() {
    let dir = tempfile::tempdir().unwrap();
    let expanded =
        super::expand_diagnostic_paths(&[dir.path().to_string_lossy().into_owned()]).unwrap();
    assert!(expanded.is_empty());
}
