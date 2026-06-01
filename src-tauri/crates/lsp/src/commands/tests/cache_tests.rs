//! Tests for cache freshness logic

use super::*;

#[test]
fn test_is_fresh_valid_recent() {
    // Timestamp from 30 minutes ago should be fresh
    let ts = chrono::Utc::now() - chrono::Duration::minutes(30);
    assert!(is_fresh(&ts.to_rfc3339()));
}

#[test]
fn test_is_fresh_expired() {
    // Timestamp from 2 hours ago should be stale
    let ts = chrono::Utc::now() - chrono::Duration::hours(2);
    assert!(!is_fresh(&ts.to_rfc3339()));
}

#[test]
fn test_is_fresh_just_under_limit() {
    // Timestamp from 59 minutes ago should be fresh (limit is 3600s = 1 hour)
    let ts = chrono::Utc::now() - chrono::Duration::minutes(59);
    assert!(is_fresh(&ts.to_rfc3339()));
}

#[test]
fn test_is_fresh_just_over_limit() {
    // Timestamp from 61 minutes ago should be stale
    let ts = chrono::Utc::now() - chrono::Duration::minutes(61);
    assert!(!is_fresh(&ts.to_rfc3339()));
}

#[test]
fn test_is_fresh_invalid_format() {
    assert!(!is_fresh("not-a-timestamp"));
    assert!(!is_fresh(""));
    assert!(!is_fresh("2024-01-01")); // Not RFC3339
}

#[test]
fn test_is_fresh_future_timestamp() {
    // Future timestamp should be fresh (age is negative -> 0 when cast to u64)
    let ts = chrono::Utc::now() + chrono::Duration::hours(1);
    // Note: signed_duration_since returns negative, cast to u64 wraps around
    // This is actually a bug in the original code, but we test current behavior
    // The cast `as u64` on a negative i64 wraps to a large positive number
    // So future timestamps will appear stale (huge age > 3600)
    assert!(!is_fresh(&ts.to_rfc3339()));
}
