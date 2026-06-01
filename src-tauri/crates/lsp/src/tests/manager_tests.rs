use crate::server_defs::{servers, servers_for_language_id};

#[test]
fn supported_languages_resolve_to_server_defs() {
    for language in [
        "typescript",
        "javascript",
        "rust",
        "python",
        "go",
        "c",
        "cpp",
    ] {
        assert!(
            !servers_for_language_id(language).is_empty(),
            "expected at least one server for language `{}`",
            language
        );
    }
}

#[test]
fn unknown_language_has_no_servers() {
    assert!(servers_for_language_id("unknown_lang_xyz").is_empty());
}

#[test]
fn static_servers_cover_typescript_and_rust() {
    let language_ids: Vec<&'static str> = servers::STATIC_SERVERS
        .iter()
        .flat_map(|server_def| server_def.language_ids().iter().copied())
        .collect();

    assert!(language_ids.contains(&"typescript"));
    assert!(language_ids.contains(&"rust"));
}
