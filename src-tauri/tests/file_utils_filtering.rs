//! Integration test: file_utils path filtering
//!
//! Validates the ignore/filter logic used across search, sync, and indexing
//! to ensure consistent path handling.

use file_ops::{filter_ignored_paths, should_ignore_path, should_ignore_paths_batch};

// -- well-known directories --

#[test]
fn ignores_standard_dirs() {
    let dirs = [
        "node_modules/package/index.js",
        ".git/objects/abc123",
        "target/debug/build/foo",
        "__pycache__/module.pyc",
        ".next/static/chunks/main.js",
        "venv/lib/python3.11/site.py",
    ];

    for path in &dirs {
        let result = should_ignore_path(path.to_string(), None);
        assert!(
            result.should_ignore,
            "{path} should be ignored, got reason: {}",
            result.reason
        );
    }
}

#[test]
fn allows_source_files() {
    let paths = [
        "src/main.rs",
        "lib/utils.ts",
        "app/components/Button.tsx",
        "tests/test_main.py",
        "docs/README.md",
    ];

    for path in &paths {
        let result = should_ignore_path(path.to_string(), None);
        assert!(
            !result.should_ignore,
            "{path} should NOT be ignored, got reason: {}",
            result.reason
        );
    }
}

// -- dotfile handling --

#[test]
fn whitelisted_dotfiles_not_ignored() {
    let allowed = [".gitignore", ".editorconfig", ".github/workflows/ci.yml"];

    for path in &allowed {
        let result = should_ignore_path(path.to_string(), None);
        assert!(
            !result.should_ignore,
            "{path} should be allowed (whitelisted dotfile), got reason: {}",
            result.reason
        );
    }
}

#[test]
fn security_sensitive_paths_blocked() {
    let blocked = [".env", ".ssh/id_rsa", ".git/config"];

    for path in &blocked {
        let result = should_ignore_path(path.to_string(), None);
        assert!(
            result.should_ignore,
            "{path} should be blocked (security sensitive), got reason: {}",
            result.reason
        );
    }
}

// -- gitignore patterns --

#[test]
fn custom_gitignore_patterns_applied() {
    let patterns = vec!["*.log".to_string(), "build/".to_string()];

    let log_result = should_ignore_path("app/debug.log".to_string(), Some(patterns.clone()));
    assert!(log_result.should_ignore, "*.log pattern should match");

    let build_result = should_ignore_path("build/output.js".to_string(), Some(patterns));
    assert!(build_result.should_ignore, "build/ pattern should match");
}

// -- batch filtering --

#[test]
fn batch_matches_individual_calls() {
    let paths = vec![
        "src/main.rs".to_string(),
        "node_modules/foo/index.js".to_string(),
        "tests/test.py".to_string(),
        ".git/HEAD".to_string(),
        "README.md".to_string(),
    ];

    let batch_results = should_ignore_paths_batch(paths.clone(), None);
    for (path, batch_result) in paths.iter().zip(batch_results.iter()) {
        let individual = should_ignore_path(path.clone(), None);
        assert_eq!(
            batch_result.should_ignore, individual.should_ignore,
            "batch and individual should agree for {path}"
        );
    }
}

#[test]
fn filter_ignored_returns_only_allowed() {
    let paths = vec![
        "src/lib.rs".to_string(),
        "node_modules/pkg/index.js".to_string(),
        "tests/unit.py".to_string(),
        "target/debug/app".to_string(),
        "docs/guide.md".to_string(),
    ];

    let filtered = filter_ignored_paths(paths, None);

    assert!(filtered.contains(&"src/lib.rs".to_string()));
    assert!(filtered.contains(&"tests/unit.py".to_string()));
    assert!(filtered.contains(&"docs/guide.md".to_string()));
    assert!(!filtered.contains(&"node_modules/pkg/index.js".to_string()));
    assert!(!filtered.contains(&"target/debug/app".to_string()));
}
