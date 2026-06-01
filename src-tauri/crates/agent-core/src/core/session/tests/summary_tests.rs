use super::*;

#[test]
fn triggers_when_tool_calls_exceed_threshold() {
    assert!(should_summarize(5, 10));
    assert!(should_summarize(10, 0));
}

#[test]
fn triggers_when_wall_time_exceeds_threshold() {
    assert!(should_summarize(0, 60));
    assert!(should_summarize(1, 120));
}

#[test]
fn skips_when_below_both_thresholds() {
    assert!(!should_summarize(0, 0));
    assert!(!should_summarize(4, 59));
    assert!(!should_summarize(1, 30));
}

#[test]
fn triggers_on_exact_boundary() {
    assert!(should_summarize(5, 0));
    assert!(should_summarize(0, 60));
}
