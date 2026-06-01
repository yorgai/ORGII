use serde_json::json;

use super::stream_parser::{handle_event, EventOutcome, StreamState};
use super::types::StreamEvent;
use crate::providers::traits::StreamDelta;

fn parse_event(value: serde_json::Value) -> StreamEvent {
    serde_json::from_value(value).expect("test stream event should deserialize")
}

#[test]
fn unknown_anthropic_content_frames_are_counted_without_stopping_stream() {
    let mut state = StreamState::default();
    let on_delta = |_delta: StreamDelta| {};

    let block_outcome = handle_event(
        parse_event(json!({
            "type": "content_block_start",
            "index": 0,
            "content_block": { "type": "server_tool_use", "id": "srv_1" }
        })),
        &mut state,
        &on_delta,
        "claude-test",
    );
    let delta_outcome = handle_event(
        parse_event(json!({
            "type": "content_block_delta",
            "index": 0,
            "delta": { "type": "server_tool_delta", "payload": "opaque" }
        })),
        &mut state,
        &on_delta,
        "claude-test",
    );

    assert!(matches!(block_outcome, EventOutcome::Continue));
    assert!(matches!(delta_outcome, EventOutcome::Continue));
    assert_eq!(state.unknown_frame_count, 2);
}
