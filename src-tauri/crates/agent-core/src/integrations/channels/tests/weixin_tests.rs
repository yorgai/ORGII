//! Tests for the WeChat (`weixin`) channel.

use super::*;

#[test]
fn extract_text_text_only() {
    let items = vec![serde_json::json!({
        "type": ITEM_TEXT,
        "text_item": { "text": "hello" }
    })];
    assert_eq!(extract_text(&items), "hello");
}

#[test]
fn extract_text_mixed() {
    let items = vec![
        serde_json::json!({ "type": ITEM_IMAGE }),
        serde_json::json!({
            "type": ITEM_TEXT,
            "text_item": { "text": "caption" }
        }),
    ];
    assert_eq!(extract_text(&items), "[图片]\ncaption");
}

#[test]
fn dedup_repeats() {
    let mut st = WeixinState::new();
    assert!(!st.dedup("m1"));
    assert!(st.dedup("m1"));
    assert!(!st.dedup("m2"));
}

#[test]
fn allowlist_policy() {
    assert!(is_allowed("open", &[], "anyone"));
    assert!(!is_allowed("disabled", &["x".into()], "x"));
    assert!(is_allowed(
        "allowlist",
        &["abc".into(), "def".into()],
        "abc"
    ));
    assert!(!is_allowed("allowlist", &["abc".into()], "xyz"));
}
