use super::*;

/// Helper: create a tool result with a specific timestamp (epoch ms).
fn tool_result_at(name: &str, content: &str, ts_ms: u64) -> Value {
    serde_json::json!({
        "role": "tool",
        "tool_call_id": format!("tc_{}", name),
        "name": name,
        "content": content,
        TIMESTAMP_META_KEY: ts_ms,
    })
}

/// Helper: create an assistant message with a specific timestamp (epoch ms).
fn assistant_at(ts_ms: u64) -> Value {
    serde_json::json!({
        "role": "assistant",
        "content": "I'll help with that.",
        TIMESTAMP_META_KEY: ts_ms,
    })
}

fn big_content(chars: usize) -> String {
    "x".repeat(chars)
}

/// Convenience: "2 hours ago" in epoch ms relative to a base.
fn two_hours_ago() -> u64 {
    now_epoch_ms().saturating_sub(7200 * 1000)
}

/// Convenience: "5 seconds ago" in epoch ms.
fn five_secs_ago() -> u64 {
    now_epoch_ms().saturating_sub(5 * 1000)
}

fn short_gap_config() -> MicrocompactConfig {
    MicrocompactConfig {
        gap_threshold_secs: 60,
        keep_recent: 1,
        min_content_chars: 10,
    }
}

// ===== Time-based trigger tests =====

#[test]
fn no_op_when_no_assistant_message() {
    let cfg = short_gap_config();
    let mut msgs = vec![tool_result_at(
        "read_file",
        &big_content(1000),
        two_hours_ago(),
    )];
    let stats = microcompact_messages(&mut msgs, &cfg);
    assert_eq!(stats.trimmed_count, 0);
}

#[test]
fn no_op_when_gap_under_threshold() {
    let cfg = short_gap_config();
    let mut msgs = vec![
        assistant_at(five_secs_ago()),
        tool_result_at("read_file", &big_content(1000), five_secs_ago()),
    ];
    let stats = microcompact_messages(&mut msgs, &cfg);
    assert_eq!(stats.trimmed_count, 0);
}

#[test]
fn triggers_when_gap_exceeds_threshold() {
    let cfg = short_gap_config();
    let old_ts = two_hours_ago();
    let mut msgs = vec![
        assistant_at(old_ts),
        tool_result_at("read_file", &big_content(1000), old_ts),
        tool_result_at("code_search", &big_content(500), old_ts),
    ];
    let stats = microcompact_messages(&mut msgs, &cfg);
    assert_eq!(stats.trimmed_count, 1);
    assert_eq!(msgs[1]["content"].as_str().unwrap(), CLEARED_MESSAGE);
    assert_ne!(msgs[2]["content"].as_str().unwrap(), CLEARED_MESSAGE);
}

#[test]
fn clears_all_but_keep_recent() {
    let cfg = MicrocompactConfig {
        gap_threshold_secs: 60,
        keep_recent: 2,
        min_content_chars: 10,
    };
    let old_ts = two_hours_ago();
    let mut msgs = vec![
        assistant_at(old_ts),
        tool_result_at("read_file", &big_content(100), old_ts),
        tool_result_at("run_shell", &big_content(100), old_ts),
        tool_result_at("code_search", &big_content(100), old_ts),
    ];
    let stats = microcompact_messages(&mut msgs, &cfg);
    assert_eq!(stats.trimmed_count, 1);
    assert_eq!(msgs[1]["content"].as_str().unwrap(), CLEARED_MESSAGE);
    assert_ne!(msgs[2]["content"].as_str().unwrap(), CLEARED_MESSAGE);
    assert_ne!(msgs[3]["content"].as_str().unwrap(), CLEARED_MESSAGE);
}

#[test]
fn skips_small_results() {
    let cfg = MicrocompactConfig {
        gap_threshold_secs: 60,
        keep_recent: 0,
        min_content_chars: 500,
    };
    let old_ts = two_hours_ago();
    let mut msgs = vec![
        assistant_at(old_ts),
        tool_result_at("read_file", "short", old_ts),
    ];
    let stats = microcompact_messages(&mut msgs, &cfg);
    assert_eq!(stats.trimmed_count, 0);
    assert_eq!(msgs[1]["content"].as_str().unwrap(), "short");
}

#[test]
fn skips_non_compactable_tools() {
    let cfg = MicrocompactConfig {
        gap_threshold_secs: 60,
        keep_recent: 0,
        min_content_chars: 10,
    };
    let old_ts = two_hours_ago();
    let mut msgs = vec![
        assistant_at(old_ts),
        serde_json::json!({
            "role": "tool",
            "tool_call_id": "tc_custom",
            "name": "suggest_mode_switch",
            "content": big_content(100),
            TIMESTAMP_META_KEY: old_ts,
        }),
    ];
    let stats = microcompact_messages(&mut msgs, &cfg);
    assert_eq!(stats.trimmed_count, 0);
}

#[test]
fn does_not_double_clear() {
    let cfg = short_gap_config();
    let old_ts = two_hours_ago();
    let mut msgs = vec![
        assistant_at(old_ts),
        serde_json::json!({
            "role": "tool",
            "tool_call_id": "tc1",
            "name": "read_file",
            "content": CLEARED_MESSAGE,
            TIMESTAMP_META_KEY: old_ts,
        }),
        tool_result_at("code_search", &big_content(500), old_ts),
    ];
    let stats = microcompact_messages(&mut msgs, &cfg);
    assert_eq!(stats.trimmed_count, 0);
}

#[test]
fn ignores_non_tool_messages() {
    let cfg = MicrocompactConfig {
        gap_threshold_secs: 60,
        keep_recent: 0,
        min_content_chars: 10,
    };
    let old_ts = two_hours_ago();
    let mut msgs = vec![
        assistant_at(old_ts),
        serde_json::json!({"role": "system", "content": big_content(5000)}),
        serde_json::json!({"role": "user", "content": big_content(5000)}),
    ];
    let stats = microcompact_messages(&mut msgs, &cfg);
    assert_eq!(stats.trimmed_count, 0);
}

#[test]
fn strip_timestamp_metadata_removes_key() {
    let mut msgs = vec![
        assistant_at(12345),
        tool_result_at("read_file", "content", 12345),
        serde_json::json!({"role": "user", "content": "hello"}),
    ];
    assert!(msgs[0].get(TIMESTAMP_META_KEY).is_some());
    assert!(msgs[1].get(TIMESTAMP_META_KEY).is_some());
    strip_timestamp_metadata(&mut msgs);
    assert!(msgs[0].get(TIMESTAMP_META_KEY).is_none());
    assert!(msgs[1].get(TIMESTAMP_META_KEY).is_none());
    assert!(msgs[2].get(TIMESTAMP_META_KEY).is_none());
}

#[test]
fn chars_saved_is_accurate() {
    let cfg = MicrocompactConfig {
        gap_threshold_secs: 60,
        keep_recent: 1,
        min_content_chars: 10,
    };
    let old_ts = two_hours_ago();
    let mut msgs = vec![
        assistant_at(old_ts),
        tool_result_at("read_file", &big_content(300), old_ts),
        tool_result_at("run_shell", &big_content(700), old_ts),
        tool_result_at("code_search", &big_content(500), old_ts),
    ];
    let stats = microcompact_messages(&mut msgs, &cfg);
    assert_eq!(stats.trimmed_count, 2);
    assert_eq!(stats.chars_saved, 1000);
}

// -- Image/multimodal clearing --

fn msg_with_image(role: &str, ts_ms: u64) -> Value {
    serde_json::json!({
        "role": role,
        "content": [
            {"type": "text", "text": "Here is the screenshot"},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,iVBOR..."}}
        ],
        TIMESTAMP_META_KEY: ts_ms,
    })
}

#[test]
fn clears_old_image_blocks() {
    let cfg = short_gap_config();
    let old_ts = two_hours_ago();
    let mut msgs = vec![assistant_at(old_ts), msg_with_image("user", old_ts)];
    let stats = microcompact_messages(&mut msgs, &cfg);
    assert_eq!(stats.images_cleared, 1);

    let content = msgs[1]["content"].as_array().unwrap();
    assert_eq!(content[0]["type"], "text");
    assert_eq!(content[1]["type"], "text");
    assert!(content[1]["text"]
        .as_str()
        .unwrap()
        .contains("Image content cleared"));
}

#[test]
fn preserves_images_when_gap_under_threshold() {
    let cfg = short_gap_config();
    let recent_ts = five_secs_ago();
    let mut msgs = vec![assistant_at(recent_ts), msg_with_image("user", recent_ts)];
    let stats = microcompact_messages(&mut msgs, &cfg);
    assert_eq!(stats.images_cleared, 0);
    let content = msgs[1]["content"].as_array().unwrap();
    assert_eq!(content[1]["type"], "image_url");
}

#[test]
fn clears_image_type_blocks() {
    let cfg = short_gap_config();
    let old_ts = two_hours_ago();
    let mut msgs = vec![
        assistant_at(old_ts),
        serde_json::json!({
            "role": "assistant",
            "content": [
                {"type": "text", "text": "generated image"},
                {"type": "image", "source": {"type": "base64", "data": "abc..."}}
            ],
            TIMESTAMP_META_KEY: old_ts,
        }),
    ];
    let stats = microcompact_messages(&mut msgs, &cfg);
    assert_eq!(stats.images_cleared, 1);
}

// -- keep_recent floor at 1 --

#[test]
fn keep_recent_floors_at_one() {
    let cfg = MicrocompactConfig {
        gap_threshold_secs: 60,
        keep_recent: 0,
        min_content_chars: 10,
    };
    let old_ts = two_hours_ago();
    let mut msgs = vec![
        assistant_at(old_ts),
        tool_result_at("read_file", &big_content(100), old_ts),
    ];
    let stats = microcompact_messages(&mut msgs, &cfg);
    assert_eq!(stats.trimmed_count, 0, "should keep at least 1 result");
}

// -- Aggregate Budget & ReplacementState tests --

fn tool_result_with_id(tool_call_id: &str, name: &str, content: &str) -> Value {
    serde_json::json!({
        "role": "tool",
        "tool_call_id": tool_call_id,
        "name": name,
        "content": content,
    })
}

#[test]
fn aggregate_budget_no_op_under_limit() {
    let mut state = ReplacementState::new();
    let mut msgs = vec![
        serde_json::json!({"role": "assistant", "content": "thinking"}),
        tool_result_with_id("tc1", "read_file", &big_content(1000)),
        tool_result_with_id("tc2", "code_search", &big_content(1000)),
    ];
    let cleared = enforce_aggregate_budget(&mut msgs, &mut state);
    assert_eq!(cleared, 0);
    assert!(!state.is_cleared("tc1"));
    assert!(!state.is_cleared("tc2"));
}

#[test]
fn aggregate_budget_clears_oldest_when_over() {
    let mut state = ReplacementState::new();
    let big = big_content(150_000);
    let mut msgs = vec![
        serde_json::json!({"role": "assistant", "content": "thinking"}),
        tool_result_with_id("tc1", "read_file", &big),
        tool_result_with_id("tc2", "read_file", &big),
    ];
    let cleared = enforce_aggregate_budget(&mut msgs, &mut state);
    assert!(cleared > 0);
    assert_eq!(msgs[1]["content"].as_str().unwrap(), CLEARED_MESSAGE);
    assert!(state.is_cleared("tc1"));
}

#[test]
fn replacement_state_sticky_across_calls() {
    let mut state = ReplacementState::new();
    let big = big_content(150_000);

    let mut msgs = vec![
        serde_json::json!({"role": "assistant", "content": "thinking"}),
        tool_result_with_id("tc1", "read_file", &big),
        tool_result_with_id("tc2", "read_file", &big),
    ];
    enforce_aggregate_budget(&mut msgs, &mut state);
    assert!(state.is_cleared("tc1"));

    msgs[1]["content"] = Value::String(big.clone());
    let cleared = enforce_aggregate_budget(&mut msgs, &mut state);
    assert!(cleared > 0);
    assert_eq!(msgs[1]["content"].as_str().unwrap(), CLEARED_MESSAGE);
}

#[test]
fn aggregate_budget_skips_non_compactable() {
    let mut state = ReplacementState::new();
    let big = big_content(250_000);
    let mut msgs = vec![
        serde_json::json!({"role": "assistant", "content": "thinking"}),
        tool_result_with_id("tc1", "suggest_mode_switch", &big),
    ];
    let cleared = enforce_aggregate_budget(&mut msgs, &mut state);
    assert_eq!(cleared, 0);
}

#[test]
fn aggregate_budget_separate_groups() {
    let mut state = ReplacementState::new();
    let medium = big_content(80_000);
    let mut msgs = vec![
        serde_json::json!({"role": "assistant", "content": "first"}),
        tool_result_with_id("tc1", "read_file", &medium),
        tool_result_with_id("tc2", "read_file", &medium),
        serde_json::json!({"role": "assistant", "content": "second"}),
        tool_result_with_id("tc3", "read_file", &medium),
        tool_result_with_id("tc4", "read_file", &medium),
    ];
    let cleared = enforce_aggregate_budget(&mut msgs, &mut state);
    assert_eq!(cleared, 0);
}

// -- Default microcompact config --
//
// Pins the default thresholds so changes to them are deliberate:
//   - 1h gap before older tool results are eligible for compaction
//   - keep the 5 most recent turns intact
//   - skip messages under 500 chars (not worth compacting)

#[test]
fn default_config_matches_cc() {
    let cfg = MicrocompactConfig::default();
    assert_eq!(cfg.gap_threshold_secs, 3600);
    assert_eq!(cfg.keep_recent, 5);
    assert_eq!(cfg.min_content_chars, 500);
}

// -- Recent tool-image cap --

fn tool_result_with_image(tc_id: &str, name: &str, content: &str, image_data: &str) -> Value {
    serde_json::json!({
        "role": "tool",
        "tool_call_id": tc_id,
        "name": name,
        "content": content,
        "_orgii_structured": {
            "content_blocks": [
                {
                    "type": "image",
                    "mime_type": "image/png",
                    "data": image_data,
                }
            ]
        }
    })
}

#[test]
fn cap_images_keeps_most_recent_three() {
    let mut msgs = vec![
        tool_result_with_image("tc1", "click", "Clicked 1", "AAAA"),
        tool_result_with_image("tc2", "click", "Clicked 2", "BBBB"),
        tool_result_with_image("tc3", "click", "Clicked 3", "CCCC"),
        tool_result_with_image("tc4", "click", "Clicked 4", "DDDD"),
        tool_result_with_image("tc5", "click", "Clicked 5", "EEEE"),
    ];
    let stripped = cap_recent_tool_images(&mut msgs);
    assert_eq!(stripped, 2);

    // tc1 + tc2: image stripped, breadcrumb prepended
    for (idx, msg) in msgs.iter().enumerate().take(2) {
        let blocks = msg["_orgii_structured"]["content_blocks"]
            .as_array()
            .unwrap();
        assert!(
            blocks.is_empty(),
            "msg {} should have no image blocks left",
            idx
        );
        let content = msg["content"].as_str().unwrap();
        assert!(
            content.starts_with("[Earlier screenshot omitted"),
            "msg {} missing breadcrumb: {}",
            idx,
            content,
        );
    }

    // tc3..tc5: image retained, content unchanged
    for (idx, msg) in msgs.iter().enumerate().skip(2).take(3) {
        let blocks = msg["_orgii_structured"]["content_blocks"]
            .as_array()
            .unwrap();
        assert_eq!(blocks.len(), 1, "msg {} should retain its image", idx);
        let content = msg["content"].as_str().unwrap();
        assert!(
            !content.contains("[Earlier screenshot omitted"),
            "msg {} should not have breadcrumb",
            idx
        );
    }
}

#[test]
fn cap_images_no_op_when_under_limit() {
    let mut msgs = vec![
        tool_result_with_image("tc1", "click", "Clicked 1", "AAAA"),
        tool_result_with_image("tc2", "click", "Clicked 2", "BBBB"),
    ];
    let stripped = cap_recent_tool_images(&mut msgs);
    assert_eq!(stripped, 0);
    for msg in &msgs {
        let blocks = msg["_orgii_structured"]["content_blocks"]
            .as_array()
            .unwrap();
        assert_eq!(blocks.len(), 1);
    }
}

#[test]
fn cap_images_preserves_non_image_sidecar_blocks() {
    let mut msgs = vec![
        tool_result_with_image("tc0a", "click", "a", "1"),
        tool_result_with_image("tc0b", "click", "b", "2"),
        tool_result_with_image("tc0c", "click", "c", "3"),
        serde_json::json!({
            "role": "tool",
            "tool_call_id": "tc1",
            "name": "click",
            "content": "Clicked",
            "_orgii_structured": {
                "content_blocks": [
                    { "type": "image", "mime_type": "image/png", "data": "AAAA" },
                    { "type": "resource_link", "uri": "file:///foo" },
                ]
            }
        }),
    ];
    cap_recent_tool_images(&mut msgs);

    // Last 3 images (tc0b, tc0c, and the resource_link msg's image)
    // fit under the cap — wait, we have 4 image messages, so tc0a
    // gets stripped. The resource_link block on the newest msg stays.
    let last = &msgs[3];
    let blocks = last["_orgii_structured"]["content_blocks"]
        .as_array()
        .unwrap();
    let kinds: Vec<&str> = blocks
        .iter()
        .map(|b| b.get("type").and_then(Value::as_str).unwrap_or(""))
        .collect();
    assert!(
        kinds.contains(&"image"),
        "newest msg should keep its image: {:?}",
        kinds
    );
    assert!(
        kinds.contains(&"resource_link"),
        "resource_link must survive: {:?}",
        kinds
    );
}

#[test]
fn cap_images_breadcrumb_is_idempotent() {
    let mut msgs = vec![
        tool_result_with_image("tc1", "click", "old", "AAAA"),
        tool_result_with_image("tc2", "click", "x", "1"),
        tool_result_with_image("tc3", "click", "x", "2"),
        tool_result_with_image("tc4", "click", "x", "3"),
    ];
    cap_recent_tool_images(&mut msgs);
    let after_first = msgs[0]["content"].as_str().unwrap().to_string();
    // Running again should not double-prepend the breadcrumb.
    cap_recent_tool_images(&mut msgs);
    let after_second = msgs[0]["content"].as_str().unwrap();
    assert_eq!(after_first, after_second);
}
