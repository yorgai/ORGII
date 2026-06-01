//! Integration test: perf module diff/hash/json pipelines
//!
//! Validates cross-function consistency within the perf module:
//! compute_diff → apply_patch roundtrip, hash consistency across
//! algorithms, and JSON parse → stringify roundtrip.

use perf_utils::diff_patch::{apply_fuzzy_patch, apply_patch, compute_diff};
use perf_utils::hash::{compute_blake3, compute_blake3_batch, compute_sha256};
use perf_utils::json_fast::{parse_json_fast, stringify_json_fast, validate_json_fast};
use serde_json::json;

// -- diff → patch roundtrip --

#[test]
fn diff_then_apply_recovers_new_text() {
    let old = "line 1\nline 2\nline 3\n".to_string();
    let new = "line 1\nline 2 modified\nline 3\nline 4\n".to_string();

    let diff_result = compute_diff(
        old.clone(),
        new.clone(),
        Some("a.txt".into()),
        Some("b.txt".into()),
        None,
    )
    .unwrap();

    assert!(!diff_result.diff.is_empty());
    assert!(diff_result.stats.lines_added > 0);

    let patch_result = apply_patch(old, diff_result.diff).unwrap();
    assert!(patch_result.success);
    assert_eq!(patch_result.content.trim_end(), new.trim_end());
}

#[test]
fn diff_identical_files_produces_empty_patch() {
    let text = "same content\n".to_string();
    let diff_result = compute_diff(text.clone(), text, None, None, None).unwrap();
    assert_eq!(diff_result.stats.lines_added, 0);
    assert_eq!(diff_result.stats.lines_removed, 0);
}

#[test]
fn fuzzy_patch_handles_line_offset() {
    let original = "header\nline A\nline B\nline C\nfooter\n".to_string();
    let modified = "header\nline A\nline B changed\nline C\nfooter\n".to_string();

    let diff_result = compute_diff(original, modified.clone(), None, None, None).unwrap();

    let shifted = "extra line\nheader\nline A\nline B\nline C\nfooter\n".to_string();

    let fuzzy_result = apply_fuzzy_patch(shifted, diff_result.diff, None).unwrap();
    assert!(
        fuzzy_result.success,
        "fuzzy patch should succeed despite line offset"
    );
    assert!(
        fuzzy_result.content.contains("line B changed"),
        "patched output should contain the modification"
    );
}

// -- hash consistency --

#[test]
fn sha256_deterministic() {
    let data = "hello world".to_string();
    let h1 = compute_sha256(data.clone());
    let h2 = compute_sha256(data);
    assert_eq!(h1.hash, h2.hash);
    assert!(!h1.hash.is_empty());
}

#[test]
fn blake3_deterministic() {
    let data = "hello world".to_string();
    let h1 = compute_blake3(data.clone());
    let h2 = compute_blake3(data);
    assert_eq!(h1.hash, h2.hash);
    assert!(!h1.hash.is_empty());
}

#[test]
fn sha256_and_blake3_produce_different_hashes() {
    let data = "test data".to_string();
    let sha = compute_sha256(data.clone());
    let blake = compute_blake3(data);
    assert_ne!(
        sha.hash, blake.hash,
        "different algorithms should produce different hashes"
    );
}

#[test]
fn blake3_batch_matches_individual() {
    let inputs = vec!["alpha".to_string(), "beta".to_string(), "gamma".to_string()];

    let batch = compute_blake3_batch(inputs.clone());
    let individual: Vec<String> = inputs.into_iter().map(|s| compute_blake3(s).hash).collect();

    assert_eq!(batch, individual);
}

// -- JSON roundtrip --

#[test]
fn json_parse_stringify_roundtrip() {
    let original = json!({
        "name": "test",
        "count": 42,
        "nested": {"key": "value"},
        "list": [1, 2, 3]
    });

    let json_str = serde_json::to_string(&original).unwrap();

    let parsed = parse_json_fast(json_str).unwrap();

    let stringified = stringify_json_fast(parsed.value, Some(false)).unwrap();

    let reparsed: serde_json::Value = serde_json::from_str(&stringified.json).unwrap();
    assert_eq!(reparsed, original);
}

#[test]
fn validate_json_fast_valid_and_invalid() {
    let valid = validate_json_fast(r#"{"key": "value"}"#.to_string());
    assert!(valid.valid);
    assert!(valid.error.is_none());

    let invalid = validate_json_fast("{broken json".to_string());
    assert!(!invalid.valid);
    assert!(invalid.error.is_some());
}
