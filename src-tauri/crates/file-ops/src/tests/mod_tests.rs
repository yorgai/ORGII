use crate::{
    is_binary_by_extension, is_binary_content, match_gitignore_pattern, should_ignore_path,
};

#[test]
fn test_binary_extension_detection() {
    // Binary files
    assert!(is_binary_by_extension("image.png".to_string()).is_binary);
    assert!(is_binary_by_extension("video.mp4".to_string()).is_binary);
    assert!(is_binary_by_extension("archive.zip".to_string()).is_binary);

    // Text files
    assert!(!is_binary_by_extension("script.js".to_string()).is_binary);
    assert!(!is_binary_by_extension("style.css".to_string()).is_binary);
    assert!(!is_binary_by_extension("Makefile".to_string()).is_binary);
}

#[test]
fn test_binary_content_detection() {
    // Binary content (null byte)
    let binary = vec![0x00, 0x01, 0x02];
    assert!(is_binary_content(binary, None).is_binary);

    // Text content
    let text = "Hello, World!".as_bytes().to_vec();
    assert!(!is_binary_content(text, None).is_binary);
}

#[test]
fn test_ignore_path() {
    // Hard blocked
    assert!(should_ignore_path(".git/config".to_string(), None).should_ignore);
    assert!(should_ignore_path("src/.env".to_string(), None).should_ignore);

    // Blacklist dirs
    assert!(should_ignore_path("node_modules/package/index.js".to_string(), None).should_ignore);
    assert!(should_ignore_path("src/__pycache__/module.pyc".to_string(), None).should_ignore);

    // Whitelisted
    assert!(!should_ignore_path(".gitignore".to_string(), None).should_ignore);
    assert!(!should_ignore_path(".github/workflows/ci.yml".to_string(), None).should_ignore);

    // Normal files
    assert!(!should_ignore_path("src/index.ts".to_string(), None).should_ignore);
}

#[test]
fn test_gitignore_pattern_matching() {
    assert!(match_gitignore_pattern("dist/bundle.js", "dist/"));
    assert!(match_gitignore_pattern("src/temp.log", "*.log"));
    assert!(!match_gitignore_pattern("src/index.ts", "*.log"));
}
