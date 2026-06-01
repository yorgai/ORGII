use crate::tools::impls::coding::manage_lsp::{
    is_language_enabled_in_workspace, normalize_language, resolve_path_or_default,
};
use lsp::workspace_config::WorkspaceLspConfig;
use std::path::Path;

// `canonical_server_id` is a private helper inside the same module, so the
// tests sub-module reaches it via `super::`.
use super::canonical_server_id;

#[test]
fn normalize_language_maps_common_aliases() {
    assert_eq!(normalize_language("tsx"), "typescript");
    assert_eq!(normalize_language("javascriptreact"), "javascript");
    assert_eq!(normalize_language("bash"), "shellscript");
    assert_eq!(normalize_language("c++"), "cpp");
}

#[test]
fn is_language_enabled_in_workspace_uses_disabled_list() {
    let workspace_config = WorkspaceLspConfig {
        disabled: vec!["typescript".to_string()],
    };

    assert!(!is_language_enabled_in_workspace(
        &workspace_config,
        "typescript"
    ));
    assert!(is_language_enabled_in_workspace(&workspace_config, "rust"));
}

#[test]
fn resolve_path_or_default_uses_default_when_missing() {
    let default_path = Path::new("/workspace");

    assert_eq!(resolve_path_or_default(None, default_path), "/workspace");
    assert_eq!(
        resolve_path_or_default(Some("   ".to_string()), default_path),
        "/workspace"
    );
    assert_eq!(
        resolve_path_or_default(Some("/custom/path".to_string()), default_path),
        "/custom/path"
    );
}

#[test]
fn canonical_server_id_collapses_c_to_cpp() {
    // The clangd ServerDef has id "cpp" but accepts both "c" and "cpp"
    // language ids — the running-server-set is keyed by id, so a list-row
    // for "c" must look up "cpp" to find the server.
    assert_eq!(canonical_server_id("c"), "cpp");
    assert_eq!(canonical_server_id("cpp"), "cpp");
}

#[test]
fn canonical_server_id_collapses_javascript_to_typescript() {
    assert_eq!(canonical_server_id("javascript"), "typescript");
    assert_eq!(canonical_server_id("typescript"), "typescript");
}

#[test]
fn canonical_server_id_passes_through_unknown() {
    assert_eq!(
        canonical_server_id("definitely-unknown"),
        "definitely-unknown"
    );
}

#[test]
fn canonical_server_id_one_to_one_for_simple_servers() {
    assert_eq!(canonical_server_id("rust"), "rust");
    assert_eq!(canonical_server_id("python"), "python");
    assert_eq!(canonical_server_id("go"), "go");
}
