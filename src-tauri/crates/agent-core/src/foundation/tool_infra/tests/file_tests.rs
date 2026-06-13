use crate::tool_infra::file::*;
use std::path::Path;
use tempfile::TempDir;
use tokio;

// `normalize_lexical` and the test-only `resolve_path` / `list_dir`
// shims all live in private submodules of `file/`. Since this test
// module is included into `file/mod.rs` via `#[path]`, it sits as a
// child of `file` and can reach those helpers through `super::*`.
use super::list::list_dir;
use super::path_resolution::{normalize_lexical, resolve_path};

// ============================================
// resolve_path — basic resolution
// ============================================

#[test]
fn resolve_path_rejects_null_byte() {
    let result = resolve_path("/tmp/foo\0bar", None);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("null byte"));
}

#[test]
fn resolve_path_resolves_absolute_path() {
    let result = resolve_path("/tmp/somefile.txt", None);
    assert!(result.is_ok());
    assert_eq!(result.unwrap().to_str().unwrap(), "/tmp/somefile.txt");
}

#[test]
fn resolve_path_expands_tilde() {
    let result = resolve_path("~/testfile", None);
    assert!(result.is_ok());
    let resolved = result.unwrap();
    assert!(resolved.is_absolute());
    assert!(!resolved.to_str().unwrap().contains('~'));
    assert!(resolved.to_str().unwrap().ends_with("testfile"));
}

#[test]
fn resolve_path_handles_bare_tilde() {
    let result = resolve_path("~", None);
    assert!(result.is_ok());
    let resolved = result.unwrap();
    assert!(resolved.is_absolute());
    assert!(!resolved.to_str().unwrap().contains('~'));
}

// ============================================
// resolve_path — sandboxing
// ============================================

#[test]
fn resolve_path_allows_path_inside_sandbox() {
    let dir = TempDir::new().unwrap();
    let file_path = dir.path().join("allowed.txt");
    std::fs::write(&file_path, "content").unwrap();

    let result = resolve_path(file_path.to_str().unwrap(), Some(dir.path()));
    assert!(result.is_ok());
}

#[test]
fn resolve_path_blocks_path_outside_sandbox() {
    let dir = TempDir::new().unwrap();
    let result = resolve_path("/etc/passwd", Some(dir.path()));
    assert!(result.is_err());
    assert!(result
        .unwrap_err()
        .contains("outside the allowed directory"));
}

#[test]
fn resolve_path_blocks_traversal_attack() {
    let dir = TempDir::new().unwrap();
    let subdir = dir.path().join("sub");
    std::fs::create_dir_all(&subdir).unwrap();

    let sneaky = format!("{}/sub/../../etc/passwd", dir.path().display());
    let result = resolve_path(&sneaky, Some(dir.path()));
    assert!(result.is_err());
}

#[test]
fn resolve_path_allows_new_file_in_existing_parent() {
    let dir = TempDir::new().unwrap();
    let new_file = dir.path().join("newfile.txt");
    let result = resolve_path(new_file.to_str().unwrap(), Some(dir.path()));
    assert!(result.is_ok());
}

// ============================================
// read_file_in_range — line selection
// ============================================

fn write_numbered_lines(dir: &TempDir, filename: &str, line_count: usize) -> String {
    let path = dir.path().join(filename);
    let content: String = (1..=line_count)
        .map(|n| format!("line {}", n))
        .collect::<Vec<_>>()
        .join("\n");
    std::fs::write(&path, &content).unwrap();
    path.to_str().unwrap().to_string()
}

#[tokio::test]
async fn read_in_range_default_returns_all_lines_for_small_file() {
    let dir = TempDir::new().unwrap();
    let path = write_numbered_lines(&dir, "small.txt", 10);

    let result = read_file_in_range(&path, None, None, None).await.unwrap();
    assert_eq!(result.total_lines, 10);
    assert_eq!(result.lines_read, 10);
    assert_eq!(result.start_line, 1);
    assert!(!result.truncated);
    assert!(result.content.contains("     1│line 1"));
    assert!(result.content.contains("    10│line 10"));
}

#[tokio::test]
async fn read_in_range_positive_offset() {
    let dir = TempDir::new().unwrap();
    let path = write_numbered_lines(&dir, "offset.txt", 50);

    let result = read_file_in_range(&path, None, Some(10), Some(5))
        .await
        .unwrap();
    assert_eq!(result.start_line, 10);
    assert_eq!(result.lines_read, 5);
    assert_eq!(result.total_lines, 50);
    assert!(result.content.contains("    10│line 10"));
    assert!(result.content.contains("    14│line 14"));
    assert!(!result.content.contains("line 15"));
}

#[tokio::test]
async fn read_in_range_negative_offset_reads_from_end() {
    let dir = TempDir::new().unwrap();
    let path = write_numbered_lines(&dir, "tail.txt", 100);

    let result = read_file_in_range(&path, None, Some(-5), Some(5))
        .await
        .unwrap();
    assert_eq!(result.start_line, 96);
    assert_eq!(result.lines_read, 5);
    assert!(result.content.contains("    96│line 96"));
    assert!(result.content.contains("   100│line 100"));
}

#[tokio::test]
async fn read_in_range_truncates_at_default_limit() {
    let dir = TempDir::new().unwrap();
    let path = write_numbered_lines(&dir, "big.txt", 3000);

    let result = read_file_in_range(&path, None, None, None).await.unwrap();
    assert_eq!(result.lines_read, 2000);
    assert_eq!(result.total_lines, 3000);
    assert!(result.truncated);
}

#[tokio::test]
async fn read_in_range_rejects_oversized_file_without_range() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("huge.txt");
    let content = "x".repeat(300 * 1024); // 300 KB
    std::fs::write(&path, &content).unwrap();

    let result = read_file_in_range(path.to_str().unwrap(), None, None, None).await;
    assert!(result.is_err());
    let err = result.unwrap_err();
    // The rejection must be a signpost, not a dead end: file shape (size +
    // line count) plus concrete next steps (offset/limit, grep tools).
    assert!(err.contains("too large to read at once"), "err was: {err}");
    assert!(err.contains("lines total"), "err was: {err}");
    assert!(err.contains("offset"), "err was: {err}");
    assert!(err.contains("limit"), "err was: {err}");
    assert!(err.contains("code_search"), "err was: {err}");
    assert!(err.contains("run_shell"), "err was: {err}");
}

#[tokio::test]
async fn read_in_range_allows_oversized_file_with_offset() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("huge_ok.txt");
    let lines: Vec<String> = (1..=5000).map(|n| format!("row {}", n)).collect();
    std::fs::write(&path, lines.join("\n")).unwrap();

    let result = read_file_in_range(path.to_str().unwrap(), None, Some(1), Some(10))
        .await
        .unwrap();
    assert_eq!(result.lines_read, 10);
    assert!(result.content.contains("     1│row 1"));
}

#[tokio::test]
async fn read_in_range_offset_beyond_end_returns_empty() {
    let dir = TempDir::new().unwrap();
    let path = write_numbered_lines(&dir, "short.txt", 5);

    let result = read_file_in_range(&path, None, Some(100), Some(10))
        .await
        .unwrap();
    assert_eq!(result.lines_read, 0);
    assert!(result.content.is_empty());
}

#[tokio::test]
async fn read_in_range_line_numbers_right_aligned() {
    let dir = TempDir::new().unwrap();
    let path = write_numbered_lines(&dir, "align.txt", 5);

    let result = read_file_in_range(&path, None, None, None).await.unwrap();
    assert!(result.content.starts_with("     1│"));
}

// ============================================
// resolve_path_with_extras — scratchpad whitelist
// ============================================

#[test]
fn resolve_with_extras_allows_scratchpad_outside_sandbox() {
    let sandbox = TempDir::new().unwrap();
    let scratchpad = TempDir::new().unwrap();
    let scratch_file = scratchpad.path().join("notes.md");
    std::fs::write(&scratch_file, "scratch data").unwrap();

    let result = resolve_path_with_extras(
        scratch_file.to_str().unwrap(),
        Some(sandbox.path()),
        &[scratchpad.path().to_path_buf()],
    );
    assert!(
        result.is_ok(),
        "scratchpad file should be allowed: {:?}",
        result.err()
    );
}

#[test]
fn resolve_with_extras_blocks_path_outside_both_sandbox_and_scratchpad() {
    let sandbox = TempDir::new().unwrap();
    let scratchpad = TempDir::new().unwrap();

    let result = resolve_path_with_extras(
        "/etc/passwd",
        Some(sandbox.path()),
        &[scratchpad.path().to_path_buf()],
    );
    assert!(result.is_err());
    assert!(result
        .unwrap_err()
        .contains("outside the allowed directory"));
}

#[test]
fn resolve_with_extras_blocks_traversal_from_scratchpad() {
    let sandbox = TempDir::new().unwrap();
    let scratchpad = TempDir::new().unwrap();

    let evil_path = format!("{}/../../../etc/passwd", scratchpad.path().display());
    let result = resolve_path_with_extras(
        &evil_path,
        Some(sandbox.path()),
        &[scratchpad.path().to_path_buf()],
    );
    assert!(
        result.is_err(),
        "traversal from scratchpad should be blocked"
    );
}

#[test]
fn resolve_path_relative_resolves_against_allowed_dir() {
    let dir = TempDir::new().unwrap();
    let sub = dir.path().join("src").join("utils");
    std::fs::create_dir_all(&sub).unwrap();
    std::fs::write(sub.join("helper.ts"), "export {}").unwrap();

    let result = resolve_path("src/utils/helper.ts", Some(dir.path()));
    assert!(
        result.is_ok(),
        "relative path should resolve against allowed_dir: {:?}",
        result.err()
    );
    let resolved = result.unwrap();
    assert_eq!(resolved, dir.path().join("src/utils/helper.ts"));
}

#[test]
fn resolve_with_extras_empty_extras_falls_back_to_sandbox() {
    let sandbox = TempDir::new().unwrap();
    let file_path = sandbox.path().join("ok.txt");
    std::fs::write(&file_path, "data").unwrap();

    let result = resolve_path_with_extras(file_path.to_str().unwrap(), Some(sandbox.path()), &[]);
    assert!(result.is_ok());
}

// ============================================
// normalize_lexical
// ============================================

#[test]
fn normalize_lexical_resolves_dotdot() {
    let path = std::path::Path::new("/a/b/../c");
    let normalized = normalize_lexical(path);
    assert_eq!(normalized, std::path::PathBuf::from("/a/c"));
}

#[test]
fn normalize_lexical_resolves_dot() {
    let path = std::path::Path::new("/a/./b/./c");
    let normalized = normalize_lexical(path);
    assert_eq!(normalized, std::path::PathBuf::from("/a/b/c"));
}

#[test]
fn normalize_lexical_no_op_for_clean_path() {
    let path = std::path::Path::new("/usr/local/bin");
    let normalized = normalize_lexical(path);
    assert_eq!(normalized, std::path::PathBuf::from("/usr/local/bin"));
}

// ============================================
// read_file_in_range — fallback resolution
// ============================================

#[tokio::test]
async fn read_in_range_strips_leading_slash() {
    let dir = TempDir::new().unwrap();
    let sub = dir.path().join("src");
    std::fs::create_dir_all(&sub).unwrap();
    std::fs::write(sub.join("main.rs"), "fn main() {}").unwrap();

    let result = read_file_in_range("/src/main.rs", Some(dir.path()), None, None)
        .await
        .unwrap();
    assert!(result.content.contains("fn main() {}"));
}

#[tokio::test]
async fn read_in_range_strips_repo_basename_prefix() {
    let dir = TempDir::new().unwrap();
    let sub = dir.path().join("src");
    std::fs::create_dir_all(&sub).unwrap();
    std::fs::write(sub.join("main.rs"), "fn main() {}").unwrap();

    let repo_name = dir
        .path()
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap()
        .to_string();
    let raw = format!("{}/src/main.rs", repo_name);

    let result = read_file_in_range(&raw, Some(dir.path()), None, None)
        .await
        .unwrap();
    assert!(result.content.contains("fn main() {}"));
}

#[tokio::test]
async fn read_in_range_falls_back_to_unique_basename() {
    let dir = TempDir::new().unwrap();
    let deep = dir
        .path()
        .join("engines")
        .join("Simulator")
        .join("components")
        .join("Dock");
    std::fs::create_dir_all(&deep).unwrap();
    std::fs::write(deep.join("Dock.tsx"), "export const Dock = () => null;").unwrap();

    let result = read_file_in_range("some/wrong/prefix/Dock.tsx", Some(dir.path()), None, None)
        .await
        .unwrap();
    assert!(result.content.contains("export const Dock"));
}

#[tokio::test]
async fn read_in_range_rejects_ambiguous_basename() {
    let dir = TempDir::new().unwrap();
    let dir_a = dir.path().join("module_a");
    let dir_b = dir.path().join("module_b");
    std::fs::create_dir_all(&dir_a).unwrap();
    std::fs::create_dir_all(&dir_b).unwrap();
    std::fs::write(dir_a.join("index.ts"), "// a").unwrap();
    std::fs::write(dir_b.join("index.ts"), "// b").unwrap();

    let result = read_file_in_range("nowhere/index.ts", Some(dir.path()), None, None).await;
    let err = result.unwrap_err();
    assert!(err.contains("File not found"));
    assert!(err.contains("2 entries"), "err was: {}", err);
    assert!(err.contains("module_a/index.ts"), "err was: {}", err);
    assert!(err.contains("module_b/index.ts"), "err was: {}", err);
}

#[tokio::test]
async fn read_in_range_strips_line_number_suffix() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("log.txt"), "hello world").unwrap();

    let result = read_file_in_range("log.txt:42", Some(dir.path()), None, None)
        .await
        .unwrap();
    assert!(result.content.contains("hello world"));
}

#[tokio::test]
async fn list_dir_falls_back_to_unique_directory_basename() {
    let dir = TempDir::new().unwrap();
    let nested = dir.path().join("deep").join("components");
    std::fs::create_dir_all(&nested).unwrap();
    std::fs::write(nested.join("Button.tsx"), "//").unwrap();

    let entries = list_dir("wrong/prefix/components", Some(dir.path()))
        .await
        .unwrap();
    assert!(entries.iter().any(|(name, _)| name == "Button.tsx"));
}

#[tokio::test]
async fn read_in_range_not_found_includes_workspace_root() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("foo.txt"), "x").unwrap();

    let err = read_file_in_range("nonexistent.rs", Some(dir.path()), None, None)
        .await
        .unwrap_err();
    assert!(err.contains("File not found"));
    assert!(err.contains("workspace root"));
    assert!(err.contains(dir.path().to_str().unwrap()));
}

#[tokio::test]
async fn read_in_range_suggests_typo_basename() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("README.md"), "x").unwrap();
    std::fs::write(dir.path().join("LICENSE"), "x").unwrap();

    let err = read_file_in_range("READEM.md", Some(dir.path()), None, None)
        .await
        .unwrap_err();
    assert!(err.contains("File not found"), "err was: {}", err);
    assert!(err.contains("Did you mean"), "err was: {}", err);
    assert!(err.contains("README.md"), "err was: {}", err);
}

#[tokio::test]
async fn read_in_range_typo_fallback_not_auto_resolved() {
    // Typo hits should stay in the error message, never silently swap to a
    // different file. Auto-resolution is reserved for exact basename matches.
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("notes.md"), "original").unwrap();

    let result = read_file_in_range("notez.md", Some(dir.path()), None, None).await;
    assert!(result.is_err(), "typo should not auto-resolve to notes.md");
    let err = result.unwrap_err();
    assert!(err.contains("Did you mean"), "err was: {}", err);
    assert!(err.contains("notes.md"), "err was: {}", err);
}

#[tokio::test]
async fn read_in_range_short_basename_uses_tight_threshold() {
    // Short filenames should only tolerate 1 edit to avoid `a.rs` matching
    // `b.rs` (distance 1) but not `c.rs` vs `abc.rs` (distance 2).
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("a.rs"), "fn a() {}").unwrap();
    std::fs::write(dir.path().join("z.rs"), "fn z() {}").unwrap();

    let err = read_file_in_range("x.rs", Some(dir.path()), None, None)
        .await
        .unwrap_err();
    assert!(err.contains("Did you mean"), "err was: {}", err);
    // Both single-char siblings are distance 1 from `x.rs`, so either may
    // appear; we just verify we didn't silently resolve and that the hint
    // surfaces at least one candidate.
    assert!(
        err.contains("a.rs") || err.contains("z.rs"),
        "err was: {}",
        err
    );
}

// ============================================
// Multi-format read: PDF, Image, Notebook
// ============================================

use crate::tool_infra::file::{detect_image_mime, is_notebook, is_pdf, parse_notebook};

#[test]
fn detect_image_mime_supported_formats() {
    assert_eq!(
        detect_image_mime(Path::new("photo.jpg")),
        Some("image/jpeg")
    );
    assert_eq!(
        detect_image_mime(Path::new("photo.JPEG")),
        Some("image/jpeg")
    );
    assert_eq!(detect_image_mime(Path::new("icon.png")), Some("image/png"));
    assert_eq!(detect_image_mime(Path::new("anim.gif")), Some("image/gif"));
    assert_eq!(
        detect_image_mime(Path::new("modern.webp")),
        Some("image/webp")
    );
    assert_eq!(detect_image_mime(Path::new("doc.pdf")), None);
    assert_eq!(detect_image_mime(Path::new("code.rs")), None);
}

#[test]
fn is_pdf_by_extension() {
    assert!(is_pdf(Path::new("doc.pdf"), &[]));
    assert!(is_pdf(Path::new("DOC.PDF"), &[]));
    assert!(!is_pdf(Path::new("doc.txt"), &[]));
}

#[test]
fn is_pdf_by_magic_bytes() {
    assert!(is_pdf(Path::new("unknown"), b"%PDF-1.4 rest of file"));
    assert!(!is_pdf(Path::new("unknown"), b"not a pdf"));
}

#[test]
fn is_notebook_detection() {
    assert!(is_notebook(Path::new("analysis.ipynb")));
    assert!(is_notebook(Path::new("ANALYSIS.IPYNB")));
    assert!(!is_notebook(Path::new("analysis.py")));
}

#[test]
fn parse_notebook_basic() {
    let nb = serde_json::json!({
        "cells": [
            {
                "cell_type": "code",
                "source": ["import numpy as np\n", "x = 1\n"],
                "outputs": []
            },
            {
                "cell_type": "markdown",
                "source": ["# Title\n", "Some text\n"],
                "outputs": []
            }
        ],
        "metadata": {}
    });
    let bytes = serde_json::to_vec(&nb).unwrap();
    let result = parse_notebook(&bytes).unwrap();
    assert!(result.contains("Cell 1 [code]"), "result: {}", result);
    assert!(result.contains("import numpy"), "result: {}", result);
    assert!(result.contains("Cell 2 [markdown]"), "result: {}", result);
    assert!(result.contains("# Title"), "result: {}", result);
}

#[test]
fn parse_notebook_with_output() {
    let nb = serde_json::json!({
        "cells": [
            {
                "cell_type": "code",
                "source": ["print('hello')\n"],
                "outputs": [
                    { "output_type": "stream", "text": ["hello\n"] }
                ]
            }
        ],
        "metadata": {}
    });
    let bytes = serde_json::to_vec(&nb).unwrap();
    let result = parse_notebook(&bytes).unwrap();
    assert!(result.contains("Output:"), "result: {}", result);
    assert!(result.contains("hello"), "result: {}", result);
}

#[test]
fn parse_notebook_empty_cells_errors() {
    let nb = serde_json::json!({ "cells": [], "metadata": {} });
    let bytes = serde_json::to_vec(&nb).unwrap();
    assert!(parse_notebook(&bytes).is_err());
}

#[test]
fn parse_notebook_invalid_json_errors() {
    assert!(parse_notebook(b"not json at all").is_err());
}

#[tokio::test]
async fn read_file_pdf_text_extraction() {
    let dir = TempDir::new().unwrap();
    let pdf_path = dir.path().join("test.pdf");
    // Create a minimal valid PDF with text
    let pdf_content = b"%PDF-1.0\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj\n4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n5 0 obj<</Length 44>>stream\nBT /F1 12 Tf 100 700 Td (Hello PDF) Tj ET\nendstream\nendobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000266 00000 n \n0000000340 00000 n \ntrailer<</Size 6/Root 1 0 R>>\nstartxref\n434\n%%EOF";
    std::fs::write(&pdf_path, pdf_content).unwrap();

    let result =
        crate::tool_infra::file::read_file_in_range(pdf_path.to_str().unwrap(), None, None, None)
            .await;
    // PDF extraction may succeed or fail depending on the minimal PDF validity,
    // but it should not panic and should attempt PDF path
    assert!(result.is_ok() || result.unwrap_err().contains("PDF"));
}

#[tokio::test]
async fn read_file_image_returns_marker() {
    let dir = TempDir::new().unwrap();
    let img_path = dir.path().join("test.png");
    // Minimal 1x1 PNG
    let png_bytes: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG header
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77,
        0x53, 0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF,
        0xC0, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0xE2, 0x21, 0xBC, 0x33, 0x00, 0x00, 0x00, 0x00,
        0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ];
    std::fs::write(&img_path, png_bytes).unwrap();

    let result =
        crate::tool_infra::file::read_file_in_range(img_path.to_str().unwrap(), None, None, None)
            .await
            .unwrap();

    assert!(
        result.content.contains("[image:image/png:"),
        "content: {}",
        result.content
    );
    assert!(
        result.content.contains("Image:"),
        "content: {}",
        result.content
    );
}

#[tokio::test]
async fn read_file_notebook_renders_cells() {
    let dir = TempDir::new().unwrap();
    let nb_path = dir.path().join("test.ipynb");
    let nb = serde_json::json!({
        "cells": [
            {
                "cell_type": "code",
                "source": ["x = 42\n"],
                "outputs": [
                    { "data": { "text/plain": ["42"] }, "output_type": "execute_result" }
                ]
            }
        ],
        "metadata": {},
        "nbformat": 4
    });
    std::fs::write(&nb_path, serde_json::to_string(&nb).unwrap()).unwrap();

    let result =
        crate::tool_infra::file::read_file_in_range(nb_path.to_str().unwrap(), None, None, None)
            .await
            .unwrap();

    assert!(
        result.content.contains("Cell 1"),
        "content: {}",
        result.content
    );
    assert!(
        result.content.contains("x = 42"),
        "content: {}",
        result.content
    );
}
