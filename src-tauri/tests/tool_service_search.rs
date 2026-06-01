//! Integration test: tool_service::search <-> search::file / search::code
//!
//! Validates that the tool_service search façade produces correct formatted
//! output when wired to the underlying search modules against real temp
//! directories.

use agent_core::tool_infra::search::{code_search_formatted, file_search_formatted};
use search::file::{search_files_fuzzy, SearchOptions};
use std::path::PathBuf;
use tempfile::TempDir;

fn project_dir() -> (TempDir, PathBuf) {
    let dir = TempDir::new().unwrap();
    let root = dir.path().to_path_buf();

    let src = root.join("src");
    std::fs::create_dir_all(&src).unwrap();
    std::fs::write(
        src.join("main.rs"),
        "fn main() {\n    println!(\"hello\");\n}\n",
    )
    .unwrap();
    std::fs::write(
        src.join("lib.rs"),
        "pub fn greet(name: &str) -> String {\n    format!(\"hello {name}\")\n}\n",
    )
    .unwrap();
    std::fs::write(
        src.join("utils.rs"),
        "pub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n",
    )
    .unwrap();
    std::fs::write(root.join("README.md"), "# Test Project\n").unwrap();

    (dir, root)
}

#[tokio::test]
async fn file_search_finds_rust_files() {
    let (_dir, root) = project_dir();

    let result = file_search_formatted("main", &root, 10).await.unwrap();

    assert!(
        result.contains("main.rs"),
        "file search should find main.rs, got: {result}"
    );
}

#[tokio::test]
async fn file_search_no_match_returns_message() {
    let (_dir, root) = project_dir();

    let result = file_search_formatted("nonexistent_xyz", &root, 10)
        .await
        .unwrap();

    assert_eq!(result, "No files found.");
}

#[tokio::test]
async fn code_search_finds_pattern_across_files() {
    let (_dir, root) = project_dir();

    let result = code_search_formatted("fn ", &root, 50, None).await.unwrap();

    let lines: Vec<&str> = result.lines().collect();
    assert!(
        lines.len() >= 3,
        "code search should find fn in at least 3 files, got {} lines: {result}",
        lines.len()
    );
    assert!(result.contains("main.rs"), "should include main.rs");
    assert!(result.contains("lib.rs"), "should include lib.rs");
    assert!(result.contains("utils.rs"), "should include utils.rs");
}

#[tokio::test]
async fn code_search_no_match_returns_message() {
    let (_dir, root) = project_dir();

    let result = code_search_formatted("NONEXISTENT_PATTERN_XYZ", &root, 10, None)
        .await
        .unwrap();

    assert_eq!(result, "No matches found.");
}

#[tokio::test]
async fn file_search_and_native_search_agree() {
    let (_dir, root) = project_dir();

    let formatted = file_search_formatted("utils", &root, 10).await.unwrap();

    let native = search_files_fuzzy(SearchOptions {
        root_path: root.to_string_lossy().to_string(),
        query: "utils".to_string(),
        max_results: Some(10),
        file_extensions: None,
        exclude_dirs: None,
    })
    .await
    .unwrap();

    assert!(
        !native.files.is_empty(),
        "native search should find utils.rs"
    );
    assert!(
        formatted.contains("utils.rs"),
        "formatted output should contain utils.rs"
    );
}
