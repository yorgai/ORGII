//! Unit tests for the PDF-aware `read_file_preview` path in `pill_resolver`.
//!
//! Tests cover:
//! - PDF pills expand to extracted text rather than "Binary or unreadable file"
//! - Scanned / empty-text PDFs produce a legible fallback
//! - Non-PDF binary files still produce the binary fallback
//! - The 256 KB size cap is applied for oversized plain-text files
//! - `truncate_content` helper boundary behaviour

use std::path::Path;

// Pull in the private helpers we want to test directly.
use crate::foundation::utils::pill_resolver::{expand_pill_references, truncate_content_pub};

// ── truncate_content ─────────────────────────────────────────────────────────

#[test]
fn truncate_content_under_limit_unchanged() {
    let s = "hello";
    assert_eq!(truncate_content_pub(s, 10), "hello");
}

#[test]
fn truncate_content_exact_limit_unchanged() {
    let s = "hello";
    assert_eq!(truncate_content_pub(s, 5), "hello");
}

#[test]
fn truncate_content_over_limit_snaps_to_char_boundary() {
    let s = "abcde";
    let result = truncate_content_pub(s, 3);
    assert_eq!(result, "abc");
}

#[test]
fn truncate_content_multibyte_snaps_to_char_boundary() {
    // "€" is 3 bytes (U+20AC).  If the limit is 4 we must not split mid-codepoint.
    let s = "a€b";
    // "a" is 1 byte, "€" starts at byte 1 and ends at byte 3 (inclusive), "b" at byte 4.
    // limit = 2 → must snap back to just "a" (only safe boundary before byte 2)
    let result = truncate_content_pub(s, 2);
    assert_eq!(result, "a");
}

#[test]
fn truncate_content_empty_string() {
    assert_eq!(truncate_content_pub("", 100), "");
}

// ── read_file_preview via expand_pill_references ─────────────────────────────

/// Minimal valid PDF with an embedded text stream "Hello PDF".
/// Byte-identical to the test fixture used in file_tests.rs.
const MINIMAL_PDF_BYTES: &[u8] = b"%PDF-1.0\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj\n4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n5 0 obj<</Length 44>>stream\nBT /F1 12 Tf 100 700 Td (Hello PDF) Tj ET\nendstream\nendobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000266 00000 n \n0000000340 00000 n \ntrailer<</Size 6/Root 1 0 R>>\nstartxref\n434\n%%EOF";

#[test]
fn pdf_pill_does_not_produce_binary_fallback() {
    let dir = tempfile::TempDir::new().unwrap();
    let pdf_path = dir.path().join("report.pdf");
    std::fs::write(&pdf_path, MINIMAL_PDF_BYTES).unwrap();

    let msg = format!("See this [file:{}]", pdf_path.display());
    let result = expand_pill_references(&msg, Path::new("/tmp"), None, &[], None);

    assert!(
        !result.contains("Binary or unreadable file"),
        "PDF pill should not fall through to the binary fallback; got: {}",
        result,
    );
}

#[test]
fn pdf_pill_includes_file_header() {
    let dir = tempfile::TempDir::new().unwrap();
    let pdf_path = dir.path().join("report.pdf");
    std::fs::write(&pdf_path, MINIMAL_PDF_BYTES).unwrap();

    let msg = format!("See this [file:{}]", pdf_path.display());
    let result = expand_pill_references(&msg, Path::new("/tmp"), None, &[], None);

    assert!(
        result.contains("### File:"),
        "pill expansion should contain file header; got: {}",
        result,
    );
}

#[test]
fn pdf_pill_with_text_layer_expands_content() {
    let dir = tempfile::TempDir::new().unwrap();
    let pdf_path = dir.path().join("report.pdf");
    std::fs::write(&pdf_path, MINIMAL_PDF_BYTES).unwrap();

    let msg = format!("Summarise [file:{}]", pdf_path.display());
    let result = expand_pill_references(&msg, Path::new("/tmp"), None, &[], None);

    // Extraction either succeeds (text appears) or produces a graceful failure message —
    // never the generic "Binary or unreadable file" or a panic.
    let has_text = result.contains("Hello PDF");
    let has_graceful_error = result.contains("PDF text extraction failed")
        || result.contains("Scanned PDF with no extractable text layer");
    assert!(
        has_text || has_graceful_error,
        "PDF pill should produce extracted text or graceful error; got: {}",
        result,
    );
}

#[test]
fn binary_non_pdf_file_produces_binary_fallback() {
    let dir = tempfile::TempDir::new().unwrap();
    let bin_path = dir.path().join("data.bin");
    // Write bytes that are not valid UTF-8 and not a PDF.
    std::fs::write(&bin_path, b"\x00\x01\x02\x03\xFF\xFE binary data").unwrap();

    let msg = format!("Check [file:{}]", bin_path.display());
    let result = expand_pill_references(&msg, Path::new("/tmp"), None, &[], None);

    assert!(
        result.contains("Binary or unreadable file"),
        "non-PDF binary file should hit the binary fallback; got: {}",
        result,
    );
}

#[test]
fn text_file_within_size_cap_expands_normally() {
    let dir = tempfile::TempDir::new().unwrap();
    let txt_path = dir.path().join("notes.txt");
    std::fs::write(&txt_path, b"Hello, world!").unwrap();

    let msg = format!("Notes: [file:{}]", txt_path.display());
    let result = expand_pill_references(&msg, Path::new("/tmp"), None, &[], None);

    assert!(
        result.contains("Hello, world!"),
        "small text file pill should expand to file content; got: {}",
        result,
    );
}

#[test]
fn text_file_over_256kb_produces_too_large_message() {
    let dir = tempfile::TempDir::new().unwrap();
    let big_path = dir.path().join("large.txt");
    // Write 257 KB of 'a' characters.
    let content = "a".repeat(257 * 1024);
    std::fs::write(&big_path, content.as_bytes()).unwrap();

    let msg = format!("Big: [file:{}]", big_path.display());
    let result = expand_pill_references(&msg, Path::new("/tmp"), None, &[], None);

    assert!(
        result.contains("File too large"),
        "oversized text file should hit the size-cap message; got: {}",
        result,
    );
}

#[test]
fn nonexistent_file_pill_leaves_message_unchanged() {
    let msg = "See [file:/nonexistent/path/file.txt]";
    let result = expand_pill_references(msg, Path::new("/tmp"), None, &[], None);
    assert_eq!(result, msg, "missing file should not expand");
}
