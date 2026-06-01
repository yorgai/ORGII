// -- parse_timestamp (private, accessed via super) --

#[test]
fn parse_timestamp_rfc3339_utc() {
    let ts = super::parse_timestamp("2025-01-15T10:30:00Z");
    assert!(ts.is_some());
    let secs = ts.unwrap();
    assert!(secs > 1_700_000_000 && secs < 2_000_000_000);
}

#[test]
fn parse_timestamp_rfc3339_with_offset() {
    let ts = super::parse_timestamp("2025-01-15T10:30:00+08:00");
    assert!(ts.is_some());
}

#[test]
fn parse_timestamp_naive_datetime() {
    let ts = super::parse_timestamp("2025-01-15T10:30:00");
    assert!(ts.is_some());
}

#[test]
fn parse_timestamp_fractional_seconds() {
    let ts = super::parse_timestamp("2025-01-15T10:30:00.123");
    assert!(ts.is_some());
}

#[test]
fn parse_timestamp_invalid_returns_none() {
    assert_eq!(super::parse_timestamp("not-a-date"), None);
}

#[test]
fn parse_timestamp_empty_returns_none() {
    assert_eq!(super::parse_timestamp(""), None);
}

// -- epoch_to_iso (private) --

#[test]
fn epoch_to_iso_zero() {
    assert_eq!(super::epoch_to_iso(0), "1970-01-01T00:00:00");
}

#[test]
fn epoch_to_iso_known_epoch() {
    let out = super::epoch_to_iso(1736934600);
    assert!(out.contains("2025"));
}

// -- percent_decode (private) --

#[test]
fn percent_decode_space() {
    assert_eq!(super::percent_decode("hello%20world"), "hello world");
}

#[test]
fn percent_decode_slash() {
    assert_eq!(super::percent_decode("no%2Fslash"), "no/slash");
}

#[test]
fn percent_decode_already_clean() {
    assert_eq!(super::percent_decode("already clean"), "already clean");
}

#[test]
fn percent_decode_empty() {
    assert_eq!(super::percent_decode(""), "");
}

#[test]
fn percent_decode_incomplete_sequence() {
    assert_eq!(super::percent_decode("%"), "%");
}

#[test]
fn percent_decode_invalid_hex() {
    assert_eq!(super::percent_decode("%ZZ"), "%ZZ");
}
