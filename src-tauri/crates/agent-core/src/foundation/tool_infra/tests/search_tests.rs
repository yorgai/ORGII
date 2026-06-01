use super::truncate_output;

#[test]
fn truncate_output_returns_short_text() {
    let short = "hello world";
    assert_eq!(truncate_output(short.to_string(), 100), short);
}

#[test]
fn truncate_output_truncates_long_text() {
    let long = "x".repeat(500);
    let result = truncate_output(long.clone(), 100);
    assert!(result.len() <= 200);
    assert!(result.contains("[...truncated"));
    assert!(result.contains("500 total chars"));
}

#[test]
fn truncate_output_at_exact_limit() {
    let exact = "a".repeat(100);
    assert_eq!(truncate_output(exact.clone(), 100), exact);
}

#[test]
fn truncate_output_one_over_limit() {
    let over = "b".repeat(101);
    let result = truncate_output(over, 100);
    assert!(result.contains("[...truncated"));
}
